import type { TryOnExperienceEventMap } from "@studio-vaai/core";

export type {
  TryOnExperienceEntry,
  TryOnExperienceEvent,
  TryOnExperienceEventMap,
  TryOnExperienceStep,
} from "@studio-vaai/core";

type ExperienceDomEvents = {
  [Name in keyof TryOnExperienceEventMap]: CustomEvent<TryOnExperienceEventMap[Name]>;
};

declare global {
  // oxlint-disable-next-line typescript/no-empty-interface, typescript/no-empty-object-type -- Merge the mapped event types into the DOM's event map.
  interface HTMLElementEventMap extends ExperienceDomEvents {}
}
