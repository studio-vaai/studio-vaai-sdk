import type { StandardError } from "@studio-vaai/js-client";
import type { SessionHandle } from "@studio-vaai/js-client";
import type { StudioVaaiClient } from "@studio-vaai/js-client";

import type { JsMachineInput } from "./shared.js";

export type SessionIntroInput = JsMachineInput;

export interface SessionIntroContext {
  client: StudioVaaiClient;
  session?: SessionHandle | undefined;
  expiresAt?: string | undefined;
  lastError?: StandardError | undefined;
}
