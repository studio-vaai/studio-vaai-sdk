import type { BackendError } from "@studio-vaai/core";

import { Outcome } from "@studio-vaai/core";
import { ApiError, classifyExperienceApiError, credentialRejected } from "@studio-vaai/core/api";

export class CookieSessionChangedError extends Error {
  override readonly name = "CookieSessionChangedError";
}

export class CredentialRejectedError extends Error {
  override readonly name = "CredentialRejectedError";

  readonly revision: bigint;

  constructor(revision: bigint) {
    super("The API rejected the request credential.");
    this.revision = revision;
  }
}

export class ApiSessionOutcomeError extends Error {
  override readonly name = "ApiSessionOutcomeError";
  readonly outcome: Outcome;

  constructor(outcome: Outcome) {
    super("The authenticated request failed.");
    this.outcome = outcome;
  }
}

export function throwSessionOutcome(outcome: Outcome): never {
  if (Outcome.SessionExpired.instanceOf(outcome)) {
    throw new CookieSessionChangedError("The cookie session changed.");
  }
  if (Outcome.CredentialRejected.instanceOf(outcome)) {
    throw new CredentialRejectedError(outcome.inner.revision);
  }
  throw new ApiSessionOutcomeError(outcome);
}

function isApiError(error: unknown): error is ApiError {
  return (
    error instanceof ApiError.Problem ||
    error instanceof ApiError.Decode ||
    error instanceof ApiError.UnexpectedStatus ||
    error instanceof ApiError.InvalidRequest ||
    error instanceof ApiError.NotSent ||
    error instanceof ApiError.Transport
  );
}

export function isSessionExpired(error: unknown): boolean {
  return (
    error instanceof CookieSessionChangedError || (isApiError(error) && credentialRejected(error))
  );
}

export function failed(error: BackendError): Outcome {
  return new Outcome.Failed({ error });
}

export function apiFailure(error: unknown, writes: boolean): Outcome {
  if (error instanceof ApiSessionOutcomeError) {
    return error.outcome;
  }
  if (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError")) {
    return classifyExperienceApiError(new ApiError.Transport({ reason: error.message }), writes);
  }
  if (error instanceof CredentialRejectedError) {
    return new Outcome.CredentialRejected({ revision: error.revision });
  }
  if (error instanceof CookieSessionChangedError) {
    return new Outcome.SessionExpired();
  }
  if (isApiError(error)) {
    return classifyExperienceApiError(error, writes);
  }
  throw error;
}
