import type { ApiResult, CallOptions } from "../base.js";

/** No session; args are intentionally empty. */
export type GetHealthArgs = Record<string, never>;

export interface HealthCheckData {
  status: "healthy";
}

export interface MetaApi {
  getHealth(args: GetHealthArgs, options?: CallOptions): Promise<ApiResult<HealthCheckData>>;
}
