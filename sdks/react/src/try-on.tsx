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
import type { ForwardedRef, ReactNode, Ref } from "react";

import { createUiContext } from "@studio-vaai/web-components";
import React from "react";
import { useSyncExternalStore } from "use-sync-external-store/shim";

import { TryOnExperienceContext } from "./try-ons.js";

const {
  createElement,
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} = React;

export interface StudioVaaiTryOnHandle {
  /** Opens the current product when ready. Returns whether the action could be dispatched. */
  open(entry?: TryOnExperienceEntry): boolean;
  close(): void;
}

export type StudioVaaiTryOnProps = (
  | { foreignId: string; productId?: never }
  | { productId: string; foreignId?: never }
) & {
  ref?: Ref<StudioVaaiTryOnHandle>;
  /** Content that can read this dialog’s results with useTryOns. */
  children?: ReactNode;
  api: ClientConfig;
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
  onReadyChange?(ready: boolean): void;
  onEvent?(event: TryOnExperienceEvent, experience: TryOnExperience): void;
  /** Reports a result when its image is shown in the dialog. */
  onTryOnPresented?(detail: TryOnExperienceEventMap["sv-try-on-presented"]): void | Promise<void>;
  /** Add the exact variant to the host cart. Resolving closes the dialog. */
  onAddToCart?: SvTryOnExperience["addToCart"];
  onError?(error: unknown): void;
};

const useCommittedLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/** Mount once per shop to share the shopper session and history across its products. */
export const StudioVaaiTryOn = forwardRef(StudioVaaiTryOnView);

