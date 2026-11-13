import type {
  FlowConfig,
  MessageOverrides,
  TryOnExperienceEntry,
  TryOnExperienceEvent,
  TryOnExperienceEventMap,
} from "@studio-vaai/core";
import type { TryOnAnalytics } from "@studio-vaai/core/analytics";
import type { ClientConfig } from "@studio-vaai/core/api";
import type { SvAppearance } from "@studio-vaai/web-components";
import type {
  PresentProduct,
  ProductCommerce,
  StorefrontSelection,
  SvTryOnExperience,
  TryOnExperience,
} from "@studio-vaai/web-components/experience";
import type { ComponentOptionsMixin, DefineComponent, PropType } from "vue";

import {
  computed,
  defineComponent,
  Fragment,
  h,
  onMounted,
  provide,
  ref,
  shallowRef,
  watch,
} from "vue";

import { tryOnExperienceKey } from "./try-ons.js";

export interface StudioVaaiTryOnHandle {
  /** Opens the current product when ready. Returns whether the action was dispatched. */
  open(entry?: TryOnExperienceEntry): boolean;
  close(): void;
}

export interface StudioVaaiTryOnProps {
  api: ClientConfig;
  productId?: string;
  foreignId?: string;
  productName: string;
  /** Keep the shopper session while temporarily away from the product page. */
  active?: boolean;
  locale?: string;
  /** MessageFormat 2 overrides for the current locale. */
  messages?: MessageOverrides | undefined;
  appearance?: SvAppearance;
  /** Live overrides of price and stock supplied by presentProduct. */
  commerce?: ProductCommerce;
  autoStart?: FlowConfig["autoStart"];
  analytics?: TryOnAnalytics;
  fetch?: typeof fetch;
  /** Explicit storefront choices keyed by catalogue axis. */
  selection?: StorefrontSelection;
  presentProduct: PresentProduct;
  /** Add the exact variant to the host cart. Resolving closes the dialog. */
  addToCart?: SvTryOnExperience["addToCart"];
}

// Vue 3.0 watchers compare the array as a whole. Reuse it when its inputs
// match so an equivalent config or a price update leaves pending work alone.
function stableInputs<const T extends readonly unknown[]>(read: () => T) {
  let previous: T | undefined;
  return computed(() => {
    const current = read();
    if (
      previous !== globalThis.undefined &&
      current.every((value, index) => Object.is(value, previous?.[index]))
    ) {
      return previous;
    }
    previous = current;
    return current;
  });
}

const emits = {
  readyChange: (_ready: boolean) => true,
  event: (_event: TryOnExperienceEvent, _experience: TryOnExperience) => true,
  "try-on-presented": (_detail: TryOnExperienceEventMap["sv-try-on-presented"]) => true,
  error: (_error: unknown) => true,
};

const componentProps = {
  api: { type: Object as PropType<ClientConfig>, required: true },
  productId: String,
  foreignId: String,
  productName: { type: String, required: true },
  active: { type: Boolean, default: true },
  locale: { type: String, default: "en" },
  messages: Object as PropType<MessageOverrides>,
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Vue validates the constructor at runtime and uses PropType for its public signature.
  appearance: { type: String as PropType<SvAppearance>, default: "light" },
  commerce: Object as PropType<StudioVaaiTryOnProps["commerce"]>,
  autoStart: Number as PropType<StudioVaaiTryOnProps["autoStart"]>,
  analytics: Object as PropType<TryOnAnalytics>,
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Vue validates the constructor at runtime and uses PropType for its public signature.
  fetch: Function as PropType<typeof fetch>,
  selection: Object as PropType<StorefrontSelection>,
  presentProduct: {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Vue validates the constructor at runtime and uses PropType for its public signature.
    type: Function as PropType<StudioVaaiTryOnProps["presentProduct"]>,
    required: true,
  },
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Vue validates the constructor at runtime and uses PropType for its public signature.
  addToCart: Function as PropType<StudioVaaiTryOnProps["addToCart"]>,
} as const;

type TryOnComponent = DefineComponent<
  typeof componentProps,
  StudioVaaiTryOnHandle,
  unknown,
  // oxlint-disable-next-line typescript/no-generated-empty-object-type -- This component has no options in this slot.
  Record<never, never>,
  // oxlint-disable-next-line typescript/no-generated-empty-object-type -- This component has no options in this slot.
  Record<never, never>,
  ComponentOptionsMixin,
  ComponentOptionsMixin,
  typeof emits
>;

