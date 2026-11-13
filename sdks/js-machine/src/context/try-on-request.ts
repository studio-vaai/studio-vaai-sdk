import type { BodyId, ProductId } from "@studio-vaai/js-client";
import type { SessionHandle } from "@studio-vaai/js-client";
import type { TryOnId, TryOnResult } from "@studio-vaai/js-client";
import type { StudioVaaiClient } from "@studio-vaai/js-client";

import type { JsMachineInput } from "./shared.js";

export interface TryOnRequestInput extends JsMachineInput {
  session: SessionHandle;
  bodyId: BodyId;
  productId: ProductId;
  /** `id` of the variant to try on. */
  variantId: string;
}

export interface TryOnRequestContext {
  client: StudioVaaiClient;
  session: SessionHandle;
  bodyId: BodyId;
  productId: ProductId;
  variantId: string;
  tryOnId?: TryOnId | undefined;
  /** Set when {@link tryOnRequestMachine} completes successfully. */
  result?: TryOnResult | undefined;
}