function StudioVaaiTryOnView(
  props: StudioVaaiTryOnProps,
  ref: ForwardedRef<StudioVaaiTryOnHandle>,
) {
  const {
    api: { baseUrl, clientApiKey, clientName },
    productId,
    foreignId,
    productName,
    active = true,
    commerce,
    presentProduct,
    selection,
    locale = "en",
    messages,
    appearance = "light",
    autoStart,
    analytics,
    fetch: fetchImpl,
  } = props;
  const target = useRef<SvTryOnExperience>(null);
  const [experience, setExperience] = useState<TryOnExperience>();
  const installation = useMemo(
    () => ({
      product: foreignId === globalThis.undefined ? productId : { foreignId },
      presentProduct,
      token: typeof window === "undefined" ? globalThis.undefined : crypto.randomUUID(),
    }),
    [productId, foreignId, presentProduct],
  );
  const [bootstrapInstallation, setBootstrapInstallation] = useState<typeof installation>();
  const [bootstrapRevision, setBootstrapRevision] = useState(0);
  const ui = useMemo(() => createUiContext(), []);
  const latestProps = useRef(props);
  const latestInstallation = useRef(installation);
  // Let the long-lived runtime and its listeners read the latest committed props.
  useCommittedLayoutEffect(() => {
    latestProps.current = props;
    latestInstallation.current = installation;
  }, [props, installation]);
  const reportProductError = useCallback(async (error: unknown, signal: AbortSignal) => {
    const { isTryOnProductUnavailable } = await import("@studio-vaai/web-components/experience");
    if (!signal.aborted && !isTryOnProductUnavailable(error)) {
      latestProps.current.onError?.(error);
    }
  }, []);
  const subscribe = useCallback(
    (listener: () => void) => experience?.subscribe(listener) ?? (() => globalThis.undefined),
    [experience],
  );
  const installedToken = useSyncExternalStore(
    subscribe,
    () =>
      installation.product === globalThis.undefined
        ? globalThis.undefined
        : experience?.readyInstallation(installation.product, installation.token),
    () => globalThis.undefined,
  );
  const ready =
    active && experience !== globalThis.undefined && installedToken !== globalThis.undefined;

  useCommittedLayoutEffect(() => {
    experience?.setProductActive(active);
  }, [experience, active]);

  useCommittedLayoutEffect(() => {
    if (ready) {
      experience.updateCommerce(commerce, installedToken);
    }
  }, [experience, installedToken, ready, commerce]);

  useImperativeHandle(
    ref,
    () => ({
      open(entry) {
        if (!ready || experience.failure !== globalThis.undefined) {
          return false;
        }
        return experience.open(entry);
      },
      close() {
        experience?.close();
      },
    }),
    [experience, ready],
  );

  useEffect(() => {
    const root = target.current;
    return root ? ui.attach(root) : globalThis.undefined;
  }, [ui]);

  useEffect(() => {
    ui.configure({ locale, appearance, messages });
  }, [ui, locale, appearance, messages]);

  useEffect(() => {
    const abort = new AbortController();
    let owner: TryOnExperience | undefined;
    setExperience(globalThis.undefined);
    setBootstrapInstallation(globalThis.undefined);
    async function mount() {
      let requested = latestInstallation.current;
      try {
        // Define elements in the browser, then retain one runtime across product navigation.
        const sdk = await import("@studio-vaai/web-components/experience");
        abort.signal.throwIfAborted();
        sdk.defineSvTryOnExperience();
        const product = latestProps.current;
        requested = latestInstallation.current;
        setBootstrapInstallation(requested);
        const { token } = requested;
        if (requested.product === globalThis.undefined) {
          throw new Error("Set a storefront product ID for try-on.");
        }
        const devices = sdk.createBrowserTryOnDevices({
          complete: (event) => owner?.completeDevice(event),
        });
        owner = await sdk.createApiTryOnExperience({
          api: {
            baseUrl,
            clientApiKey,
            ...(clientName !== globalThis.undefined && { clientName }),
          },
          product:
            typeof requested.product === "string"
              ? { productId: requested.product }
              : requested.product,
          ...(token === globalThis.undefined
            ? {}
            : { initialInstallation: { token, active: product.active ?? true } }),
          presentProduct: requested.presentProduct,
          commerce: () =>
            requested === latestInstallation.current
              ? latestProps.current.commerce
              : product.commerce,
          devices,
          ...(autoStart !== globalThis.undefined && { autoStart }),
          ...(fetchImpl !== globalThis.undefined && { fetch: fetchImpl }),
          signal: abort.signal,
        });
        if (abort.signal.aborted) {
          owner.dispose();
        } else {
          setExperience(owner);
        }
      } catch (error) {
        if (!abort.signal.aborted) {
          setBootstrapInstallation(requested);
          if (requested === latestInstallation.current) {
            await reportProductError(error, abort.signal);
          }
        }
      }
    }
    void mount();
    return () => {
      abort.abort();
      owner?.dispose();
    };
  }, [
    baseUrl,
    clientApiKey,
    clientName,
    autoStart,
    fetchImpl,
    bootstrapRevision,
    reportProductError,
  ]);

  useEffect(() => {
    if (
      experience === globalThis.undefined &&
      bootstrapInstallation !== globalThis.undefined &&
      bootstrapInstallation !== installation
    ) {
      setBootstrapInstallation(globalThis.undefined);
      setBootstrapRevision((revision) => revision + 1);
    }
  }, [experience, bootstrapInstallation, installation]);

  useCommittedLayoutEffect(() => {
    const { product, presentProduct, token } = installation;
    if (
      !active ||
      experience === globalThis.undefined ||
      token === globalThis.undefined ||
      product === globalThis.undefined
    ) {
      return;
    }
    if (experience.readyInstallation(product, token) !== globalThis.undefined) {
      return;
    }
    const abort = new AbortController();
    const initialCommerce = latestProps.current.commerce;
    const install = async () => {
      try {
        await experience.installProduct(
          product,
          presentProduct,
          () =>
            latestInstallation.current.token === token
              ? latestProps.current.commerce
              : initialCommerce,
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
    return () => {
      abort.abort();
    };
  }, [active, experience, installation, reportProductError]);

  useCommittedLayoutEffect(() => {
    if (ready && selection !== globalThis.undefined) {
      experience.setSelection(selection);
    }
  }, [experience, installedToken, ready, selection]);

  useEffect(() => {
    latestProps.current.onReadyChange?.(ready);
  }, [ready]);

  useEffect(() => {
    if (!experience) {
      return;
    }
    // oxlint-disable-next-line promise/prefer-await-to-callbacks -- The SDK event feed delivers observers synchronously.
    const stopEvents = experience.subscribeEvents((event) =>
      latestProps.current.onEvent?.(event, experience),
    );
    const stopPresented = experience.subscribeEvents((event): void | Promise<void> => {
      if (event.type === "sv-try-on-presented") {
        return latestProps.current.onTryOnPresented?.(event.detail);
      }
    });
    return () => {
      stopEvents();
      stopPresented();
    };
  }, [experience]);

  useEffect(() => {
    if (!experience || !analytics) {
      return;
    }
    return analytics.observe((listener) => experience.subscribeEvents(listener));
  }, [experience, analytics]);

  useEffect(() => {
    const element = target.current;
    if (element === null || !experience) {
      return;
    }
    element.experience = experience;
    if (installedToken !== globalThis.undefined) {
      element.productName = productName;
    }
    element.addToCart = props.onAddToCart;
    const onError = (event: Event) => {
      if (event instanceof CustomEvent) {
        latestProps.current.onError?.(event.detail);
      }
    };
    element.addEventListener("sv-try-on-experience-error", onError);
    return () => {
      element.removeEventListener("sv-try-on-experience-error", onError);
    };
  }, [experience, installedToken, productName, props.onAddToCart]);

  return createElement(
    TryOnExperienceContext.Provider,
    { value: experience },
    createElement("sv-try-on-experience", { ref: target }),
    props.children,
  );
}
