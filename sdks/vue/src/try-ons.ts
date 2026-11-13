import type { TryOn } from "@studio-vaai/core";
import type { TryOnExperience } from "@studio-vaai/web-components/experience";
import type { ComputedRef, InjectionKey, Ref } from "vue";

import { computed, inject, shallowRef, watch } from "vue";

export const tryOnExperienceKey: InjectionKey<Ref<TryOnExperience | undefined> | undefined> =
  Symbol("StudioVaaiTryOn");

const empty: readonly TryOn[] = Object.freeze([]);

/** Completed results in creation order for the enclosing StudioVaaiTryOn. */
export function useTryOns(): ComputedRef<readonly TryOn[]> {
  const experience = inject(tryOnExperienceKey, globalThis.undefined);
  const results = shallowRef(empty);
  if (experience !== globalThis.undefined) {
    watch(
      experience,
      (controller, _previous, onCleanup) => {
        const update = () => {
          results.value = controller?.view.domain.tryOns ?? empty;
        };
        if (controller !== globalThis.undefined) {
          onCleanup(controller.subscribe(update));
        }
        update();
      },
      { immediate: true },
    );
  }
  return computed(() => results.value);
}
