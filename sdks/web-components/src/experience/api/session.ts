import type { BodyId, MediaId, RestoredBody } from "@studio-vaai/core";
import type { ExperienceImageTarget } from "@studio-vaai/core/api";

import { Outcome, SessionJob, SessionOutcome } from "@studio-vaai/core";
import {
  ApiClient,
  browserTransport,
  establishExperienceSession,
  ExperienceBodyRestore,
  ExperienceCredential,
  ExperienceCredentials,
  experienceCredentialRefreshTimeoutMs,
  ExperienceRequestCredential,
  ExperienceEstablishment,
  ExperienceImageRenewal,
  ExperienceImageTarget as ImageTarget,
  ExperienceSessionRestore,
  renewExperienceImage,
  restoreExperienceBody,
  restoreExperienceSession,
} from "@studio-vaai/core/api";

import type { BodySelectionStore, CommittedBody } from "./body-selection.js";

import {
  apiFailure,
  CookieSessionChangedError,
  CredentialRejectedError,
  isSessionExpired,
  throwSessionOutcome,
} from "./outcomes.js";

interface RestoredPhoto {
  media: MediaId;
  id: BodyId;
  src: string;
  expiry: number;
  asset: string;
}

function ready(): Outcome {
  return new Outcome.Session({ outcome: new SessionOutcome.Ready() });
}

function cookieReady(generation: string, body?: RestoredBody): Outcome {
  return new Outcome.Session({
    outcome: new SessionOutcome.CookieEstablished({
      generation,
      ...(body === undefined ? {} : { body }),
    }),
  });
}