const component = defineComponent({
  name: "StudioVaaiTryOn",
  inheritAttrs: false,
  props: componentProps,
  emits,
  setup(props, { emit }) {
    // A named ref and setup bindings also work on Vue 3.0.
    const surface = shallowRef<SvTryOnExperience | null>(null);
    const mounted = ref(false);
    const experience = shallowRef<TryOnExperience>();
    provide(tryOnExperienceKey, experience);
    const commerce = computed(() =>
      props.commerce === globalThis.undefined
        ? globalThis.undefined
        : Object.fromEntries(Object.entries(props.commerce).map(([id, item]) => [id, { ...item }])),
    );
    const desiredProduct = computed(() => ({
      product:
        props.foreignId === globalThis.undefined ? props.productId : { foreignId: props.foreignId },
      presentProduct: props.presentProduct,
      token: crypto.randomUUID(),
    }));
    const bootstrapInstallation = shallowRef<typeof desiredProduct.value>();
    const bootstrapRevision = ref(0);
    watch([experience, bootstrapInstallation, desiredProduct], ([owner, requested, desired]) => {
      if (
        owner === globalThis.undefined &&
        requested !== globalThis.undefined &&
        requested !== desired
      ) {
        bootstrapInstallation.value = globalThis.undefined;
        bootstrapRevision.value += 1;
      }
    });
    const installation = stableInputs(() => [
      experience.value,
      experience.value === globalThis.undefined ? globalThis.undefined : desiredProduct.value,
      props.active,
    ]);
    const runtime = stableInputs(() => [
      mounted.value,
      props.api.baseUrl,
      props.api.clientApiKey,
      props.api.clientName,
      props.autoStart,
      props.fetch,
      bootstrapRevision.value,
    ]);
    const viewRevision = ref(0);
    const installedToken = computed(() => {
      // The controller's immutable view changes outside Vue.
      if (viewRevision.value === 0) {
        return globalThis.undefined;
      }
      const { product, token } = desiredProduct.value;
      return product === globalThis.undefined
        ? globalThis.undefined
        : experience.value?.readyInstallation(product, token);
    });
    const ready = computed(() => props.active && installedToken.value !== globalThis.undefined);

    async function reportProductError(error: unknown, signal: AbortSignal) {
      const { isTryOnProductUnavailable } = await import("@studio-vaai/web-components/experience");
      if (!signal.aborted && !isTryOnProductUnavailable(error)) {
        emit("error", error);
      }
    }

    onMounted(() => {
      mounted.value = true;
    });

    watch(
      () => runtime.value,
      (
        [isMounted, baseUrl, clientApiKey, clientName, autoStart, fetchImpl],
        _previous,
        onCleanup,
      ) => {
        experience.value = globalThis.undefined;
        bootstrapInstallation.value = globalThis.undefined;
        if (!isMounted || surface.value === null) {
          return;
        }
        const element = surface.value;
        const abort = new AbortController();
        const api = {
          baseUrl,
          clientApiKey,
          ...(clientName === globalThis.undefined ? {} : { clientName }),
        };
        let owner: TryOnExperience | undefined;
        let detachUi: (() => void) | undefined;
        let stopUi: (() => void) | undefined;
        onCleanup(() => {
          abort.abort();
          element.experience = globalThis.undefined;
          stopUi?.();
          detachUi?.();
          owner?.dispose();
        });
        void mount();

        async function mount() {
          let requested = desiredProduct.value;
          try {
            const [sdk, { createUiContext }] = await Promise.all([
              import("@studio-vaai/web-components/experience"),
              import("@studio-vaai/web-components"),
            ]);
            abort.signal.throwIfAborted();
            sdk.defineSvTryOnExperience();
            const ui = createUiContext();
            detachUi = ui.attach(element);
            stopUi = watch(
              () => [props.locale, props.appearance, props.messages] as const,
              ([locale, appearance, messages]) => {
                ui.configure({ locale, appearance, messages });
              },
              { immediate: true },
            );
            requested = desiredProduct.value;
            bootstrapInstallation.value = requested;
            const { product, token, presentProduct } = requested;
            if (product === globalThis.undefined) {
              throw new Error("Set a storefront product ID for try-on.");
            }
            const initialCommerce = commerce.value;
            owner = await sdk.createApiTryOnExperience({
              api,
              product: typeof product === "string" ? { productId: product } : product,
              initialInstallation: { token, active: props.active },
              presentProduct,
              commerce: () =>
                requested === desiredProduct.value ? commerce.value : initialCommerce,
              ...(autoStart === globalThis.undefined ? {} : { autoStart }),
              ...(fetchImpl === globalThis.undefined ? {} : { fetch: fetchImpl }),
              devices: sdk.createBrowserTryOnDevices({
                complete: (event) => owner?.completeDevice(event),
              }),
              signal: abort.signal,
            });
            if (abort.signal.aborted) {
              owner.dispose();
              return;
            }
            experience.value = owner;
          } catch (error) {
            if (!abort.signal.aborted) {
              bootstrapInstallation.value = requested;
              if (requested === desiredProduct.value) {
                await reportProductError(error, abort.signal);
              }
            }
          }
        }
      },
    );

    watch(experience, (owner, _previous, onCleanup) => {
      viewRevision.value = 0;
      if (owner === globalThis.undefined || surface.value === null) {
        return;
      }
      const element = surface.value;
      const readProduct = () => {
        viewRevision.value += 1;
      };
      const onError = (event: Event) => {
        if (event instanceof CustomEvent) {
          emit("error", event.detail);
        }
      };
      const stopView = owner.subscribe(readProduct);
      const stopEvents = owner.subscribeEvents((event) => {
        emit("event", event, owner);
        if (event.type === "sv-try-on-presented") {
          emit("try-on-presented", event.detail);
        }
      });
      element.addEventListener("sv-try-on-experience-error", onError);
      element.experience = owner;
      readProduct();
      onCleanup(() => {
        stopView();
        stopEvents();
        element.removeEventListener("sv-try-on-experience-error", onError);
      });
    });

    watch(
      () => installation.value,
      (requested, _previous, onCleanup) => {
        const [owner, desired, active] = requested;
        if (owner === globalThis.undefined || desired === globalThis.undefined) {
          return;
        }
        const { product, presentProduct, token } = desired;
        owner.setProductActive(active);
        if (!active || product === globalThis.undefined) {
          return;
        }
        if (owner.readyInstallation(product, token) !== globalThis.undefined) {
          return;
        }
        const abort = new AbortController();
        onCleanup(() => {
          abort.abort();
        });
        const initialCommerce = commerce.value;
        const install = async () => {
          try {
            await owner.installProduct(
              product,
              presentProduct,
              () => (desired === desiredProduct.value ? commerce.value : initialCommerce),
              abort.signal,
              token,
            );
          } catch (error) {
            if (!abort.signal.aborted) {
              await reportProductError(error, abort.signal);
            }
          }
        };
        void install();
      },
    );

    watch(
      () => [ready.value, commerce.value, installedToken.value] as const,
      ([canOpen, updates, installation]) => {
        if (canOpen && installation !== globalThis.undefined) {
          experience.value?.updateCommerce(updates, installation);
        }
      },
    );

    const selection = computed(() =>
      props.selection === globalThis.undefined ? globalThis.undefined : { ...props.selection },
    );
    const storefrontSelection = stableInputs(() => [installedToken.value, selection.value]);
    watch(storefrontSelection, ([token, options]) => {
      if (token !== globalThis.undefined && options !== globalThis.undefined) {
        experience.value?.setSelection(options);
      }
    });

    watch(ready, (value) => {
      if (mounted.value) {
        emit("readyChange", value);
      }
    });
    onMounted(() => {
      emit("readyChange", ready.value);
    });

    watch([experience, () => props.analytics], (_current, _previous, onCleanup) => {
      const owner = experience.value;
      if (owner !== globalThis.undefined && props.analytics !== globalThis.undefined) {
        onCleanup(props.analytics.observe((listener) => owner.subscribeEvents(listener)));
      }
    });

    watch([surface, installedToken, () => props.productName, () => props.addToCart], () => {
      const element = surface.value;
      if (element === null || !mounted.value) {
        return;
      }
      element.addToCart = props.addToCart;
      if (installedToken.value !== globalThis.undefined) {
        element.productName = props.productName;
      }
    });

    const handle: StudioVaaiTryOnHandle = {
      open: (entry) => ready.value && experience.value?.open(entry) === true,
      close: () => experience.value?.close(),
    };
    return { surface, ...handle };
  },
  render() {
    const surface = h("sv-try-on-experience", { ...this.$attrs, ref: "surface" });
    const children = this.$slots["default"]?.();
    return children === globalThis.undefined ? surface : h(Fragment, [surface, ...children]);
  },
});

/** Mount once per shop to share the shopper session and history across its products. */
// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Vue minor releases infer different internal option types. The runtime props and setup handle implement this public contract.
export const StudioVaaiTryOn = component as TryOnComponent;
