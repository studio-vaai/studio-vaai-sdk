import type { FetchTrackingClientConfig, TrackingClient } from "@studio-vaai/js-tracking";

import type { BodyApi } from "./api/body.js";
import type { CatalogApi } from "./api/catalog.js";
import type { ExperimentsApi } from "./api/experiments.js";
import type { MetaApi } from "./api/meta.js";
import type { SessionApi } from "./api/session.js";
import type { TryOnApi } from "./api/try-on.js";
import type { SessionHandle } from "./types.js";

import { StudioVaaiClientNotImplementedError } from "./errors.js";

/** Npm package id; paired with {@link API_VERSION} for the client version header. */
export const SDK_PACKAGE_ID = "@studio-vaai/js-client" as const;

/** Contract date (calendar-style); must match the server OpenAPI `info.version`. */
export const API_VERSION = "2026-11-05" as const;

/** Always `X-Client-Version`. */
export const HEADER_CLIENT_VERSION = "X-Client-Version" as const;

/** Value for {@link HEADER_CLIENT_VERSION}; same as `${SDK_PACKAGE_ID}/${API_VERSION}`. Not overridable. */
export const CLIENT_VERSION_HEADER_VALUE = `${SDK_PACKAGE_ID}/${API_VERSION}` as const;

export interface ClientConfig {
  clientApiKey: string;
}

export type AnalyticsClientOptions = Omit<
  FetchTrackingClientConfig,
  "clientApiKey" | "baseUrl" | "fetch"
>;

export interface SessionActivity {
  session: SessionHandle;
  requestId: number;
  startedAt: number;
  phase: "started" | "settled";
  accepted: boolean;
}

export interface StudioVaaiClient {
  /** Activity from photo submission, height calibration and try-on creation. */
  onSessionActivity?: (listener: (activity: SessionActivity) => void) => () => void;
  meta: MetaApi;
  session: SessionApi;
  body: BodyApi;
  /** Creates a tracking client using this client's API key and fetch implementation. */
  analytics: { createTrackingClient(options: AnalyticsClientOptions): TrackingClient };
  tryOn: TryOnApi;
  experiments: ExperimentsApi;
  /** The shop's products and their variants. Optional so existing test doubles stay valid; the fetch client provides it. */
  catalog?: CatalogApi;
}

/** Contract-only stub — throws; a transport package supplies a real implementation. */
export function createClient(_config: ClientConfig): StudioVaaiClient {
  throw new StudioVaaiClientNotImplementedError();
}