export function apiSession(
  client: ApiClient,
  fetchImpl: typeof fetch,
  selection: BodySelectionStore,
  restorePhoto?: (url: string) => MediaId,
  credentialRefreshed?: (revision: bigint) => void,
) {
  let restored: RestoredPhoto | undefined;
  let disposed = false;
  let credentialLifetime = new AbortController();
  const credentials = new ExperienceCredentials(client, {
    cookieGeneration: () => selection.generation,
    parseExpiryMs: (value) => Date.parse(value),
    nowMs: () => Date.now(),
    credentialRefreshed: (revision) => credentialRefreshed?.(revision),
  });

  async function withRequestSignal<T>(
    signal: AbortSignal,
    run: (scoped: ApiClient) => Promise<T>,
  ): Promise<T> {
    const scoped = client.withTransport(browserTransport(fetchImpl, false, signal));
    if (!ApiClient.instanceOf(scoped)) {
      throw new Error("The API did not return a scoped client.");
    }
    try {
      return await run(scoped);
    } finally {
      scoped.uniffiDestroy();
    }
  }

  async function withCredential<T>(
    signal: AbortSignal,
    run: (request: ExperienceRequestCredential) => Promise<T>,
  ): Promise<T> {
    signal.throwIfAborted();
    const request = credentials.beginRequest(browserTransport(fetchImpl, false, signal));
    if (request === undefined || !ExperienceRequestCredential.instanceOf(request)) {
      throw new CookieSessionChangedError("The cookie session changed.");
    }
    const requireCurrent = () => {
      if (disposed || !credentials.requestIsCurrent(request)) {
        throw new CookieSessionChangedError("The cookie session changed.");
      }
    };
    try {
      const result = await run(request).catch((error: unknown) => {
        requireCurrent();
        throw error;
      });
      requireCurrent();
      return result;
    } finally {
      request.uniffiDestroy();
    }
  }

  async function authenticated<T>(
    signal: AbortSignal,
    send: (scoped: ApiClient, request: ExperienceRequestCredential) => Promise<T>,
  ): Promise<T> {
    return await withCredential(signal, async (request) => {
      const scoped = request.client();
      if (!ApiClient.instanceOf(scoped)) {
        throw new Error("The API did not return a credential-scoped client.");
      }
      try {
        return await send(scoped, request);
      } catch (error) {
        if (isSessionExpired(error)) {
          throw new CredentialRejectedError(request.revision());
        }
        throw error;
      } finally {
        scoped.uniffiDestroy();
      }
    });
  }

  async function beforeAuthenticatedRequest() {
    const signal = AbortSignal.any([
      credentialLifetime.signal,
      AbortSignal.timeout(experienceCredentialRefreshTimeoutMs()),
    ]);
    const outcome = await credentials.refreshIfNeeded(
      browserTransport(fetchImpl, false, signal),
      Date.now(),
    );
    if (outcome !== undefined) {
      throwSessionOutcome(outcome);
    }
  }

  async function restoreBody(
    generation: string,
    request: ExperienceRequestCredential,
    signal: AbortSignal,
  ): Promise<Outcome> {
    while (credentials.requestIsCurrent(request)) {
      signal.throwIfAborted();
      const saved = selection.selected();
      if (restorePhoto === undefined || saved === undefined) {
        return cookieReady(generation);
      }
      // oxlint-disable-next-line eslint/no-await-in-loop -- Retry only if storage changes during the previous read.
      const result = await restoreExperienceBody(credentials, request, saved.body.id);
      signal.throwIfAborted();
      if (ExperienceBodyRestore.Ended.instanceOf(result)) {
        return result.inner.outcome;
      }
      if (!selection.isCurrent(saved)) {
        continue;
      }
      const { body } = result.inner;
      if (body === undefined) {
        selection.rejectSelection(saved);
        continue;
      }
      if (!credentials.requestIsCurrent(request)) {
        break;
      }
      const media = restorePhoto(body.sourceImageUrl);
      restored = {
        media,
        id: body.bodyId,
        src: body.sourceImageUrl,
        asset: crypto.randomUUID(),
        expiry: body.sourceImageUrlExpiresAtMs,
      };
      return cookieReady(generation, {
        bodyId: body.bodyId,
        media,
        source: saved.body.source,
        estimatedHeight: body.estimatedHeight,
        ...(body.height === undefined ? {} : { height: body.height }),
        ...(body.backendRevision === undefined ? {} : { backendRevision: body.backendRevision }),
      });
    }
    return new Outcome.SessionExpired();
  }

  async function renewImage(target: ExperienceImageTarget, signal: AbortSignal) {
    await beforeAuthenticatedRequest();
    const result = await withCredential(
      signal,
      async (request) => await renewExperienceImage(credentials, request, target),
    );
    signal.throwIfAborted();
    if (ExperienceImageRenewal.Ended.instanceOf(result)) {
      throwSessionOutcome(result.inner.outcome);
    }
    return result.inner;
  }

  async function run(job: SessionJob, signal: AbortSignal): Promise<Outcome> {
    if (SessionJob.Restore.instanceOf(job)) {
      const generation = credentials.cookieGeneration();
      if (generation === undefined || generation !== selection.generation) {
        return new Outcome.SessionExpired();
      }
      credentials.beginEstablishment();
      try {
        return await withCredential(signal, async (request) => {
          const result = await restoreExperienceSession(credentials, request, {
            isCurrent: () => !signal.aborted,
          });
          signal.throwIfAborted();
          return ExperienceSessionRestore.Ended.instanceOf(result)
            ? result.inner.outcome
            : await restoreBody(result.inner.generation, request, signal);
        });
      } catch (error) {
        return apiFailure(error, false);
      }
    }

    const epoch = credentials.beginEstablishment();
    const generationAtPreparation = selection.generation;
    const isCurrent = () => generationAtPreparation === selection.generation;
    // Let Rust observe transport cancellation at the current request boundary.
    const result = await withRequestSignal(
      signal,
      async (scoped) => await establishExperienceSession(scoped, { isCurrent }),
    );
    if (ExperienceEstablishment.Ended.instanceOf(result)) {
      return result.inner.outcome;
    }
    if (signal.aborted || !isCurrent()) {
      return new Outcome.Unknown();
    }
    const { credential } = result.inner;
    if (ExperienceCredential.Bearer.instanceOf(credential)) {
      return credentials.install(epoch, credential, generationAtPreparation)
        ? ready()
        : new Outcome.Unknown();
    }
    const generation = selection.beginSession();
    return credentials.install(epoch, credential, generation)
      ? cookieReady(generation)
      : new Outcome.Unknown();
  }

  return {
    run,
    authenticated,
    withCredential,
    credentials,
    requestIsCurrent: (request: ExperienceRequestCredential) =>
      !disposed && credentials.requestIsCurrent(request),
    invalidatedCookieGeneration: () => credentials.invalidatedCookieGeneration(),
    commitBody(body: CommittedBody) {
      restored = undefined;
      const generation = credentials.cookieGeneration();
      if (generation !== undefined) {
        selection.save(body, generation);
      }
    },
    beforeAuthenticatedRequest,
    getRestoredPhoto(media: MediaId) {
      return restored?.media === media ? restored : undefined;
    },
    renewImage,
    async refreshPhoto(current: RestoredPhoto, signal: AbortSignal) {
      if (restored !== current) {
        return false;
      }
      const { url, expiresAtMs } = await renewImage(
        new ImageTarget.Photo({ bodyId: current.id }),
        signal,
      );
      if (restored !== current || signal.aborted || expiresAtMs === undefined) {
        return false;
      }
      restored = { ...current, src: url, expiry: expiresAtMs, asset: crypto.randomUUID() };
      return true;
    },
    clear(forgetBody: boolean) {
      credentialLifetime.abort();
      credentialLifetime = new AbortController();
      restored = undefined;
      const generation = credentials.cookieGeneration();
      if (forgetBody && generation !== undefined && generation === selection.generation) {
        selection.save(null, generation);
      }
      credentials.clear();
    },
    dispose() {
      this.clear(false);
      disposed = true;
      credentials.uniffiDestroy();
    },
  };
}
