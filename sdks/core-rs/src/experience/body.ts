import type { BodyIdentity, BodyState, HeightStatus } from "../../build/wasm2/state_machine.js";

import { BodyState_Tags } from "../../build/wasm2/state_machine.js";

/** The committed body, live or missing; none before a photo is accepted. */
export function bodyIdentity(body: BodyState): BodyIdentity | undefined {
  return body.tag === BodyState_Tags.NoBody ? undefined : body.inner.identity;
}

/** Where the live body's height stands; none without a live body. */
export function bodyHeight(body: BodyState): HeightStatus | undefined {
  return body.tag === BodyState_Tags.Live ? body.inner.height : undefined;
}
