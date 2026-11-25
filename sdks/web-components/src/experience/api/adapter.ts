import type {
  MediaEffect,
  MediaId,
  OperationId,
  Outcome,
  RestoredTryOn,
  TryOnAsset,
  TryOnSession,
} from "@studio-vaai/core";
import type { ApiClient, TryOnSuccess } from "@studio-vaai/core/api";

import {
  BackendError,
  DomainEffect,
  DomainEvent,
  Effect,
  Job,
  SessionEffect,
  SessionCommand,
  SessionEvent,
  TryOnEvent,
} from "@studio-vaai/core";
import {
  ExperienceImageTarget,
  experienceImageRenewalTimeoutMs,
  experienceJobTimeoutMs,
  runExperienceJob,
} from "@studio-vaai/core/api";

import type { TryOnExperienceAdapters } from "../controller.js";
import type { BodySelectionStore } from "./body-selection.js";
import type { TryOnHistoryStore } from "./try-on-history.js";

import { ImageFetchError } from "../image-fetch-error.js";
import { imageRenewal } from "./image-renewal.js";
import {
  apiFailure,
  CredentialRejectedError,
  failed,
  isSessionExpired,
  renewalGone,
} from "./outcomes.js";
import { processPhoto } from "./photo.js";
import { lookupProduct } from "./product.js";
import { apiSession } from "./session.js";

export interface TryOnExperienceDevices extends Pick<
  TryOnExperienceAdapters,
  "startDeviceEffect" | "getPhoto" | "getCamera" | "onEvent" | "dispose"
> {
  /** Resolve the original upload bytes for a picked or captured photo. */
  getUploadPhoto(id: MediaId): Blob | undefined;
  /** Retain or release the domain's interest separately from the flow's interest. */
  applyDomainMediaEffect(effect: MediaEffect): void;
  restorePhoto?(src: string): MediaId;
}

export function apiAdapters(
  client: ApiClient,
  devices: TryOnExperienceDevices,
  fetchImpl: typeof fetch,
  selection: BodySelectionStore,
  history?: TryOnHistoryStore,
): TryOnExperienceAdapters {
  const operations = new Map<OperationId, AbortController>();
  let disposed = false;
  let sessionEpoch = 0;
  let sessionCommand: ((command: SessionCommand) => void) | undefined;
  const session = apiSession(
    client,
    fetchImpl,
    selection,
    devices.restorePhoto?.bind(devices),
    (revision) => {
      sessionCommand?.(new SessionCommand.CredentialRefreshed({ revision }));
    },
  );
  const images = imageRenewal();
  // Keep raw API diagnostics for getResult callers. Rust owns the current image URL.
  const details = new Map<string, Omit<TryOnSuccess, "imageUrl">>();
  const pendingDetails = new Map<OperationId, Omit<TryOnSuccess, "imageUrl">>();
  const resultListeners = new Set<() => void>();
  let resultState:
    | {
        runtime: TryOnSession;
        replaceImage: (expected: TryOnAsset, imageUrl: string) => void;
        restoreTryOns?: ((tryOns: RestoredTryOn[]) => void) | undefined;
      }
    | undefined;

  /**
   * Brings back the try-ons this browser kept for a restored session's body: the API lists no
   * try-ons, so a reload would otherwise start without the shopper's results. Each is read again
   * for a fresh image link. One the API no longer has is forgotten; one that could not be read
   * right now (unavailable, a timeout, offline) is kept for the next restore.
   */
  async function restoreTryOns(bodyId: string): Promise<void> {
    const kept = history?.of(bodyId) ?? [];
    const restore = resultState?.restoreTryOns;
    if (kept.length === 0 || restore === undefined) {
      return;
    }
    const epoch = sessionEpoch;
    const read = await Promise.all(
      kept.map(async (tryOn) => {
        try {
          const { url } = await session.renewImage(
            new ExperienceImageTarget.Result({
              tryOnId: tryOn.tryOnId,
              variant: tryOn.variantId,
              bodyRevision: tryOn.backendRevision,
            }),
            AbortSignal.timeout(
              experienceImageRenewalTimeoutMs(
                new ExperienceImageTarget.Result({ tryOnId: tryOn.tryOnId }),
              ),
            ),
          );
          const restored: RestoredTryOn = { ...tryOn, imageUrl: url };
          return restored;
        } catch (error) {
          // Deleted or expired: forgotten below. Anything else may work on the next restore.
          return renewalGone(error) ? "gone" : "unread";
        }
      }),
    );
    if (disposed || epoch !== sessionEpoch || session.restoredBody() !== bodyId) {
      return;
    }
    for (const [index, tryOn] of kept.entries()) {
      if (read.at(index) === "gone") {
        history?.forget(tryOn.tryOnId);
      }
    }
    restore(read.filter((tryOn): tryOn is RestoredTryOn => typeof tryOn === "object"));
  }

  /** Keeps a try-on just made, so a reload that restores the session shows it again. */
  function rememberTryOn(tryOnId: string, productId: string, variantId: string): void {
    const bodyId = selection.selected()?.body.id;
    const backendRevision = resultState?.runtime.tryOnAsset(tryOnId)?.backendRevision;
    if (bodyId !== undefined && backendRevision !== undefined && backendRevision !== "") {
      history?.remember(bodyId, { tryOnId, productId, variantId, backendRevision });
    }
  }

  function checkSession() {
    const generation = session.invalidatedCookieGeneration();
    if (generation !== undefined) {
      sessionCommand?.(new SessionCommand.CookieInvalidated({ generation }));
    }
  }

  function storageChanged(event: StorageEvent) {
    if (selection.watches(event.key)) {
      checkSession();
    }
  }

  function notifyResults() {
    for (const listener of resultListeners) {
      try {
        listener();
      } catch {
        // An observer cannot interrupt result publication.
      }
    }
  }

  function clearResults() {
    details.clear();
    pendingDetails.clear();
    images.clear();
  }

  async function renewImage(
    key: string | object,
    timeout: number,
    refresh: (signal: AbortSignal) => Promise<void>,
    consumer?: AbortSignal,
  ): Promise<void> {
    if (disposed) {
      return;
    }
    const epoch = sessionEpoch;
    await images.renew(
      key,
      async (request) => {
        const signal = AbortSignal.any([request, AbortSignal.timeout(timeout)]);
        try {
          signal.throwIfAborted();
          await refresh(signal);
        } catch (error) {
          if (!request.aborted && epoch === sessionEpoch) {
            if (error instanceof CredentialRejectedError) {
              sessionCommand?.(new SessionCommand.CredentialRejected({ revision: error.revision }));
            } else if (isSessionExpired(error)) {
              checkSession();
            }
          }
          throw error;
        }
      },
      consumer,
    );
  }

  async function refreshPhoto(
    id: MediaId,
    expectedSrc?: string,
    consumer?: AbortSignal,
  ): Promise<void> {
    const restored = session.getRestoredPhoto(id);
    if (
      restored === undefined ||
      restored.gone ||
      (expectedSrc !== undefined && restored.src !== expectedSrc)
    ) {
      return;
    }
    await renewImage(
      restored,
      experienceImageRenewalTimeoutMs(new ExperienceImageTarget.Photo({ bodyId: restored.id })),
      async (signal) => {
        if (await session.refreshPhoto(restored, signal)) {
          notifyResults();
        }
      },
      consumer,
    );
  }

  async function execute(job: Job, operation: OperationId, signal: AbortSignal): Promise<Outcome> {
    if (Job.Session.instanceOf(job)) {
      return await session.run(job.inner.job, signal);
    }
    try {
      await session.beforeAuthenticatedRequest();
      signal.throwIfAborted();
    } catch (error) {
      // No write was submitted. A transport error here is safe to retry.
      return apiFailure(error, false);
    }
    try {
      if (Job.Photo.instanceOf(job)) {
        const image = devices.getUploadPhoto(job.inner.job.inner.photo.media);
        if (image === undefined) {
          return failed(BackendError.InvalidRequest);
        }
        return await session.authenticated(
          signal,
          async (scoped, request) =>
            await processPhoto(
              scoped,
              () => (session.requestIsCurrent(request) ? request.revision() : undefined),
              fetchImpl,
              image,
              signal,
            ),
        );
      }
      const runtime = resultState?.runtime;
      if (runtime === undefined) {
        return failed(BackendError.Internal);
      }
      return await session.withCredential(signal, async (request) => {
        const { outcome, result } = await runExperienceJob(
          session.credentials,
          request,
          job,
          runtime,
        );
        if (result !== undefined && !signal.aborted && !disposed) {
          const { imageUrl: _imageUrl, ...metadata } = result;
          pendingDetails.set(operation, metadata);
        }
        return outcome;
      });
    } catch (error) {
      return apiFailure(error, false);
    }
  }

  return {
    bindSession(runtime, replaceImage, restore) {
      resultState = { runtime, replaceImage, restoreTryOns: restore };
    },
    async runJob(job, operation, onDeadline, onSlow) {
      const abort = new AbortController();
      operations.set(operation, abort);
      const deadline = AbortSignal.timeout(experienceJobTimeoutMs(job));
      const signal = AbortSignal.any([abort.signal, deadline]);
      let work: "photo" | "try-on" | undefined;
      if (Job.Photo.instanceOf(job)) {
        work = "photo";
      } else if (Job.TryOn.instanceOf(job)) {
        work = "try-on";
      }
      const observedWork = work;
      const reportDeadline = () => {
        if (observedWork !== undefined && deadline.aborted && signal.reason === deadline.reason) {
          onDeadline?.(observedWork);
        }
      };
      const slowTimer =
        observedWork !== undefined && onSlow !== undefined
          ? setTimeout(
              () => {
                if (!signal.aborted) {
                  onSlow(observedWork);
                }
              },
              observedWork === "photo" ? 10_000 : 30_000,
            )
          : undefined;
      signal.addEventListener("abort", reportDeadline, { once: true });
      try {
        return await execute(job, operation, signal);
      } finally {
        clearTimeout(slowTimer);
        signal.removeEventListener("abort", reportDeadline);
        operations.delete(operation);
      }
    },
    finishJob(operation) {
      pendingDetails.delete(operation);
    },
    applyDomainEffect(effect) {
      if (DomainEffect.Cancel.instanceOf(effect)) {
        const { operation } = effect.inner;
        operations.get(operation)?.abort();
      } else if (DomainEffect.Media.instanceOf(effect)) {
        devices.applyDomainMediaEffect(effect.inner.effect);
      } else if (DomainEffect.PersistBody.instanceOf(effect)) {
        const { bodyId, source } = effect.inner;
        sessionEpoch += 1;
        clearResults();
        session.commitBody({ id: bodyId, source });
      } else if (effect.inner.effect !== SessionEffect.Persist) {
        sessionEpoch += 1;
        const forget = effect.inner.effect === SessionEffect.Clear;
        session.clear(forget);
        if (forget) {
          // A withdrawn session's try-ons are not shown to the next one.
          history?.clear();
        }
        clearResults();
      }
    },
    startDeviceEffect(effect, capture): ReturnType<TryOnExperienceDevices["startDeviceEffect"]> {
      return devices.startDeviceEffect(effect, capture);
    },
    async getProductDetails(productId, signal) {
      return await lookupProduct(client, fetchImpl, { productId }, signal);
    },
    async getProductByForeignId(foreignId, signal) {
      return await lookupProduct(client, fetchImpl, { foreignId }, signal);
    },
    getResult(id) {
      const metadata = details.get(id);
      const asset = metadata === undefined ? undefined : resultState?.runtime.tryOnAsset(id);
      return asset === undefined || metadata === undefined
        ? undefined
        : { result: { ...metadata, imageUrl: asset.imageUrl } };
    },
    subscribeResults(listener) {
      resultListeners.add(listener);
      return () => {
        resultListeners.delete(listener);
      };
    },
    async fetchImage(src, signal) {
      const response = await fetchImpl(src, { credentials: "omit", signal });
      if (!response.ok) {
        throw new ImageFetchError(response.status);
      }
      return await response.blob();
    },
    refreshPhoto,
    async refreshResult(id, consumer, expectedSrc) {
      if (disposed || resultState === undefined) {
        return;
      }
      const { runtime, replaceImage } = resultState;
      const current = runtime.tryOnAsset(id);
      if (
        current === undefined ||
        (expectedSrc !== undefined && current.imageUrl !== expectedSrc)
      ) {
        return;
      }
      const target = new ExperienceImageTarget.Result({
        tryOnId: id,
        variant: current.key.variantId,
        ...(current.backendRevision === undefined ? {} : { bodyRevision: current.backendRevision }),
      });
      await renewImage(
        JSON.stringify([current.operation, current.imageUrl]),
        experienceImageRenewalTimeoutMs(target),
        async (signal) => {
          const { url } = await session.renewImage(target, signal);
          signal.throwIfAborted();
          replaceImage(current, url);
        },
        consumer,
      );
    },
    checkSession,
    subscribeSessionCommands(listener) {
      sessionCommand = listener;
      globalThis.window?.addEventListener("storage", storageChanged);
      globalThis.window?.addEventListener("pageshow", checkSession);
      return () => {
        sessionCommand = undefined;
        globalThis.window?.removeEventListener("storage", storageChanged);
        globalThis.window?.removeEventListener("pageshow", checkSession);
      };
    },
    getPhoto(id) {
      const restored = session.getRestoredPhoto(id);
      if (restored === undefined) {
        return devices.getPhoto(id);
      }
      return restored.gone
        ? { src: "", gone: true }
        : { src: restored.src, signed: { asset: restored.asset, expiresAt: restored.expiry } };
    },
    getCamera: (id) => devices.getCamera(id),
    photoGone: () => session.photoGone(),
    onEvent(event) {
      if (Effect.DomainEvent.instanceOf(event)) {
        const domain = event.inner.event;
        if (DomainEvent.TryOn.instanceOf(domain)) {
          const tryOn = domain.inner.event;
          if (TryOnEvent.Created.instanceOf(tryOn)) {
            const created = tryOn.inner.tryOn;
            const result = pendingDetails.get(tryOn.inner.operation);
            if (result?.tryOnId === created.id) {
              details.set(result.tryOnId, result);
            }
            rememberTryOn(created.id, tryOn.inner.productId, created.key.variantId);
          } else if (TryOnEvent.Evicted.instanceOf(tryOn)) {
            details.delete(tryOn.inner.tryOnId);
          }
        } else if (
          DomainEvent.Session.instanceOf(domain) &&
          SessionEvent.Ready.instanceOf(domain.inner.event)
        ) {
          const bodyId = session.restoredBody();
          if (bodyId !== undefined) {
            void restoreTryOns(bodyId);
          } else if (session.photoGone()) {
            // The saved body is gone, or its photo: its try-on ids are no use any more.
            history?.clear();
          }
        }
      }
      devices.onEvent?.(event);
    },
    dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      resultState = undefined;
      session.dispose();
      for (const abort of operations.values()) {
        abort.abort();
      }
      operations.clear();
      clearResults();
      resultListeners.clear();
      try {
        devices.dispose();
      } finally {
        client.uniffiDestroy();
      }
    },
  };
}
