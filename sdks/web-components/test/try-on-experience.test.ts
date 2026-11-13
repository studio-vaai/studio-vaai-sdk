import {
  AutoStartPolicy,
  AxisRole,
  PhotoAction,
  AxisPlacement,
  AxisControl,
  BodyJob,
  BodyOutcome,
  CameraAction,
  DeviceError,
  Fit,
  SelectionAction,
  TryOnRequestStatus,
  TryOnRequestFailure,
  PhotoRejection,
  RefusalReason,
  BackendError,
  CameraEffect,
  CameraEvent,
  CameraState,
  Capability,
  DeviceEffect,
  DeviceEvent,
  DisplayedImage,
  FlowAction,
  HeightAction,
  BodyState,
  bodyHeight,
  bodyIdentity,
  HeightStatus,
  ItemDisplay,
  Issue,
  Modal,
  NavigationAction,
  NewPhotoStatus,
  Job,
  Outcome,
  PhotoOutcome,
  PickerEffect,
  PickerEvent,
  PhotoSource,
  PresenceAction,
  PresentationAction,
  PresentationMode,
  ScreenView,
  SessionJob,
  SessionOutcome,
  SessionPhase,
  SizeRecommendationAction,
  SizeRecommendationOutcome,
  TryOnOutcome,
  TryOnError,
} from "@studio-vaai/core";
import { ApiClient, ApiError, browserTransport } from "@studio-vaai/core/api";
import { describe, expect, it, vi } from "vitest";

import type {
  PresentProduct,
  TryOnExperienceAdapters,
  TryOnExperienceEvent,
} from "../src/experience/index.js";

import { bodySelectionStore } from "../src/experience/api/body-selection.js";
import { ApiSessionOutcomeError } from "../src/experience/api/outcomes.js";
import { apiSession } from "../src/experience/api/session.js";
import { createBrowserTryOnDevices } from "../src/experience/browser/devices.js";
// @vitest-environment jsdom
import {
  createApiTryOnExperience,
  defineSvTryOnExperience,
  ImageFetchError,
  isTryOnProductUnavailable,
  TryOnExperience,
} from "../src/experience/index.js";
import { initializeTestUi } from "./ui-fixture.js";

function stubDialogMethods() {
  // JSDOM has no native modal methods.
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value(this: HTMLDialogElement) {
      this.open = true;
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, "close", {
    configurable: true,
    value(this: HTMLDialogElement) {
      this.open = false;
      this.dispatchEvent(new Event("close"));
    },
  });
}

async function rendered<K extends keyof HTMLElementTagNameMap>(
  host: HTMLElement & { updateComplete: Promise<boolean> },
  tag: K,
  selector: string = tag,
): Promise<HTMLElementTagNameMap[K]> {
  await host.updateComplete;
  const child = host.shadowRoot?.querySelector<HTMLElementTagNameMap[K]>(selector);
  if (!child) {
    throw new Error(`Could not find ${selector} in ${host.localName}`);
  }
  if ("updateComplete" in child) {
    await child.updateComplete;
  }
  return child;
}

async function renderedAfterUpdate<K extends keyof HTMLElementTagNameMap>(
  host: HTMLElement & { updateComplete: Promise<boolean> },
  tag: K,
): Promise<HTMLElementTagNameMap[K]> {
  return await vi.waitFor(async () => await rendered(host, tag));
}

async function press(
  host: HTMLElement & { updateComplete: Promise<boolean> },
  selector: string,
): Promise<void> {
  const button = await rendered(host, "sv-button", selector);
  const control = button.shadowRoot?.querySelector("button");
  expect(control?.disabled).toBe(false);
  control?.click();
}

async function settleResultImage(
  screen: HTMLElementTagNameMap["sv-try-on-view-screen"],
  state: "load" | "error" = "load",
): Promise<void> {
  const image = await resultImage(screen);
  const picture = image.shadowRoot?.querySelector("img");
  expect(picture).toBeDefined();
  picture?.dispatchEvent(new Event(state));
}

async function resultImage(screen: HTMLElementTagNameMap["sv-try-on-view-screen"]) {
  await screen.updateComplete;
  return await rendered(
    screen,
    "sv-image",
    screen.shadowRoot?.querySelector("sv-image[data-pending]")
      ? "sv-image[data-pending]"
      : "sv-image[data-result]",
  );
}

function deferred<T>() {
  let complete!: (value: T) => void;
  let fail!: (reason: unknown) => void;
  // oxlint-disable-next-line promise/avoid-new -- The test releases an in-flight request explicitly.
  const promise = new Promise<T>((resolve, reject) => {
    complete = resolve;
    fail = reject;
  });
  return { promise, resolve: complete, reject: fail };
}

async function mountWithAdapters({
  height = 170,
  run,
  startDeviceEffect,
  restore = true,
  choosePhoto,
  recommend,
  autoStart = AutoStartPolicy.Never,
  missingCookie = false,
  open = true,
}: {
  height?: number | null;
  run?: TryOnExperienceAdapters["runJob"];
  startDeviceEffect?: TryOnExperienceAdapters["startDeviceEffect"];
  restore?: boolean;
  recommend?: Outcome | ((variantId: string) => Outcome | Promise<Outcome>);
  autoStart?: AutoStartPolicy;
  missingCookie?: boolean;
  open?: boolean;
  choosePhoto?: (token: string) => DeviceEvent | Promise<DeviceEvent> | undefined;
} = {}) {
  await initializeTestUi();
  defineSvTryOnExperience();
  stubDialogMethods();
  const variantId = crypto.randomUUID();
  const productId = crypto.randomUUID();
  const originalMedia = crypto.randomUUID();
  const replacementMedia = crypto.randomUUID();
  const getPhoto = (id: string) => ({
    src: id === originalMedia ? "/original.jpg" : "/replacement.jpg",
  });
  const experience = await TryOnExperience.create(
    {
      hostProduct: {
        product: {
          id: productId,
          variants: [{ id: variantId, foreignIds: new Map([["size", "M"]]) }],
        },
        axes: [
          {
            key: "size",
            role: AxisRole.Size,
            items: [{ key: "M", display: new ItemDisplay.Text({ text: "M" }) }],
          },
        ],
        labelFormats: [],
        chosenAxes: typeof recommend === "function" ? [] : ["size"],
        variantId,
      },
      autoStart,
    },
    {
      runJob(job, operation): ReturnType<TryOnExperienceAdapters["runJob"]> {
        if (Job.Session.instanceOf(job)) {
          const task = job.inner.job;
          if (SessionJob.Restore.instanceOf(task)) {
            if (!restore && !missingCookie) {
              return new Outcome.Session({ outcome: new SessionOutcome.Absent() });
            }
            if (missingCookie) {
              return new Outcome.SessionExpired();
            }
            return new Outcome.Session({
              outcome: new SessionOutcome.Restored({
                body: {
                  bodyId: crypto.randomUUID(),
                  media: originalMedia,
                  source: PhotoSource.Library,
                  estimatedHeight: 172,
                  ...(height !== null && { height }),
                },
              }),
            });
          }
          return (
            run?.(job, operation) ?? new Outcome.Session({ outcome: new SessionOutcome.Ready() })
          );
        }
        if (Job.SizeRecommendation.instanceOf(job)) {
          if (recommend !== undefined) {
            return typeof recommend === "function" ? recommend(variantId) : recommend;
          }
          return new Outcome.SizeRecommendation({
            outcome: new SizeRecommendationOutcome.Fetched({ scores: [] }),
          });
        }
        return run?.(job, operation) ?? new Outcome.Failed({ error: BackendError.Internal });
      },
      startDeviceEffect(effect): ReturnType<TryOnExperienceAdapters["startDeviceEffect"]> {
        if (
          DeviceEffect.Picker.instanceOf(effect) &&
          PickerEffect.Open.instanceOf(effect.inner.effect)
        ) {
          if (choosePhoto !== undefined) {
            return choosePhoto(effect.inner.effect.inner.token);
          }
          return new DeviceEvent.Picker({
            event: new PickerEvent.Selected({
              token: effect.inner.effect.inner.token,
              media: replacementMedia,
            }),
          });
        }
        return startDeviceEffect?.(effect);
      },
      applyDomainEffect: vi.fn<TryOnExperienceAdapters["applyDomainEffect"]>(),
      getCamera: () => globalThis.undefined,
      getPhoto,
      dispose: vi.fn<() => void>(),
    },
  );
  const element = document.createElement("sv-try-on-experience");
  element.experience = experience;
  document.body.append(element);
  await vi.waitFor(() => {
    expect(experience.view.domain.session).toBe(restore ? SessionPhase.Ready : SessionPhase.Absent);
  });
  const events: TryOnExperienceEvent[] = [];
  experience.subscribeEvents((event) => {
    events.push(event);
  });
  if (open) {
    experience.open();
  }
  await element.updateComplete;
  return {
    experience,
    element,
    events,
    variantId,
    replacementMedia,
    dispose: () => {
      element.remove();
      experience.dispose();
    },
  };
}

describe("web try-on experience", () => {
  it.each([null, 170])(
    "shows the failed replacement and can keep the original photo at height %s",
    async (height) => {
      const fixture = await mountWithAdapters({
        height,
        run: () => new Outcome.Failed({ error: BackendError.InvalidRequest }),
      });
      const { experience, element } = fixture;
      try {
        const screen =
          height === null
            ? await rendered(element, "sv-height-setting-screen")
            : await rendered(element, "sv-try-on-view-screen");
        await press(screen, 'sv-button[slot="secondary"]');
        await chooseLibrary(element);
        await vi.waitFor(() => {
          expect(experience.view.photoChange?.newPhoto?.photo.media).toBe(fixture.replacementMedia);
        });
        const recovery = await rendered(element, "sv-screen");
        const image = recovery.querySelector("sv-image");
        expect(image?.src).toBe("/replacement.jpg");
        expect(recovery.textContent).toContain("could not be read");
        expect(recovery.textContent).not.toContain("Retry upload");
        await pressBack(await rendered(element, "sv-screen"));
        expect(experience.view.photoChange).toBeUndefined();
        const returned =
          height === null
            ? await rendered(element, "sv-height-setting-screen")
            : await rendered(element, "sv-try-on-view-screen");
        expect(returned.photoSrc).toBe("/original.jpg");
      } finally {
        fixture.dispose();
      }
    },
  );

  it("stops spinning on an uncertain render and replaces the body through the UI", async () => {
    const fixture = await mountWithAdapters({
      run: (job) =>
        Job.TryOn.instanceOf(job)
          ? new Outcome.Unknown()
          : new Outcome.Photo({
              outcome: new PhotoOutcome.Accepted({
                bodyId: crypto.randomUUID(),
                estimatedHeight: 178,
              }),
            }),
    });
    const { experience, element, events } = fixture;
    try {
      const screen = await rendered(element, "sv-try-on-view-screen");
      await press(screen, 'sv-button[slot="primary"]');
      await vi.waitFor(() => {
        expect(screen.textContent).toContain("could not confirm the try-on result");
      });
      expect(screen.state).toBe("ready");
      expect(screen.requestPending).toBe(false);
      const shell = await rendered(screen, "sv-screen");
      expect(shell.shadowRoot?.querySelector<HTMLButtonElement>("button.back")?.disabled).toBe(
        false,
      );
      await pressBack(shell);
      await press(screen, 'sv-button[slot="secondary"]');
      await chooseLibrary(element);
      await vi.waitFor(() => {
        expect(ScreenView.Height.instanceOf(experience.view.screen)).toBe(true);
      });
      expect(experience.view.domain.uncertainTryOn).toBe(false);
      expect(
        events.find(({ type }) => type === "sv-try-on-operation-uncertain")?.detail,
      ).toMatchObject({ work: "try-on", step: "variant-selection" });
    } finally {
      fixture.dispose();
    }
  });

  it("finishes a render in the background and reports it as presented only after reopening", async () => {
    const pending = deferred<Outcome>();
    const fixture = await mountWithAdapters({ run: async () => await pending.promise });
    const { experience, element, events } = fixture;
    try {
      const screen = await rendered(element, "sv-try-on-view-screen");
      await press(screen, 'sv-button[slot="primary"]');
      await vi.waitFor(() => {
        expect(screen.state).toBe("generating");
      });
      const shell = await rendered(screen, "sv-screen");
      shell.shadowRoot?.querySelector<HTMLButtonElement>("button.close")?.click();
      expect(experience.view.presence.open).toBe(false);
      const tryOnId = crypto.randomUUID();
      pending.resolve(
        new Outcome.TryOn({
          outcome: new TryOnOutcome.Created({
            tryOnId,
            imageUrl: "/result.webp",
          }),
        }),
      );
      await vi.waitFor(() => {
        expect(events.some(({ type }) => type === "sv-try-on-rendered")).toBe(true);
      });
      expect(events.some(({ type }) => type === "sv-try-on-presented")).toBe(false);
      experience.open();
      expect(events.some(({ type }) => type === "sv-try-on-presented")).toBe(false);
      await settleResultImage(screen);
      await element.updateComplete;
      expect(events.filter(({ type }) => type === "sv-try-on-presented")).toEqual([
        expect.objectContaining({ detail: expect.objectContaining({ tryOnId }) }),
      ]);
    } finally {
      fixture.dispose();
    }
  });

  it("retains failed upload recovery when an earlier render fails", async () => {
    const render = deferred<Outcome>();
    const upload = deferred<Outcome>();
    const { experience, element, dispose } = await mountWithAdapters({
      run: async (job) => await (Job.TryOn.instanceOf(job) ? render.promise : upload.promise),
    });
    try {
      const screen = await rendered(element, "sv-try-on-view-screen");
      await press(screen, 'sv-button[slot="primary"]');
      await press(screen, 'sv-button[slot="secondary"]');
      await chooseLibrary(element);
      upload.resolve(new Outcome.Failed({ error: BackendError.Unavailable }));
      await vi.waitFor(() => {
        expect(
          NewPhotoStatus.Failed.instanceOf(experience.view.photoChange?.newPhoto?.status),
        ).toBe(true);
      });
      const staged = await rendered(element, "sv-screen");
      expect(staged.textContent).toContain("Retry upload");
      render.resolve(new Outcome.Failed({ error: BackendError.Internal }));
      await vi.waitFor(() => {
        expect(
          experience.view.domain.tryOnRequests.some(({ status }) =>
            TryOnRequestStatus.Failed.instanceOf(status),
          ),
        ).toBe(true);
        expect(Issue.PhotoFailed.instanceOf(experience.view.issue)).toBe(true);
      });
      await element.updateComplete;
      expect(staged.textContent).toContain("Retry upload");
      expect(staged.textContent).not.toContain("Cancel photo change");
      await pressBack(staged);
      expect(experience.view.photoChange).toBeUndefined();
    } finally {
      dispose();
    }
  });

  it("treats an unconfirmed session creation as failed and creates again from a photo source", async () => {
    let creations = 0;
    const { experience, element, dispose } = await mountWithAdapters({
      restore: false,
      run: () => {
        creations += 1;
        return new Outcome.Unknown();
      },
    });
    try {
      const intro = await rendered(element, "sv-session-intro-screen");
      const checkbox = await rendered(intro, "sv-checkbox");
      checkbox.shadowRoot?.querySelector("button")?.click();
      await press(intro, 'sv-button[slot="secondary"]');
      await vi.waitFor(() => {
        expect(experience.view.domain.session).toBe(SessionPhase.CreateFailed);
      });
      expect(experience.view.domain.uncertainOperations).toHaveLength(0);
      const recovery = await rendered(element, "sv-session-intro-screen");
      await recovery.updateComplete;
      expect(recovery.querySelector("sv-button[slot='primary']")).toBeNull();
      await press(recovery, 'sv-button[slot="secondary"]');
      await vi.waitFor(() => {
        expect(creations).toBe(2);
      });
    } finally {
      dispose();
    }
  });

  it("holds a native picker selection while the tab is hidden and sends it on return", async () => {
    const pending = deferred<DeviceEvent>();
    let token = "";
    const upload = deferred<Outcome>();
    const run = vi.fn<TryOnExperienceAdapters["runJob"]>(async () => await upload.promise);
    const { experience, element, replacementMedia, dispose } = await mountWithAdapters({
      run,
      choosePhoto: async (current) => {
        token = current;
        return await pending.promise;
      },
    });
    const visibility = vi.spyOn(document, "visibilityState", "get");
    try {
      await press(await rendered(element, "sv-try-on-view-screen"), 'sv-button[slot="secondary"]');
      await chooseLibrary(element);
      expect(Modal.Picker.instanceOf(experience.view.modal)).toBe(true);
      visibility.mockReturnValue("hidden");
      document.dispatchEvent(new Event("visibilitychange"));
      expect(Modal.Picker.instanceOf(experience.view.modal)).toBe(true);
      pending.resolve(
        new DeviceEvent.Picker({
          event: new PickerEvent.Selected({ token, media: replacementMedia }),
        }),
      );
      await vi.waitFor(() => {
        expect(
          NewPhotoStatus.Staged.instanceOf(experience.view.photoChange?.newPhoto?.status),
        ).toBe(true);
      });
      expect(run).not.toHaveBeenCalled();
      visibility.mockReturnValue("visible");
      document.dispatchEvent(new Event("visibilitychange"));
      expect(run).toHaveBeenCalledOnce();
    } finally {
      visibility.mockRestore();
      dispose();
    }
  });

  it.each(["picker-cancel", "close"] as const)(
    "applies a deferred height error on %s",
    async (ending) => {
      const height = deferred<Outcome>();
      const picker = deferred<DeviceEvent>();
      let token = "";
      const { experience, element, dispose } = await mountWithAdapters({
        height: null,
        run: async () => await height.promise,
        choosePhoto: async (current) => {
          token = current;
          return await picker.promise;
        },
      });
      try {
        await press(
          await rendered(element, "sv-height-setting-screen"),
          'sv-button[slot="primary"]',
        );
        await press(
          await rendered(element, "sv-try-on-view-screen"),
          'sv-button[slot="secondary"]',
        );
        await chooseLibrary(element);
        expect(Modal.Picker.instanceOf(experience.view.modal)).toBe(true);
        height.resolve(new Outcome.Failed({ error: BackendError.Internal }));
        await vi.waitFor(() => {
          expect(HeightStatus.Unset.instanceOf(bodyHeight(experience.view.domain.body))).toBe(true);
        });
        if (ending === "close") {
          experience.close();
          experience.open();
        } else {
          experience.dispatch(new FlowAction.Presence({ action: PresenceAction.Suspend }));
          picker.resolve(new DeviceEvent.Picker({ event: new PickerEvent.Cancelled({ token }) }));
          await vi.waitFor(() => {
            expect(experience.view.modal).toBeUndefined();
          });
          experience.dispatch(new FlowAction.Presence({ action: PresenceAction.Resume }));
        }
        expect(Issue.SetHeightFailed.instanceOf(experience.view.issue)).toBe(true);
        const screen = await rendered(element, "sv-height-setting-screen");
        expect(screen.error).toContain("height");
      } finally {
        dispose();
      }
    },
  );

  it("clears a previous no-size result while a new height is saving", async () => {
    const height = deferred<Outcome>();
    const { experience, element, dispose } = await mountWithAdapters({
      run: async () => await height.promise,
      recommend: new Outcome.SizeRecommendation({
        outcome: new SizeRecommendationOutcome.Ranked({
          scores: [],
          restrictions: [],
          preferred: [],
          noSuitableSize: true,
        }),
      }),
    });
    try {
      const initial = await rendered(element, "sv-try-on-view-screen");
      await vi.waitFor(() => {
        expect(initial.textContent).toContain("No size is available");
      });
      editHeight(experience);
      experience.dispatch(
        new FlowAction.Height({ action: new HeightAction.Edit({ height: 180 }) }),
      );
      experience.dispatch(new FlowAction.Height({ action: new HeightAction.Confirm() }));
      const screen = await rendered(element, "sv-try-on-view-screen");
      expect(HeightStatus.Pending.instanceOf(bodyHeight(experience.view.domain.body))).toBe(true);
      expect(screen.textContent).not.toContain("No size is available");
      expect(Capability.Available.instanceOf(screen.presentation?.canRequestTryOn)).toBe(true);
    } finally {
      dispose();
    }
  });

  it("isolates throwing view subscribers and waits for a usable image before exposing result actions", async () => {
    const work = deferred<Outcome>();
    const { experience, element, events, dispose } = await mountWithAdapters({
      run: async () => await work.promise,
    });
    const unsubscribe = experience.subscribe(() => {
      throw new Error("Host subscriber failed");
    });
    try {
      const screen = await rendered(element, "sv-try-on-view-screen");
      await press(screen, 'sv-button[slot="primary"]');
      const tryOnId = crypto.randomUUID();
      work.resolve(
        new Outcome.TryOn({
          outcome: new TryOnOutcome.Created({ tryOnId, imageUrl: "/result.webp" }),
        }),
      );
      await vi.waitFor(() => {
        expect(screen.tryOns[0]?.id).toBe(tryOnId);
      });
      expect(experience.failure).toBeUndefined();
      const image = await rendered(screen, "sv-image", "sv-image[data-result]");
      const firstImage = image.shadowRoot?.querySelector("img");
      await settleResultImage(screen, "error");
      await vi.waitFor(async () => {
        const retry = await resultImage(screen);
        expect(retry.shadowRoot?.querySelector("img")).not.toBe(firstImage);
      });
      await settleResultImage(screen, "error");
      await element.updateComplete;
      expect(screen.textContent).toContain("The try-on image could not be loaded.");
      expect(screen.shadowRoot?.querySelector("sv-button.download")).toBeNull();
      expect(events.some(({ type }) => type === "sv-try-on-presented")).toBe(false);
      expect(screen.textContent).not.toContain("Reload image");
      await settleResultImage(screen);
      await element.updateComplete;
      expect(events.filter(({ type }) => type === "sv-try-on-presented")).toHaveLength(1);
      expect(screen.shadowRoot?.querySelector("sv-button.download")).not.toBeNull();
      const cart = await rendered(screen, "sv-button", 'sv-button[slot="secondary"]');
      expect(cart.disabled).toBe(true);
    } finally {
      unsubscribe();
      dispose();
    }
  });

  it("only announces an open when the tab can show the dialog", async () => {
    const { experience, element, events, dispose } = await mountWithAdapters();
    const visibility = vi.spyOn(document, "visibilityState", "get");
    try {
      experience.close();
      const previous = events.filter(({ type }) => type === "sv-try-on-opened").length;
      visibility.mockReturnValue("hidden");
      document.dispatchEvent(new Event("visibilitychange"));
      experience.open({ entry: "storefront" });
      const dialog = await rendered(element, "sv-dialog");
      expect(dialog.open).toBe(false);
      expect(events.filter(({ type }) => type === "sv-try-on-opened")).toHaveLength(previous);
      visibility.mockReturnValue("visible");
      document.dispatchEvent(new Event("visibilitychange"));
      await element.updateComplete;
      await dialog.updateComplete;
      expect(dialog.open).toBe(true);
      const opened = events.filter(({ type }) => type === "sv-try-on-opened");
      expect(opened).toHaveLength(previous + 1);
      expect(opened.at(-1)?.detail.entry).toBe("storefront");
    } finally {
      visibility.mockRestore();
      dispose();
    }
  });

  it("can choose a library photo while the camera permission prompt is pending", async () => {
    const picker = vi.fn<(token: string) => undefined>(() => globalThis.undefined);
    const { experience, element, dispose } = await mountWithAdapters({
      restore: false,
      choosePhoto: picker,
    });
    try {
      const intro = await rendered(element, "sv-session-intro-screen");
      const checkbox = await rendered(intro, "sv-checkbox");
      checkbox.shadowRoot?.querySelector("button")?.click();
      await press(intro, 'sv-button[slot="secondary"]');
      const camera = await rendered(element, "sv-photo-capture-screen");
      expect(camera.state).toBe("permission");
      expect(camera.busy).toBe(true);
      await press(camera, 'sv-button[slot="secondary"]');
      expect(picker).toHaveBeenCalledOnce();
      expect(Modal.Picker.instanceOf(experience.view.modal)).toBe(true);
    } finally {
      dispose();
    }
  });

  it("does not offer a repeat render for a permanently failed variant and body", async () => {
    const run = vi.fn<TryOnExperienceAdapters["runJob"]>(
      () => new Outcome.Failed({ error: BackendError.InvalidRequest }),
    );
    const { element, dispose } = await mountWithAdapters({ run });
    try {
      const screen = await rendered(element, "sv-try-on-view-screen");
      await press(screen, 'sv-button[slot="primary"]');
      await vi.waitFor(() => {
        expect(screen.state).toBe("error");
      });
      expect(screen.retryVariantId).toBeUndefined();
      const primary = await rendered(screen, "sv-button", 'sv-button[slot="primary"]');
      expect(primary.disabled).toBe(true);
      expect(run).toHaveBeenCalledOnce();
    } finally {
      dispose();
    }
  });

  it("releases the camera when hidden and reacquires it on resume", async () => {
    const acquire = vi.fn<() => void>();
    const release = vi.fn<() => void>();
    const fixture = await mountWithAdapters({
      restore: false,
      startDeviceEffect(effect) {
        if (DeviceEffect.Camera.instanceOf(effect)) {
          const camera = effect.inner.effect;
          if (CameraEffect.Acquire.instanceOf(camera)) {
            acquire();
            return new DeviceEvent.Camera({
              event: new CameraEvent.Acquired({
                token: camera.inner.token,
                lease: crypto.randomUUID(),
              }),
            });
          }
          if (CameraEffect.Release.instanceOf(camera)) {
            release();
          }
        }
        return globalThis.undefined;
      },
    });
    const visibility = vi.spyOn(document, "visibilityState", "get");
    const { experience, element } = fixture;
    try {
      const intro = await rendered(element, "sv-session-intro-screen");
      const checkbox = await rendered(intro, "sv-checkbox");
      checkbox.shadowRoot?.querySelector("button")?.click();
      await press(intro, 'sv-button[slot="secondary"]');
      await vi.waitFor(() => {
        const { screen } = experience.view;
        expect(
          ScreenView.Camera.instanceOf(screen) && CameraState.Live.instanceOf(screen.inner.camera),
        ).toBe(true);
      });
      visibility.mockReturnValue("hidden");
      document.dispatchEvent(new Event("visibilitychange"));
      expect(experience.view.presence.foreground).toBe(false);
      expect(release).toHaveBeenCalledOnce();
      const hidden = await rendered(element, "sv-dialog");
      expect(hidden.open).toBe(false);
      visibility.mockReturnValue("visible");
      document.dispatchEvent(new Event("visibilitychange"));
      expect(acquire).toHaveBeenCalledTimes(2);
      const visible = await rendered(element, "sv-dialog");
      expect(visible.open).toBe(true);
    } finally {
      visibility.mockRestore();
      fixture.dispose();
    }
  });

  it("auto-starts the explicit variant on the first visit without a session cookie", async () => {
    const render = vi.fn<() => void>();
    const { element, experience, dispose } = await mountWithAdapters({
      restore: false,
      missingCookie: true,
      autoStart: AutoStartPolicy.ExplicitPreselection,
      run(job) {
        if (Job.Session.instanceOf(job)) {
          return new Outcome.Session({ outcome: new SessionOutcome.Ready() });
        }
        if (Job.Photo.instanceOf(job)) {
          return new Outcome.Photo({
            outcome: new PhotoOutcome.Accepted({
              bodyId: crypto.randomUUID(),
              estimatedHeight: 170,
            }),
          });
        }
        if (Job.Body.instanceOf(job)) {
          return new Outcome.Body({ outcome: BodyOutcome.HeightSet });
        }
        render();
        return new Outcome.Failed({ error: BackendError.Internal });
      },
    });
    try {
      const intro = await rendered(element, "sv-session-intro-screen");
      const checkbox = await rendered(intro, "sv-checkbox");
      checkbox.shadowRoot?.querySelector("button")?.click();
      experience.dispatch(new FlowAction.Presence({ action: PresenceAction.Suspend }));
      experience.dispatch(new FlowAction.Presence({ action: PresenceAction.Resume }));
      await press(intro, 'sv-button[slot="primary"]');
      await press(
        await renderedAfterUpdate(element, "sv-height-setting-screen"),
        'sv-button[slot="primary"]',
      );
      await vi.waitFor(() => {
        expect(render).toHaveBeenCalledOnce();
      });
    } finally {
      dispose();
    }
  });

  it("preserves the pending height status and prevents a queued render after a stock change", async () => {
    const height = deferred<Outcome>();
    const run = vi.fn<TryOnExperienceAdapters["runJob"]>(async () => await height.promise);
    const { experience, element, variantId, dispose } = await mountWithAdapters({
      height: null,
      run,
    });
    try {
      await press(await rendered(element, "sv-height-setting-screen"), 'sv-button[slot="primary"]');
      const screen = await rendered(element, "sv-try-on-view-screen");
      await pressBack(await rendered(screen, "sv-screen"));
      const heightScreen = await rendered(element, "sv-height-setting-screen");
      expect(heightScreen.statusMessage).toContain("Saving your height");
      await press(heightScreen, 'sv-button[slot="primary"]');
      await press(await rendered(element, "sv-try-on-view-screen"), 'sv-button[slot="primary"]');
      experience.setUnavailableVariants([variantId]);
      await element.updateComplete;
      height.resolve(new Outcome.Body({ outcome: BodyOutcome.HeightSet }));
      await vi.waitFor(() => {
        expect(HeightStatus.Acknowledged.instanceOf(bodyHeight(experience.view.domain.body))).toBe(
          true,
        );
      });
      expect(
        experience.view.domain.tryOnRequests.some(({ status }) =>
          TryOnRequestStatus.Failed.instanceOf(status),
        ),
      ).toBe(true);
      expect(run.mock.calls.some(([job]) => Job.TryOn.instanceOf(job))).toBe(false);
    } finally {
      dispose();
    }
  });

  it("keeps admission recovery visible after navigation and treats an empty render URL as retryable", async () => {
    const { element, experience, dispose } = await mountWithAdapters({
      run: vi
        .fn<TryOnExperienceAdapters["runJob"]>()
        .mockReturnValueOnce(
          new Outcome.TryOn({
            outcome: new TryOnOutcome.Created({
              tryOnId: crypto.randomUUID(),
              imageUrl: "",
            }),
          }),
        )
        .mockReturnValue(new Outcome.Failed({ error: BackendError.InvalidRequest })),
    });
    try {
      const screen = await rendered(element, "sv-try-on-view-screen");
      await press(screen, 'sv-button[slot="primary"]');
      await vi.waitFor(() => {
        expect(screen.state).toBe("error");
      });
      expect(experience.failure).toBeUndefined();
      expect(screen.retryVariantId).toBeDefined();
      await press(screen, 'sv-button[slot="primary"]');
      await vi.waitFor(() => {
        expect(screen.retryVariantId).toBeUndefined();
      });
      await pressBack(await rendered(screen, "sv-screen"));
      await press(await rendered(element, "sv-height-setting-screen"), 'sv-button[slot="primary"]');
      const returned = await rendered(element, "sv-try-on-view-screen");
      expect(returned.error).toBeDefined();
      const changePhoto = await rendered(returned, "sv-button", 'sv-button[slot="secondary"]');
      expect(changePhoto.textContent).toContain("Use a different photo");
    } finally {
      dispose();
    }
  });

  it("keeps the recommendation available across reattachment", async () => {
    const { element, experience, events, dispose } = await mountWithAdapters({
      recommend: (id) =>
        new Outcome.SizeRecommendation({
          outcome: new SizeRecommendationOutcome.Ranked({
            scores: [{ variantIds: [id], aggregate: { fit: Fit.Ideal, fitMatch: 0.9 }, axes: [] }],
            preferred: [id],
            restrictions: [],
            noSuitableSize: false,
          }),
        }),
    });
    const visibility = vi.spyOn(document, "visibilityState", "get");
    try {
      const screen = await rendered(element, "sv-try-on-view-screen");
      const picker = await rendered(screen, "sv-variant-picker");
      await vi.waitFor(() => {
        expect(picker.shadowRoot?.textContent).toContain("Recommended");
      });
      expect(screen.selection?.chosenAxes).toEqual([]);
      picker.shadowRoot?.querySelector<HTMLButtonElement>("button.recommendation")?.click();
      await vi.waitFor(() => {
        expect(screen.selection?.chosenAxes).toEqual(["size"]);
      });
      expect(screen.textContent).not.toContain("Dismiss size recommendation");
      const stepCount = events.filter(({ type }) => type === "sv-try-on-step-changed").length;
      visibility.mockReturnValue("hidden");
      document.dispatchEvent(new Event("visibilitychange"));
      element.remove();
      visibility.mockReturnValue("visible");
      document.body.append(element);
      const dialog = await rendered(element, "sv-dialog");
      expect(dialog.open).toBe(true);
      expect(experience.view.presence.foreground).toBe(true);
      expect(picker.shadowRoot?.textContent).toContain("Recommended");
      expect(events.filter(({ type }) => type === "sv-try-on-step-changed")).toHaveLength(
        stepCount,
      );
    } finally {
      visibility.mockRestore();
      dispose();
    }
  });

  it("reports camera permission denial and releases a live camera on detachment", async () => {
    let acquired = false;
    const release = vi.fn<() => void>();
    const { element, events, experience, dispose } = await mountWithAdapters({
      restore: false,
      startDeviceEffect(effect) {
        if (DeviceEffect.Camera.instanceOf(effect)) {
          const camera = effect.inner.effect;
          if (CameraEffect.Acquire.instanceOf(camera)) {
            const { token } = camera.inner;
            if (!acquired) {
              acquired = true;
              return new DeviceEvent.Camera({
                event: new CameraEvent.AcquireFailed({
                  token,
                  error: DeviceError.PermissionDenied,
                }),
              });
            }
            return new DeviceEvent.Camera({
              event: new CameraEvent.Acquired({ token, lease: crypto.randomUUID() }),
            });
          }
          if (CameraEffect.Release.instanceOf(camera)) {
            release();
          }
        }
        return globalThis.undefined;
      },
    });
    try {
      const intro = await rendered(element, "sv-session-intro-screen");
      const checkbox = await rendered(intro, "sv-checkbox");
      checkbox.shadowRoot?.querySelector("button")?.click();
      await press(intro, 'sv-button[slot="secondary"]');
      const camera = await rendered(element, "sv-photo-capture-screen");
      await vi.waitFor(() => {
        expect(camera.state).toBe("denied");
      });
      expect(events).toContainEqual(
        expect.objectContaining({
          type: "sv-try-on-camera-failed",
          detail: expect.objectContaining({ phase: "acquire", reason: "permission-denied" }),
        }),
      );
      await press(camera, 'sv-button[slot="primary"]');
      await vi.waitFor(() => {
        expect(camera.state).toBe("live");
      });
      element.remove();
      expect(release).toHaveBeenCalledOnce();
      expect(experience.view.presence.foreground).toBe(false);
    } finally {
      dispose();
    }
  });

  it("detaches a render from its original product without blocking a new product", async () => {
    const pending = deferred<Outcome>();
    const { experience, element, events, dispose } = await mountWithAdapters({
      run: async () => await pending.promise,
    });
    try {
      const original = experience.view.domain.product?.id;
      const screen = await rendered(element, "sv-try-on-view-screen");
      await press(screen, 'sv-button[slot="primary"]');
      await vi.waitFor(() => {
        expect(screen.state).toBe("generating");
      });
      experience.close();
      const id = crypto.randomUUID();
      const variantId = crypto.randomUUID();
      experience.dispatch(
        new FlowAction.Selection({
          action: new SelectionAction.HostProductUpdated({
            hostProduct: {
              product: { id, variants: [{ id: variantId, foreignIds: new Map([["size", "L"]]) }] },
              axes: [
                {
                  key: "size",
                  role: AxisRole.Size,
                  items: [{ key: "L", display: new ItemDisplay.Text({ text: "L" }) }],
                },
              ],
              variantId,
              chosenAxes: ["size"],
              labelFormats: [],
            },
          }),
        }),
      );
      experience.open();
      const detached = events.find(({ type }) => type === "sv-try-on-detached");
      expect(detached?.detail.productId).toBe(original);
      expect(detached?.type === "sv-try-on-detached" && detached.detail.stage).toBe("rendering");
      pending.resolve(new Outcome.Unknown());
      // Nobody holds the render any more, so its unknown outcome drops it.
      await vi.waitFor(() => {
        expect(
          experience.view.domain.tryOnRequests.every((request) =>
            TryOnRequestStatus.Cancelled.instanceOf(request.status),
          ),
        ).toBe(true);
      });
      expect(events.some(({ type }) => type === "sv-try-on-operation-uncertain")).toBe(false);
      const newProduct = await rendered(element, "sv-try-on-view-screen");
      expect(Capability.Available.instanceOf(newProduct.presentation?.canRequestTryOn)).toBe(true);
      expect(experience.view.domain.uncertainTryOn).toBe(false);
    } finally {
      dispose();
    }
  });

  it("keeps the currently displayed result open after a cart callback for an earlier result", async () => {
    const cart = deferred<boolean>();
    const completed = vi.fn<() => void>();
    const first = crypto.randomUUID();
    const second = crypto.randomUUID();
    const { experience, element, dispose } = await mountWithAdapters({
      run(job) {
        if (Job.Body.instanceOf(job)) {
          return new Outcome.Body({ outcome: BodyOutcome.HeightSet });
        }
        const tryOnId = completed.mock.calls.length === 0 ? first : second;
        completed();
        return new Outcome.TryOn({
          outcome: new TryOnOutcome.Created({ tryOnId, imageUrl: `/${tryOnId}.webp` }),
        });
      },
    });
    try {
      const add = vi.fn<() => Promise<void>>(async () => {
        await cart.promise;
      });
      element.addToCart = add;
      const screen = await rendered(element, "sv-try-on-view-screen");
      await press(screen, 'sv-button[slot="primary"]');
      await vi.waitFor(() => {
        expect(screen.tryOns[0]?.id).toBe(first);
      });
      editHeight(experience);
      experience.dispatch(
        new FlowAction.Height({ action: new HeightAction.Edit({ height: 180 }) }),
      );
      await press(await rendered(element, "sv-height-setting-screen"), 'sv-button[slot="primary"]');
      const current = await rendered(element, "sv-try-on-view-screen");
      await press(current, 'sv-button[slot="primary"]');
      await vi.waitFor(() => {
        expect(current.tryOns).toHaveLength(2);
      });
      await settleResultImage(current);
      await element.updateComplete;
      await press(current, 'sv-button[slot="secondary"]');
      expect(add).toHaveBeenCalledOnce();
      experience.dispatch(
        new FlowAction.Presentation({
          action: new PresentationAction.ShowTryOn({ tryOnId: first }),
        }),
      );
      await settleResultImage(current);
      cart.resolve(true);
      await cart.promise;
      await element.updateComplete;
      expect(experience.view.presence.open).toBe(true);
      expect(current.cartPending).toBe(false);
    } finally {
      cart.resolve(false);
      dispose();
    }
  });

  it.each(["cookie", "bearer"] as const)(
    "runs the Rust flow over %s authentication and retries a failed request",
    async (transport) => {
      await initializeTestUi();
      defineSvTryOnExperience();
      stubDialogMethods();
      const variantId = crypto.randomUUID();
      const gatedVariantId = crypto.randomUUID();
      const resultId = crypto.randomUUID();
      const openPicker = vi.fn<() => void>();
      const disposeAdapters = vi.fn<() => void>();
      const productId = crypto.randomUUID();
      const bodyId = crypto.randomUUID();
      const bodyRevisionId = crypto.randomUUID();
      const origin = "https://api.example.test";
      const storage = "https://storage.example.test/photo";
      const renewed = "https://storage.example.test/renewed-photo";
      const cancelledBody = crypto.randomUUID();
      let bodyReads = 0;
      let cookie = false;
      let bearer = false;
      let attempts = 0;
      const image = new Blob(
        [
          Uint8Array.fromBase64(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==",
          ),
        ],
        { type: "image/png" },
      );
      const json = (body: unknown, status = 200) => Response.json(body, { status });
      const expiresAt = "2099-01-01T00:00:00Z";
      const received: string[] = [];
      const clientApiKey = crypto.randomUUID();
      const fetchImpl: typeof fetch = async (input, init) => {
        const request = new Request(input, init);
        const url = new URL(request.url);
        const route = `${request.method} ${url.pathname}`;
        received.push(route);
        if (request.url === storage) {
          expect(request.credentials).toBe("omit");
          expect(request.headers.get("Authorization")).toBeNull();
          expect(request.headers.get("X-Client-Api-Key")).toBeNull();
          expect(request.headers.get("Content-Type")).toBe("image/png");
          const bytes = await request.arrayBuffer();
          expect(bytes.byteLength).toBe(image.size);
          return new Response(null, { status: 200 });
        }
        expect(request.headers.get("X-Client-Api-Key")).toBe(clientApiKey);
        expect(request.headers.get("X-Api-Version")).toMatch(/^\d{4}-\d{2}-\d{2}$/u);
        if (route === `GET /products/${productId}`) {
          expect(request.credentials).toBe("omit");
          return json({
            productId,
            variants: [
              { id: variantId, foreignVariantIds: { size: "M" } },
              { id: gatedVariantId, foreignVariantIds: { size: "L" } },
            ],
          });
        }
        if (route === "POST /session/bearer") {
          expect(transport).toBe("bearer");
          expect(request.credentials).toBe("omit");
          await expect(request.json()).resolves.toEqual({ dataProcessingConsent: true });
          bearer = true;
          return json({ token: "test-token", expiresAt }, 201);
        }
        expect(request.credentials).toBe(bearer ? "omit" : "include");
        expect(request.headers.get("Authorization")).toBe(bearer ? "Bearer test-token" : null);
        switch (route) {
          case "GET /session": {
            return cookie
              ? json({ expiresAt })
              : json({ kind: "session-token-required", title: "No session" }, 401);
          }
          case "GET /bodies": {
            bodyReads += 1;
            return json({
              bodies: [
                {
                  bodyId: cancelledBody,
                  createdAt: "2026-11-12T00:00:00Z",
                  estimatedHeightCm: 165,
                  sourceImageUrl: "https://storage.example.test/cancelled",
                  sourceImageUrlExpiresAt: expiresAt,
                },
                {
                  bodyId,
                  createdAt: "2026-11-11T00:00:00Z",
                  estimatedHeightCm: 172,
                  userProvidedHeightCm: 175,
                  bodyRevisionId,
                  sourceImageUrl: bodyReads <= 1 ? storage : renewed,
                  sourceImageUrlExpiresAt: bodyReads <= 1 ? "2026-01-01T00:00:00Z" : expiresAt,
                },
              ],
            });
          }
          case "POST /session/cookie/prepare": {
            return json({ challenge: "prepared" });
          }
          case "POST /session/cookie": {
            await expect(request.json()).resolves.toEqual({
              cookieChallenge: "prepared",
              dataProcessingConsent: true,
            });
            if (transport === "bearer") {
              return json({ kind: "session-cookie-unavailable", title: "Cookie blocked" }, 400);
            }
            cookie = true;
            return json({ expiresAt }, 201);
          }
          case "POST /bodies/upload-urls": {
            await expect(request.json()).resolves.toEqual({
              byteSize: image.size,
              contentType: "image/png",
            });
            return json({
              uploadUrl: storage,
              method: "PUT",
              stagingKey: "staging-1",
              requiredHeaders: [{ name: "Content-Type", value: "image/png" }],
              expiresAt,
            });
          }
          case "POST /bodies": {
            await expect(request.json()).resolves.toEqual(
              expect.objectContaining({ stagingKey: "staging-1", mimeType: "image/png" }),
            );
            return json(
              {
                status: "ready",
                body: {
                  bodyId,
                  createdAt: "2026-11-11T00:00:00Z",
                  estimatedHeightCm: 172,
                  sourceImageUrl: "https://images.example.test/photo",
                  sourceImageUrlExpiresAt: expiresAt,
                },
              },
              201,
            );
          }
          case `PATCH /bodies/${bodyId}/height`: {
            await expect(request.json()).resolves.toEqual({
              heightCm: 175,
              productId,
              returnRevision: true,
            });
            return json({ bodyRevisionId });
          }
          case `GET /products/${productId}/recommended-size`: {
            expect(url.searchParams.get("bodyRevisionId")).toBe(bodyRevisionId);
            return json({
              bodyRevisionId,
              recommendedForeignIds: { size: "M" },
              recommendations: [
                {
                  foreignIds: { size: "M" },
                  rank: 1,
                  rationale: "Good fit",
                  fit: "ideal",
                  fitMatch: 87,
                  fitChecks: [
                    {
                      pointId: "sleeve",
                      label: "Sleeve length",
                      dimension: "sleeve_length",
                      garmentMm: 600,
                      bodyMm: 580,
                      easeMm: 20,
                      easeNorm: 0.8,
                      idealShiftNorm: 0,
                      intentSigmaNorm: 0,
                      fit: "runs_loose",
                      sentence: "",
                    },
                  ],
                },
                {
                  foreignIds: { size: "L" },
                  rank: 2,
                  rationale: "Too large",
                  fit: "too_loose",
                  fitMatch: 99,
                  fitChecks: [],
                  gate: "too_large",
                },
              ],
            });
          }
          case `POST /products/${productId}/try-on`: {
            expect(url.searchParams.get("bodyId")).toBe(bodyId);
            await expect(request.json()).resolves.toEqual({ variantId, bodyRevisionId });
            attempts += 1;
            return attempts === 1
              ? json({ kind: "internal-server-error", title: "Render failed" }, 500)
              : json(
                  {
                    status: "completed",
                    tryOnId: resultId,
                    variantId,
                    bodyRevisionId,
                    imageUrl: "https://images.example.test/try-on.webp",
                    scene: { overlayColor: "#ffffff" },
                    fitAnchors: [
                      { dimension: "sleeve_length", side: "left", x: 0.2, y: 0.4 },
                      { dimension: "sleeve_length", side: "right", x: 1.2, y: 0.4 },
                    ],
                  },
                  201,
                );
          }
          default: {
            throw new Error(`Unexpected route ${route}`);
          }
        }
      };
      const connect = async () =>
        await createApiTryOnExperience({
          api: { baseUrl: origin, clientApiKey },
          product: { productId },
          fetch: fetchImpl,
          presentProduct: () => ({
            axes: [
              {
                key: "size",
                role: AxisRole.Size,
                items: ["M", "L"].map((key) => ({
                  key,
                  display: new ItemDisplay.Text({ text: key }),
                })),
              },
            ],
            variantId: gatedVariantId,
            chosenAxes: [],
            labelFormats: [],
          }),
          devices: {
            applyDomainMediaEffect: vi.fn<() => void>(),
            startDeviceEffect(effect) {
              if (
                DeviceEffect.Picker.instanceOf(effect) &&
                PickerEffect.Open.instanceOf(effect.inner.effect)
              ) {
                openPicker();
                return new DeviceEvent.Picker({
                  event: new PickerEvent.Selected({
                    token: effect.inner.effect.inner.token,
                    media: crypto.randomUUID(),
                  }),
                });
              }
              return globalThis.undefined;
            },
            restorePhoto: () => crypto.randomUUID(),
            getPhoto: () => ({ src: "/sample.webp" }),
            getUploadPhoto: () => image,
            getCamera: () => globalThis.undefined,
            dispose: disposeAdapters,
          },
        });
      const experience = await connect();
      const events: TryOnExperienceEvent[] = [];
      experience.subscribeEvents(() => {
        throw new Error("Publisher unavailable");
      });
      experience.subscribeEvents(async () => {
        await Promise.resolve();
        throw new Error("Publisher rejected the event");
      });
      const unsubscribe = experience.subscribeEvents((event) => {
        events.push(event);
      });
      const onRequested = vi.fn<(event: HTMLElementEventMap["sv-try-on-requested"]) => void>();
      const onCart =
        vi.fn<(event: HTMLElementEventMap["sv-try-on-add-to-cart-requested"]) => void>();
      const cart = vi.fn<NonNullable<HTMLElementTagNameMap["sv-try-on-experience"]["addToCart"]>>();
      cart
        .mockRejectedValueOnce(new Error("Cart temporarily unavailable"))
        .mockResolvedValueOnce(globalThis.undefined);
      document.body.addEventListener("sv-try-on-requested", onRequested);
      document.body.addEventListener("sv-try-on-add-to-cart-requested", onCart);
      const element = document.createElement("sv-try-on-experience");
      element.experience = experience;
      element.addToCart = cart;
      document.body.append(element);
      try {
        await vi.waitFor(() => {
          expect(experience.view.domain.session).toBe(SessionPhase.Absent);
        });
        experience.open({ entry: "pdp-button", subentry: "size-row" });
        experience.open();
        const intro = await rendered(element, "sv-session-intro-screen");
        const introShell = await rendered(intro, "sv-screen");
        expect(introShell.shadowRoot?.querySelector<HTMLButtonElement>("button.back")?.hidden).toBe(
          true,
        );
        const checkbox = await rendered(intro, "sv-checkbox");
        checkbox.shadowRoot?.querySelector("button")?.click();
        await press(intro, 'sv-button[slot="primary"]');
        expect(openPicker).toHaveBeenCalledOnce();

        await vi.waitFor(() => {
          expect(ScreenView.Height.instanceOf(experience.view.screen)).toBe(true);
        });
        const height = await rendered(element, "sv-height-setting-screen");
        expect(height.heightCm).toBe(172);
        expect(height.photoSrc).toBe("/sample.webp");
        const field = await rendered(height, "sv-height-input");
        const input = field.shadowRoot?.querySelector("input");
        expect(input).toBeDefined();
        input!.value = "175";
        input!.dispatchEvent(new Event("input", { bubbles: true }));
        input!.dispatchEvent(new FocusEvent("blur"));
        await press(height, 'sv-button[slot="primary"]');
        const tryOn = await rendered(element, "sv-try-on-view-screen");
        await vi.waitFor(() => {
          expect(tryOn.selection?.recommended).toBe(true);
          expect(tryOn.selection?.variantId).toBe(variantId);
        });
        expect(
          tryOn.selection?.rows[0]?.items.find(({ key }) => key === "L")?.refusal,
        ).toBeDefined();
        await press(tryOn, 'sv-button[slot="primary"]');
        await vi.waitFor(() => {
          expect(tryOn.state).toBe("error");
        });
        expect(tryOn.photoSrc).toBe("/sample.webp");
        await press(tryOn, 'sv-button[slot="primary"]');
        await vi.waitFor(() => {
          expect(tryOn.presentation?.displayed).toEqual(
            new DisplayedImage.TryOn({ tryOnId: resultId }),
          );
        });
        expect(tryOn.tryOns).toEqual([
          expect.objectContaining({
            id: resultId,
            height: 175,
            imageUrl: "https://images.example.test/try-on.webp",
            fitAnchors: [{ dimension: "sleeve_length", side: "left", x: 0.2, y: 0.4 }],
          }),
        ]);
        expect(tryOn.presentation?.triedItems?.get("size")).toEqual(["M"]);
        expect(tryOn.fit).toMatchObject({
          state: "ready",
          callouts: [{ key: "sleeve_length:left", label: "Sleeve length", x: 0.2, y: 0.4 }],
        });
        await settleResultImage(tryOn);
        await element.updateComplete;
        await press(tryOn, 'sv-button[slot="primary"]');
        const worn = await rendered(tryOn, "sv-button", 'sv-button[slot="primary"]');
        expect(worn.textContent).toContain("You’re wearing");
        expect(worn.shadowRoot?.querySelector("button")?.disabled).toBe(true);
        expect(events).toContainEqual(
          expect.objectContaining({
            type: "sv-try-on-step-changed",
            detail: expect.objectContaining({
              previousStep: "try-on",
              step: "variant-selection",
            }),
          }),
        );
        const shell = await rendered(tryOn, "sv-screen");
        await pressBack(shell);
        expect(experience.view.presence.open).toBe(true);
        await tryOn.updateComplete;
        expect(tryOn.presentation?.mode).toBe(PresentationMode.Selection);

        experience.dispatch(
          new FlowAction.Presentation({ action: new PresentationAction.RequestTryOn() }),
        );
        expect(attempts).toBe(2);
        const dialog = await rendered(element, "sv-dialog");
        await press(tryOn, 'sv-button[slot="secondary"]');
        await vi.waitFor(() => {
          expect(tryOn.textContent).toContain("could not be added");
          expect(dialog.open).toBe(true);
        });
        await press(tryOn, 'sv-button[slot="secondary"]');
        await vi.waitFor(() => {
          expect(dialog.open).toBe(false);
          expect(experience.view.presence.open).toBe(false);
        });
        expect(cart).toHaveBeenCalledTimes(2);
        expect(experience.failure).toBeUndefined();
      } finally {
        document.body.removeEventListener("sv-try-on-requested", onRequested);
        document.body.removeEventListener("sv-try-on-add-to-cart-requested", onCart);
        unsubscribe();
        element.remove();
        experience.dispose();
      }
      expect(
        events
          .filter(
            ({ type }) => type !== "sv-try-on-step-changed" && type !== "sv-try-on-variant-changed",
          )
          .map(({ type }) => type),
      ).toEqual([
        "sv-try-on-opened",
        "sv-try-on-photo-source-started",
        "sv-try-on-consent-granted",
        "sv-try-on-photo-processing",
        "sv-try-on-photo-accepted",
        "sv-try-on-height-confirmed",
        "sv-try-on-requested",
        "sv-try-on-failed",
        "sv-try-on-requested",
        "sv-try-on-rendered",
        "sv-try-on-request-resolved",
        "sv-try-on-presented",
        "sv-try-on-requested",
        "sv-try-on-request-resolved",
        "sv-try-on-add-to-cart-requested",
        "sv-try-on-add-to-cart-requested",
        "sv-try-on-closed",
      ]);
      expect(events[0]?.detail).toEqual({
        productId,
        step: "intro",
        entry: "pdp-button",
        subentry: "size-row",
      });
      expect(events.find(({ type }) => type === "sv-try-on-failed")?.detail).toMatchObject({
        reason: "internal",
        requestId: onRequested.mock.calls[0]?.[0].detail.requestId,
      });
      expect(events.find(({ type }) => type === "sv-try-on-rendered")?.detail).toEqual({
        productId,
        step: "try-on",
        tryOnId: resultId,
        variantId,
      });
      expect(onRequested).toHaveBeenCalledTimes(3);
      const resolved = events.filter((event) => event.type === "sv-try-on-request-resolved");
      expect(resolved.map(({ detail }) => detail.requestId)).toEqual(
        onRequested.mock.calls.slice(1).map(([event]) => event.detail.requestId),
      );
      expect(onRequested.mock.calls[0]?.[0]).toMatchObject({
        composed: true,
        detail: { productId, variantId, origin: "shopper", foreignIds: { size: "M" } },
      });
      expect(onCart.mock.calls[0]?.[0].detail).toMatchObject({
        productId,
        variantId,
        foreignIds: { size: "M" },
      });
      expect(events.at(-1)?.detail).toEqual({
        productId,
        step: "try-on",
        displayed: { tryOnId: resultId, variantId },
      });
      expect(disposeAdapters).toHaveBeenCalledOnce();
      expect(received.slice(0, 8)).toEqual([
        `GET /products/${productId}`,
        "GET /session",
        "POST /session/cookie/prepare",
        "POST /session/cookie",
        transport === "cookie" ? "GET /session" : "POST /session/bearer",
        "POST /bodies/upload-urls",
        "PUT /photo",
        "POST /bodies",
      ]);
      if (transport === "cookie") {
        const reopened = await connect();
        try {
          await vi.waitFor(() => {
            expect(bodyIdentity(reopened.view.domain.body)?.bodyId).toBe(bodyId);
          });
          const photo = reopened.view.domain.photo;
          expect(photo?.source).toBe(PhotoSource.Library);
          expect(photo?.media).toBeDefined();
          if (photo !== undefined) {
            await vi.waitFor(() => {
              expect(reopened.adapters.getPhoto(photo.media)?.src).toBe(renewed);
            });
          }
          expect(bodyReads).toBe(2);
        } finally {
          reopened.dispose();
        }
        const storageBlocked = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
          throw new DOMException("Storage blocked", "SecurityError");
        });
        try {
          const unpinned = await connect();
          try {
            await vi.waitFor(() => {
              expect(unpinned.view.domain.session).toBe(SessionPhase.Ready);
            });
            expect(BodyState.NoBody.instanceOf(unpinned.view.domain.body)).toBe(true);
            expect(bodyReads).toBe(2);
          } finally {
            unpinned.dispose();
          }
        } finally {
          storageBlocked.mockRestore();
        }
      }
    },
  );

  it.each(["fit-retry", "historical-fit", "credential-refresh", "cross-tab-height"] as const)(
    "restores a body and handles %s",
    async (scenario) => {
      await initializeTestUi();
      defineSvTryOnExperience();
      stubDialogMethods();
      const initialFit = deferred<Response>();
      const initialFitFails = scenario === "fit-retry" || scenario === "historical-fit";
      let fitCalls = 0;
      let refreshCalls = 0;
      let savedHeight = 170;
      let bodyRevisionId = crypto.randomUUID();
      const originalRevision = bodyRevisionId;
      const tryOnId = crypto.randomUUID();
      const expiresAt = "2099-01-01T00:00:00Z";
      const received: string[] = [];
      const productId = crypto.randomUUID();
      const variantId = crypto.randomUUID();
      const bodyId = crypto.randomUUID();
      const photoUrl = "https://storage.example.test/restored-photo";
      const restorePhoto = vi.fn<() => string>(() => crypto.randomUUID());
      const api = { baseUrl: "https://api.example.test", clientApiKey: crypto.randomUUID() };
      const stored = await bodySelectionStore(api.baseUrl, api.clientApiKey);
      stored.save({ id: bodyId, source: PhotoSource.Library });
      const experience = await createApiTryOnExperience({
        api,
        product: { productId },
        presentProduct: () => ({
          axes: [
            { key: "size", items: [{ key: "M", display: new ItemDisplay.Text({ text: "M" }) }] },
          ],
          labelFormats: [],
          variantId,
          chosenAxes: [],
        }),
        fetch: async (input, init) => {
          const request = new Request(input, init);
          const url = new URL(request.url);
          const route = `${request.method} ${url.pathname}`;
          received.push(route);
          switch (route) {
            case `GET /products/${productId}`: {
              return await Promise.resolve(
                Response.json({
                  productId,
                  variants: [{ id: variantId, foreignVariantIds: { size: "M" } }],
                }),
              );
            }
            case "GET /session": {
              return Response.json({
                expiresAt:
                  scenario === "credential-refresh"
                    ? new Date(Date.now() + 60_000).toISOString()
                    : expiresAt,
              });
            }
            case "POST /session/cookie/refresh": {
              refreshCalls += 1;
              if (refreshCalls === 2) {
                throw new TypeError("Network unavailable");
              }
              return Response.json({
                expiresAt:
                  refreshCalls === 1 ? new Date(Date.now() + 60_000).toISOString() : expiresAt,
              });
            }
            case `PATCH /bodies/${bodyId}/height`: {
              const body = (await request.json()) as { heightCm: number };
              savedHeight = body.heightCm;
              bodyRevisionId = crypto.randomUUID();
              return new Response(null, { status: 204 });
            }
            case "GET /bodies": {
              return await Promise.resolve(
                Response.json({
                  bodies: [
                    {
                      bodyId,
                      estimatedHeightCm: 172,
                      userProvidedHeightCm: savedHeight,
                      bodyRevisionId,
                      createdAt: "2026-01-01T00:00:00Z",
                      sourceImageUrl: photoUrl,
                      sourceImageUrlExpiresAt: expiresAt,
                    },
                  ],
                }),
              );
            }
            case `GET /products/${productId}/recommended-size`: {
              expect(url.searchParams.get("bodyRevisionId")).toBe(bodyRevisionId);
              fitCalls += 1;
              return fitCalls === 1 && initialFitFails
                ? await initialFit.promise
                : Response.json({
                    bodyRevisionId,
                    recommendedForeignIds: { size: "M" },
                    recommendations: [
                      {
                        foreignIds: { size: "M" },
                        rank: 1,
                        rationale: "Good fit",
                        fit: "ideal",
                        fitMatch: savedHeight === 170 ? 87 : 12,
                        fitChecks: [],
                      },
                    ],
                  });
            }
            case `POST /products/${productId}/try-on`: {
              await expect(request.json()).resolves.toEqual({
                variantId,
                bodyRevisionId: originalRevision,
              });
              if (scenario === "cross-tab-height") {
                savedHeight = 180;
                bodyRevisionId = crypto.randomUUID();
              }
              return Response.json(
                {
                  status: "completed",
                  tryOnId,
                  variantId,
                  bodyRevisionId: originalRevision,
                  imageUrl: "/result.webp",
                  scene: { overlayColor: "#ffffff" },
                },
                { status: 201 },
              );
            }
            default: {
              throw new Error(`Unexpected route: ${route}`);
            }
          }
        },
        devices: {
          restorePhoto,
          startDeviceEffect: () => globalThis.undefined,
          getPhoto: () => ({ src: photoUrl }),
          getUploadPhoto: () => globalThis.undefined,
          getCamera: () => globalThis.undefined,
          applyDomainMediaEffect: vi.fn<() => void>(),
          dispose: vi.fn<() => void>(),
        },
      });
      const element = document.createElement("sv-try-on-experience");
      element.experience = experience;
      document.body.append(element);
      try {
        await vi.waitFor(() => {
          expect(bodyIdentity(experience.view.domain.body)?.bodyId).toBe(bodyId);
        });
        experience.open();
        expect(ScreenView.TryOn.instanceOf(experience.view.screen)).toBe(true);
        expect(restorePhoto).toHaveBeenCalledWith(photoUrl);

        const screen = await rendered(element, "sv-try-on-view-screen");
        if (scenario === "credential-refresh") {
          await vi.waitFor(() => {
            expect(fitCalls).toBe(1);
          });
          await press(screen, 'sv-button[slot="primary"]');
          await vi.waitFor(() => {
            expect(screen.state).toBe("error");
          });
          expect(received).not.toContain(`POST /products/${productId}/try-on`);
          expect(experience.view.domain.uncertainTryOn).toBe(false);
        }
        await press(screen, 'sv-button[slot="primary"]');
        await vi.waitFor(() => {
          expect(screen.presentation?.displayed).toEqual(new DisplayedImage.TryOn({ tryOnId }));
          expect(screen.fit?.state).toBe(initialFitFails ? "loading" : "ready");
        });
        let shown = screen;
        if (initialFitFails) {
          initialFit.resolve(
            Response.json(
              { kind: "internal-server-error", title: "Fit unavailable" },
              { status: 500 },
            ),
          );
          await vi.waitFor(() => {
            expect(screen.fit?.state).toBe("error");
          });
        }
        if (scenario === "historical-fit") {
          editHeight(experience);
          experience.dispatch(
            new FlowAction.Height({ action: new HeightAction.Edit({ height: 180 }) }),
          );
          experience.dispatch(new FlowAction.Height({ action: new HeightAction.Confirm() }));
          await vi.waitFor(() => {
            expect(savedHeight).toBe(180);
            expect(
              HeightStatus.Acknowledged.instanceOf(bodyHeight(experience.view.domain.body)),
            ).toBe(true);
            expect(fitCalls).toBe(2);
          });
          experience.dispatch(
            new FlowAction.Presentation({ action: new PresentationAction.ShowTryOn({ tryOnId }) }),
          );
          shown = await rendered(element, "sv-try-on-view-screen");
        }
        await settleResultImage(shown);
        await element.updateComplete;
        const score = await rendered(shown, "sv-fit-score");
        if (scenario === "fit-retry") {
          score.shadowRoot?.querySelector("button")?.click();
          await vi.waitFor(() => {
            expect(shown.fit).toMatchObject({ state: "ready", score: 87 });
          });
          expect(fitCalls).toBe(2);
        } else if (scenario === "historical-fit") {
          expect(shown.fit).toMatchObject({ state: "error", retryable: false, tryOnId });
          expect(shown.tryOns.find((result) => result.id === tryOnId)?.height).toBe(170);
          expect(score.shadowRoot?.querySelector("button")).toBeNull();
        }
        if (scenario === "cross-tab-height") {
          expect(savedHeight).toBe(180);
          expect(shown.tryOns.find((result) => result.id === tryOnId)?.height).toBe(170);
          expect(shown.fit).toMatchObject({ state: "ready", score: 87 });
        }
        expect(experience.failure).toBeUndefined();
        expect(bodyIdentity(experience.view.domain.body)?.bodyId).toBe(bodyId);
      } finally {
        element.remove();
        experience.dispose();
      }
    },
  );
});

function result(id = crypto.randomUUID()): Outcome {
  return new Outcome.TryOn({
    outcome: new TryOnOutcome.Created({ tryOnId: id, imageUrl: `/${id}.webp` }),
  });
}
function show(experience: TryOnExperience, tryOnId: string) {
  experience.dispatch(
    new FlowAction.Presentation({
      action: new PresentationAction.ShowTryOn({ tryOnId }),
    }),
  );
}
function installStyles(
  experience: TryOnExperience,
  styles: readonly string[],
  sizes: readonly string[] = ["M"],
  sparse = false,
) {
  const id = experience.view.domain.product!.id;
  const pairs =
    styles.length === 2 && sizes.length === 2 && sparse
      ? [
          [sizes[0], styles[0]],
          [sizes[1], styles[1]],
        ]
      : sizes.flatMap((size) => styles.map((style) => [size, style]));
  const variants = pairs.map(([size, style]) => ({
    id: crypto.randomUUID(),
    foreignIds: new Map([
      ["size", size],
      ["style", style],
    ]),
  }));
  experience.dispatch(
    new FlowAction.Selection({
      action: new SelectionAction.HostProductUpdated({
        hostProduct: {
          product: { id, variants },
          axes: [
            {
              key: "size",
              role: AxisRole.Size,
              label: "Size",
              items: sizes.map((size) => ({
                key: size,
                display: new ItemDisplay.Text({ text: size }),
              })),
            },
            {
              key: "style",
              label: "Style",
              displayOptions: {
                control: AxisControl.Segmented,
                placement: AxisPlacement.ResultToolbar,
              },
              items: styles.map((style) => ({
                key: style,
                display: new ItemDisplay.Text({ text: style }),
              })),
            },
          ],
          variantId: variants[0].id,
          chosenAxes: ["size", "style"],
          labelFormats: [],
        },
      }),
    }),
  );
  return variants;
}
describe("result selection and recovery", () => {
  it("disables the cart and explains stock reported by the controller", async () => {
    const fixture = await mountWithAdapters({ run: () => result() });
    const { element, experience, variantId, dispose } = fixture;
    try {
      const cart = vi.fn<() => void>();
      element.addToCart = cart;
      const screen = await rendered(element, "sv-try-on-view-screen");
      await press(screen, 'sv-button[slot="primary"]');
      await vi.waitFor(() => {
        expect(screen.tryOns).toHaveLength(1);
      });
      await settleResultImage(screen);
      experience.setUnavailableVariants([variantId]);
      await element.updateComplete;
      expect(experience.view.domain.unavailableVariants).toContain(variantId);
      expect(Capability.Unavailable.instanceOf(screen.presentation?.canRequestTryOn)).toBe(true);
      expect(screen.textContent).toMatch(/out of stock/i);
      const control = await rendered(screen, "sv-button", 'sv-button[slot="secondary"]');
      expect(control.disabled).toBe(true);
      control.shadowRoot?.querySelector("button")?.click();
      expect(cart).not.toHaveBeenCalled();
    } finally {
      dispose();
    }
  });

  it("opens the picker immediately and keeps dependent renders queued during height readback", async () => {
    const save = deferred<Outcome>();
    const read = deferred<Outcome>();
    const heightWork = vi.fn<(phase: string) => void>();
    const render = vi.fn<() => Outcome>(() => result());
    const fixture = await mountWithAdapters({
      run(job): Outcome | Promise<Outcome> {
        if (Job.Body.instanceOf(job)) {
          heightWork(job.inner.job.tag);
          return BodyJob.ReadHeight.instanceOf(job.inner.job) ? read.promise : save.promise;
        }
        return render();
      },
    });
    const { experience, element, dispose } = fixture;
    try {
      await firstResult(fixture);
      editHeight(experience);
      experience.dispatch(
        new FlowAction.Height({ action: new HeightAction.Edit({ height: 180 }) }),
      );
      const height = await rendered(element, "sv-height-setting-screen");
      await press(height, 'sv-button[slot="primary"]');

      const screen = await rendered(element, "sv-try-on-view-screen");
      expect(HeightStatus.Pending.instanceOf(bodyHeight(experience.view.domain.body))).toBe(true);
      expect(screen.presentation?.mode).toBe(PresentationMode.Selection);
      expect(Capability.Available.instanceOf(screen.presentation?.canRequestTryOn)).toBe(true);
      expect(heightWork.mock.calls).toEqual([["SetHeight"]]);

      save.resolve(new Outcome.HeightWriteUnconfirmed());
      await vi.waitFor(() => {
        expect(heightWork.mock.calls).toEqual([["SetHeight"], ["ReadHeight"]]);
      });
      await press(screen, 'sv-button[slot="primary"]');
      expect(render).toHaveBeenCalledOnce();
      expect(HeightStatus.Pending.instanceOf(bodyHeight(experience.view.domain.body))).toBe(true);
      read.resolve(new Outcome.HeightReadback({ height: 180, backendRevision: "saved-height" }));
      await vi.waitFor(() => {
        expect(render).toHaveBeenCalledTimes(2);
      });
      const saved = bodyHeight(experience.view.domain.body);
      expect(HeightStatus.Acknowledged.instanceOf(saved) && saved.inner.backendRevision).toBe(
        "saved-height",
      );
    } finally {
      save.resolve(new Outcome.HeightWriteUnconfirmed());
      read.resolve(new Outcome.Unknown());
      dispose();
    }
  });

  it("keeps the style row in the mobile editing panel", async () => {
    const fixture = await mountWithAdapters({ run: () => result() });
    const { element, experience, dispose } = fixture;
    try {
      installStyles(experience, ["Buttoned", "Open"], ["M", "L"]);
      const screen = await rendered(element, "sv-try-on-view-screen");
      await press(screen, 'sv-button[slot="primary"]');
      await vi.waitFor(() => {
        expect(DisplayedImage.TryOn.instanceOf(screen.presentation?.displayed)).toBe(true);
      });
      await press(screen, 'sv-button[slot="primary"]');
      await screen.updateComplete;
      expect(screen.presentation?.mode).toBe(PresentationMode.EditingVariant);
      expect(
        screen.selection?.rows.find((row) => row.key === "style")?.items.map((i) => i.key),
      ).toEqual(["Buttoned", "Open"]);
      const picker = await rendered(screen, "sv-variant-picker");
      expect(picker.selection?.rows.map((row) => row.key)).toEqual(["size", "style"]);
      expect(screen.shadowRoot?.querySelector(".result-fold")?.hasAttribute("inert")).toBe(true);
    } finally {
      dispose();
    }
  });

  it("explains why a queued toolbar request was cancelled", async () => {
    const companion = deferred<Outcome>();
    let first = true;
    const fixture = await mountWithAdapters({
      run: (): Outcome | Promise<Outcome> => {
        if (first) {
          first = false;
          return result();
        }
        return companion.promise;
      },
    });
    const { element, experience, dispose } = fixture;
    try {
      const variants = installStyles(experience, ["Buttoned", "Open", "Rolled"]);
      const screen = await rendered(element, "sv-try-on-view-screen");
      await press(screen, 'sv-button[slot="primary"]');
      await vi.waitFor(() => {
        expect(
          experience.view.domain.tryOnRequests.some(
            (r) =>
              r.variantId === variants[1]?.id && TryOnRequestStatus.Running.instanceOf(r.status),
          ),
        ).toBe(true);
      });
      const row = await rendered(screen, "sv-option-group", ".result-toolbar sv-option-group");
      const rolled = [...(row.shadowRoot?.querySelectorAll("button") ?? [])].find((b) =>
        b.textContent?.includes("Rolled"),
      );
      expect(rolled?.disabled).toBe(false);
      rolled?.click();
      await vi.waitFor(() => {
        expect(
          experience.view.domain.tryOnRequests.some(
            (r) =>
              r.variantId === variants[2]?.id && TryOnRequestStatus.Waiting.instanceOf(r.status),
          ),
        ).toBe(true);
      });
      experience.setUnavailableVariants(
        [variants[2].id],
        experience.view.productInstallation?.token,
      );
      await vi.waitFor(() => {
        expect(
          experience.view.domain.tryOnRequests.some(
            (r) =>
              r.variantId === variants[2]?.id && TryOnRequestStatus.Failed.instanceOf(r.status),
          ),
        ).toBe(true);
      });
      await screen.updateComplete;
      expect(screen.requestPending).toBe(false);
      expect(screen.error).toBeUndefined();
      expect(screen.textContent).toMatch(/out of stock/i);
    } finally {
      companion.resolve(result());
      dispose();
    }
  });

  it("reports close at the last visible step after a background result", async () => {
    const pending = deferred<Outcome>();
    const fixture = await mountWithAdapters({ run: async () => await pending.promise });
    const { experience, element, events, dispose } = fixture;
    try {
      const screen = await rendered(element, "sv-try-on-view-screen");
      await press(screen, 'sv-button[slot="primary"]');
      experience.dispatch(new FlowAction.Presence({ action: PresenceAction.Suspend }));
      pending.resolve(result());
      await vi.waitFor(() => {
        expect(
          DisplayedImage.TryOn.instanceOf(
            (experience.view.screen as InstanceType<typeof ScreenView.TryOn>).inner.presentation
              .displayed,
          ),
        ).toBe(true);
      });
      expect(events.findLast((e) => e.type === "sv-try-on-step-changed")?.detail.step).toBe(
        "variant-selection",
      );
      expect(events.some((e) => e.type === "sv-try-on-presented")).toBe(false);
      experience.close();
      expect(events.find((e) => e.type === "sv-try-on-closed")?.detail.step).toBe(
        "variant-selection",
      );
    } finally {
      pending.resolve(result());
      dispose();
    }
  });

  it("keeps an image retry scoped to its original result", async () => {
    const first = crypto.randomUUID();
    const second = crypto.randomUUID();
    let attempts = 0;
    const refresh = deferred<null>();
    const fixture = await mountWithAdapters({
      run(job) {
        if (Job.Body.instanceOf(job)) {
          return new Outcome.Body({ outcome: BodyOutcome.HeightSet });
        }
        attempts += 1;
        return result(attempts === 1 ? first : second);
      },
    });
    const { experience, element, dispose } = fixture;
    try {
      const renew = vi.fn<
        TryOnExperienceAdapters["refreshResult"] &
          ((id: string, signal: AbortSignal) => Promise<void>)
      >(async () => {
        await refresh.promise;
      });
      experience.adapters.refreshResult = renew;
      const screen = await rendered(element, "sv-try-on-view-screen");
      await press(screen, 'sv-button[slot="primary"]');
      await vi.waitFor(() => {
        expect(screen.tryOns[0]?.id).toBe(first);
      });
      editHeight(experience);
      experience.dispatch(
        new FlowAction.Height({ action: new HeightAction.Edit({ height: 181 }) }),
      );
      await press(await rendered(element, "sv-height-setting-screen"), 'sv-button[slot="primary"]');
      const current = await rendered(element, "sv-try-on-view-screen");
      await press(current, 'sv-button[slot="primary"]');
      await vi.waitFor(() => {
        expect(current.tryOns).toHaveLength(2);
      });
      show(experience, first);
      await settleResultImage(current, "error");
      await element.updateComplete;
      expect(renew).toHaveBeenCalledOnce();
      show(experience, second);
      await settleResultImage(current);
      const image = await rendered(current, "sv-image", "sv-image[data-result]");
      const before = image.shadowRoot?.querySelector("img");
      expect(renew.mock.calls[0]?.[1].aborted).toBe(true);
      refresh.resolve(null);
      await refresh.promise;
      await image.updateComplete;
      expect(image.shadowRoot?.querySelector("img")).toBe(before);
      expect(image.src).toBe(`/${second}.webp`);
      expect(current.resultImageState).toBe("ready");
    } finally {
      refresh.resolve(null);
      dispose();
    }
  });

  it("rejects a camera stream that ends during enumeration", async () => {
    const enumeration = deferred<MediaDeviceInfo[]>();
    const track = new EventTarget() as EventTarget & {
      readyState: string;
      stop(): void;
      getSettings(): object;
    };
    track.readyState = "live";
    track.stop = () => {
      track.readyState = "ended";
    };
    track.getSettings = () => ({ deviceId: "camera" });
    const stream = {
      getTracks: () => [track],
      getVideoTracks: () => [track],
    } as unknown as MediaStream;
    const original = Object.getOwnPropertyDescriptor(navigator, "mediaDevices");
    const enumerateDevices = vi.fn<() => Promise<MediaDeviceInfo[]>>(
      async () => await enumeration.promise,
    );
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: vi.fn<() => Promise<MediaStream>>(async () => stream),
        enumerateDevices,
      },
    });
    const owner: { experience?: TryOnExperience } = {};
    const devices = createBrowserTryOnDevices({
      capture: async () => {
        throw new Error("Unexpected capture");
      },
      complete: (event) => {
        owner.experience?.completeDevice(event);
      },
    });
    const fixture = await mountWithAdapters({ startDeviceEffect: devices.startDeviceEffect });
    const { experience, element, dispose } = fixture;
    owner.experience = experience;
    try {
      experience.dispatch(
        new FlowAction.Photo({
          action: new PhotoAction.BeginSource({ source: PhotoSource.Camera }),
        }),
      );
      await vi.waitFor(() => {
        expect(enumerateDevices).toHaveBeenCalledOnce();
      });
      track.readyState = "ended";
      track.dispatchEvent(new Event("ended"));
      enumeration.resolve([]);
      const camera = await rendered(element, "sv-photo-capture-screen");
      await vi.waitFor(() => {
        expect(camera.state).toBe("error");
      });
      expect(
        CameraState.Unavailable.instanceOf(
          (experience.view.screen as InstanceType<typeof ScreenView.Camera>).inner.camera,
        ),
      ).toBe(true);
      expect(track.readyState).toBe("ended");
    } finally {
      enumeration.resolve([]);
      dispose();
      devices.dispose();
      if (original === undefined) {
        Reflect.deleteProperty(navigator, "mediaDevices");
      } else {
        Object.defineProperty(navigator, "mediaDevices", original);
      }
    }
  });
});

describe("additional recovery probes", () => {
  it("requires an edited height after an unusable calibration", async () => {
    const writes = vi.fn<() => Outcome>(() => new Outcome.Failed({ error: BackendError.Unusable }));
    const fixture = await mountWithAdapters({ height: null, run: writes });
    const { experience, element, dispose } = fixture;
    try {
      let height = await rendered(element, "sv-height-setting-screen");
      const attempted = height.heightCm;
      await press(height, 'sv-button[slot="primary"]');
      await vi.waitFor(() => {
        expect(Issue.SetHeightFailed.instanceOf(experience.view.issue)).toBe(true);
      });
      height = await rendered(element, "sv-height-setting-screen");
      expect(height.heightCm).toBe(attempted);
      expect(height.error).toMatch(/could not calibrate/i);
      const confirm = await rendered(height, "sv-button", 'sv-button[slot="primary"]');
      expect(confirm.disabled).toBe(true);
      experience.dispatch(
        new FlowAction.Height({ action: new HeightAction.Edit({ height: 180 }) }),
      );
      await press(height, 'sv-button[slot="primary"]');
      expect(writes).toHaveBeenCalledTimes(2);
    } finally {
      dispose();
    }
  });

  it("retains camera denial until the shopper explicitly retries", async () => {
    const acquire = vi.fn<() => void>();
    const fixture = await mountWithAdapters({
      startDeviceEffect(effect) {
        if (
          DeviceEffect.Camera.instanceOf(effect) &&
          CameraEffect.Acquire.instanceOf(effect.inner.effect)
        ) {
          acquire();
          return new DeviceEvent.Camera({
            event: new CameraEvent.AcquireFailed({
              token: effect.inner.effect.inner.token,
              error: DeviceError.PermissionDenied,
            }),
          });
        }
      },
    });
    const { experience, element, dispose } = fixture;
    try {
      experience.dispatch(
        new FlowAction.Photo({
          action: new PhotoAction.BeginSource({ source: PhotoSource.Camera }),
        }),
      );
      const camera = await rendered(element, "sv-photo-capture-screen");
      await vi.waitFor(() => {
        expect(camera.state).toBe("denied");
      });
      experience.dispatch(new FlowAction.Presence({ action: PresenceAction.Suspend }));
      experience.dispatch(new FlowAction.Presence({ action: PresenceAction.Resume }));
      expect(acquire).toHaveBeenCalledOnce();
      await press(camera, 'sv-button[slot="primary"]');
      expect(acquire).toHaveBeenCalledTimes(2);
    } finally {
      dispose();
    }
  });
});

describe("generated API and mounted experience parity", () => {
  it.each([
    "height-revision",
    "height-read-failed",
    "body-not-found",
    "image-reauth",
    "try-on-variant-mismatch",
    "recommendation-unavailable",
  ] as const)("%s", async (scenario) => {
    await initializeTestUi();
    defineSvTryOnExperience();
    stubDialogMethods();
    const variantId = crypto.randomUUID();
    const productId = crypto.randomUUID();
    const bodyId = crypto.randomUUID();
    const bodyRevisionId = crypto.randomUUID();
    const tryOnId = crypto.randomUUID();
    const expiresAt = "2099-01-01T00:00:00Z";
    const baseUrl = "https://api.example.test";
    const api = { baseUrl, clientApiKey: crypto.randomUUID() };
    const routes: string[] = [];
    let heightWrites = 0;
    let renders = 0;
    const fetchImpl: typeof fetch = async (input, init) => {
      const request = new Request(input, init);
      const url = new URL(request.url);
      const route = `${request.method} ${url.pathname}`;
      routes.push(route);
      const problem = (kind: string, status: number) =>
        Response.json(
          { kind, title: kind },
          {
            status,
            headers: { "Content-Type": "application/problem+json" },
          },
        );
      switch (route) {
        case "GET /session": {
          return Response.json({ expiresAt });
        }
        case `GET /products/${productId}`: {
          return Response.json({
            productId,
            variants: [{ id: variantId, foreignVariantIds: { size: "M" } }],
          });
        }
        case "GET /bodies": {
          if (heightWrites > 0) {
            return problem("internal-server-error", 503);
          }
          return Response.json({
            bodies: [
              {
                bodyId,
                bodyRevisionId,
                createdAt: "2026-11-11T00:00:00Z",
                sourceImageUrl: "/original.jpg",
                sourceImageUrlExpiresAt: expiresAt,
                estimatedHeightCm: 170,
                ...(scenario !== "height-read-failed" &&
                  scenario !== "height-revision" && { userProvidedHeightCm: 170 }),
              },
            ],
          });
        }
        case `PATCH /bodies/${bodyId}/height`: {
          heightWrites += 1;
          return scenario === "height-revision"
            ? Response.json({ bodyRevisionId })
            : new Response(null, { status: 204 });
        }
        case `GET /products/${productId}/recommended-size`: {
          if (scenario === "recommendation-unavailable") {
            return problem("recommendation-unavailable", 400);
          }
          return Response.json({
            bodyRevisionId,
            recommendedForeignIds: { size: "M" },
            recommendations: [],
          });
        }
        case `POST /products/${productId}/try-on`: {
          renders += 1;
          if (scenario === "body-not-found") {
            return problem("body-not-found", 404);
          }
          return Response.json(
            {
              status: "completed",
              tryOnId,
              variantId:
                scenario === "try-on-variant-mismatch" && renders === 1
                  ? crypto.randomUUID()
                  : variantId,
              bodyRevisionId,
              imageUrl: "/result.webp",
              scene: { overlayColor: "#ffffff" },
            },
            { status: 201 },
          );
        }
        case `GET /try-ons/${tryOnId}`: {
          return problem("session-expired", 401);
        }
        default: {
          throw new Error(route);
        }
      }
    };
    const store = await bodySelectionStore(api.baseUrl, api.clientApiKey);
    store.save({ id: bodyId, source: PhotoSource.Library });
    const connect = async () =>
      await createApiTryOnExperience({
        api,
        product: { productId },
        fetch: fetchImpl,
        presentProduct: () => ({
          axes: [
            { key: "size", items: [{ key: "M", display: new ItemDisplay.Text({ text: "M" }) }] },
          ],
          variantId,
          chosenAxes: ["size"],
          labelFormats: [],
        }),
        devices: {
          applyDomainMediaEffect: vi.fn<() => void>(),
          startDeviceEffect: vi.fn<() => void>(),
          restorePhoto: () => crypto.randomUUID(),
          getPhoto: () => ({ src: "/original.jpg" }),
          getUploadPhoto: vi.fn<() => undefined>(),
          getCamera: vi.fn<() => undefined>(),
          dispose: vi.fn<() => void>(),
        },
      });
    const experience = await connect();
    const element = document.createElement("sv-try-on-experience");
    element.experience = experience;
    const cart = vi.fn<() => Promise<void>>().mockImplementation(async () => globalThis.undefined);
    element.addToCart = cart;
    document.body.append(element);
    try {
      await vi.waitFor(() => {
        expect(experience.view.domain.session).toBe(SessionPhase.Ready);
      });
      experience.open();
      if (scenario === "height-revision" || scenario === "height-read-failed") {
        const height = await rendered(element, "sv-height-setting-screen");
        await press(height, 'sv-button[slot="primary"]');
        const screen = await rendered(element, "sv-try-on-view-screen");
        if (scenario === "height-revision") {
          await vi.waitFor(() => {
            expect(
              HeightStatus.Acknowledged.instanceOf(bodyHeight(experience.view.domain.body)),
            ).toBe(true);
          });
          expect(routes.filter((route) => route === "GET /bodies")).toHaveLength(1);
        } else {
          await vi.waitFor(() => {
            expect(HeightStatus.Uncertain.instanceOf(bodyHeight(experience.view.domain.body))).toBe(
              true,
            );
          });
          expect(screen.textContent).toMatch(/could not confirm your height/i);
          expect(Capability.Unavailable.instanceOf(screen.presentation?.canRequestTryOn)).toBe(
            true,
          );
        }
        expect(heightWrites).toBe(1);
      } else {
        const screen = await rendered(element, "sv-try-on-view-screen");
        await press(screen, 'sv-button[slot="primary"]');
        if (scenario === "body-not-found") {
          await vi.waitFor(() => {
            expect(screen.error).toContain("Your photo is no longer available");
          });
          const changePhoto = await rendered(screen, "sv-button", 'sv-button[slot="secondary"]');
          expect(changePhoto.textContent).toContain("Use a different photo");
          expect(bodyIdentity(experience.view.domain.body)?.bodyId).toBe(bodyId);
          expect(Capability.Unavailable.instanceOf(screen.presentation?.canRequestTryOn)).toBe(
            true,
          );
        } else if (scenario === "try-on-variant-mismatch") {
          await vi.waitFor(() => {
            expect(screen.state).toBe("error");
          });
          expect(screen.tryOns).toHaveLength(0);
          expect(experience.adapters.getResult?.(tryOnId)).toBeUndefined();
          expect(cart).not.toHaveBeenCalled();
          await press(screen, 'sv-button[slot="primary"]');
          await vi.waitFor(() => {
            expect(screen.tryOns).toHaveLength(1);
          });
          expect(experience.adapters.getResult?.(tryOnId)?.result.variantId).toBe(variantId);
        } else if (scenario === "recommendation-unavailable") {
          await vi.waitFor(() => {
            expect(screen.tryOns).toHaveLength(1);
          });
          await settleResultImage(screen);
          await vi.waitFor(() => {
            expect(screen.fit).toMatchObject({ state: "error", retryable: false });
          });
          expect(screen.textContent).not.toContain("Retry size recommendation");
          const fit = await rendered(screen, "sv-fit-score");
          expect(fit.shadowRoot?.querySelector("button")).toBeNull();
          expect(() => {
            experience.dispatch(
              new FlowAction.SizeRecommendation({
                action: SizeRecommendationAction.Retry,
              }),
            );
          }).toThrow(TryOnError.Rejected);
          expect(routes.filter((route) => route.endsWith("/recommended-size"))).toHaveLength(1);
        } else {
          await vi.waitFor(() => {
            expect(screen.tryOns).toHaveLength(1);
          });
          await settleResultImage(screen, "error");
          await element.updateComplete;
          await vi.waitFor(() => {
            expect(routes).toContain(`GET /try-ons/${tryOnId}`);
          });
          await vi.waitFor(() => {
            expect(experience.view.domain.session).toBe(SessionPhase.Absent);
          });
          const intro = await rendered(element, "sv-session-intro-screen");
          expect(intro.error).toMatch(/session has expired/i);
        }
      }
    } finally {
      element.remove();
      experience.dispose();
    }
  });
});

describe("additional state and journey probes", () => {
  it("keeps the earlier style in history when it has no exact companion", async () => {
    const fixture = await mountWithAdapters({ run: () => result() });
    const { element, experience, dispose } = fixture;
    try {
      const [buttoned, open] = installStyles(experience, ["Buttoned", "Open"], ["M", "L"], true);
      const screen = await rendered(element, "sv-try-on-view-screen");
      await press(screen, 'sv-button[slot="primary"]');
      await vi.waitFor(() => {
        expect(screen.presentation?.tryOns).toHaveLength(1);
      });
      const [old] = screen.presentation!.tryOns;
      await press(screen, 'sv-button[slot="primary"]');
      const picker = await rendered(screen, "sv-variant-picker");
      const size = await rendered(picker, "sv-option-group", "sv-option-group");
      const chip = [...(size.shadowRoot?.querySelectorAll("sv-chip") ?? [])].find(
        (el) => el.textContent?.trim() === "L",
      );
      expect(chip).toBeDefined();
      await chip!.updateComplete;
      chip!.shadowRoot?.querySelector("button")?.click();
      await vi.waitFor(() => {
        expect(screen.selection?.variantId).toBe(open.id);
      });
      await press(screen, 'sv-button[slot="primary"]');
      await vi.waitFor(() => {
        expect(screen.tryOns).toHaveLength(2);
      });
      expect(screen.tryOns.find((t) => t.id === old)?.key.variantId).toBe(buttoned.id);
      expect(screen.presentation?.tryOns).toContain(old);
      const toolbar = await rendered(screen, "sv-option-group", ".result-toolbar sv-option-group");
      const disabled = [...(toolbar.shadowRoot?.querySelectorAll("button") ?? [])].find((b) =>
        b.textContent?.includes("Buttoned"),
      );
      expect(disabled?.disabled).toBe(true);
      const history = screen.shadowRoot?.querySelector("sv-history-chip");
      history?.click();
      expect(
        (experience.view.screen as InstanceType<typeof ScreenView.TryOn>).inner.presentation
          .displayed,
      ).toEqual(new DisplayedImage.TryOn({ tryOnId: old }));
    } finally {
      dispose();
    }
  });

  it("cancels a queued render when no size is suitable", async () => {
    const rec = deferred<Outcome>();
    const first = deferred<Outcome>();
    const started = vi.fn<(variantId: string) => void>();
    const fixture = await mountWithAdapters({
      recommend: async () => await rec.promise,
      run(job): Outcome | Promise<Outcome> | undefined {
        if (Job.TryOn.instanceOf(job)) {
          started(job.inner.job.inner.key.variantId);
          return started.mock.calls.length === 1 ? result() : first.promise;
        }
      },
    });
    const { element, experience, dispose } = fixture;
    try {
      const [m, , l] = installStyles(experience, ["Buttoned", "Open"], ["M", "L"]);
      const screen = await rendered(element, "sv-try-on-view-screen");
      await press(screen, 'sv-button[slot="primary"]');
      await vi.waitFor(() => {
        expect(started).toHaveBeenCalledWith(m.id);
        expect(started).toHaveBeenCalledTimes(2);
      });
      experience.dispatch(
        new FlowAction.Selection({
          action: new SelectionAction.SelectItem({ axis: "size", item: "L" }),
        }),
      );
      await screen.updateComplete;
      await element.updateComplete;
      await screen.updateComplete;
      expect(screen.presentation?.mode).toBe(PresentationMode.EditingVariant);
      await press(screen, 'sv-button[slot="primary"]');
      await vi.waitFor(() => {
        expect(
          experience.view.domain.tryOnRequests.some(
            (r) => r.variantId === l.id && TryOnRequestStatus.Waiting.instanceOf(r.status),
          ),
        ).toBe(true);
      });
      rec.resolve(
        new Outcome.SizeRecommendation({
          outcome: new SizeRecommendationOutcome.Ranked({
            noSuitableSize: true,
            restrictions: [],
            scores: [],
            preferred: [],
          }),
        }),
      );
      await vi.waitFor(() => {
        expect(experience.view.domain.sizeRecommendation?.noSuitableSize).toBe(true);
      });
      await screen.updateComplete;
      expect(Capability.Unavailable.instanceOf(screen.presentation?.canRequestTryOn)).toBe(true);
      first.resolve(result());
      await vi.waitFor(() => {
        expect(
          experience.view.domain.tryOnRequests.some(
            (r) => r.variantId === l.id && TryOnRequestStatus.Failed.instanceOf(r.status),
          ),
        ).toBe(true);
      });
      expect(started).toHaveBeenCalledTimes(2);
    } finally {
      first.resolve(result());
      dispose();
    }
  });

  it("reports session creation failure during camera setup", async () => {
    const session = deferred<Outcome>();
    const fixture = await mountWithAdapters({
      restore: false,
      run: async () => await session.promise,
    });
    const { element, experience, events, dispose } = fixture;
    try {
      const intro = await rendered(element, "sv-session-intro-screen");
      const checkbox = await rendered(intro, "sv-checkbox");
      checkbox.shadowRoot?.querySelector("button")?.click();
      await press(intro, 'sv-button[slot="secondary"]');
      await rendered(element, "sv-photo-capture-screen");
      session.resolve(new Outcome.Failed({ error: BackendError.Internal }));
      await vi.waitFor(() => {
        expect(experience.view.domain.session).toBe(SessionPhase.CreateFailed);
      });
      expect(
        events.some(
          (e) => e.type === "sv-try-on-photo-source-cancelled" && e.detail.source === "camera",
        ),
      ).toBe(false);
      expect(events).toContainEqual(
        expect.objectContaining({
          type: "sv-try-on-session-failed",
          detail: expect.objectContaining({ reason: "internal" }),
        }),
      );
    } finally {
      dispose();
    }
  });
});

describe("host and companion probes", () => {
  it("keeps the current renderer open when the previous element disconnects", async () => {
    const fixture = await mountWithAdapters({});
    const replacement = document.createElement("sv-try-on-experience");
    replacement.experience = fixture.experience;
    document.body.append(replacement);
    try {
      const dialog = await rendered(replacement, "sv-dialog");
      expect(dialog.open).toBe(true);
      fixture.element.remove();
      await replacement.updateComplete;
      expect(fixture.experience.view.presence.foreground).toBe(true);
      expect(dialog.open).toBe(true);
    } finally {
      replacement.remove();
      fixture.dispose();
    }
  });

  it("uses the renderer that admitted cart work when a replacement attaches before delivery", async () => {
    const fixture = await mountWithAdapters({ run: () => result() });
    const { element, experience, dispose } = fixture;
    const originalCart = vi.fn<() => void>();
    const replacementCart = vi.fn<() => void>();
    const replacement = document.createElement("sv-try-on-experience");
    replacement.experience = experience;
    replacement.addToCart = replacementCart;
    element.addToCart = originalCart;
    try {
      const screen = await firstResult(fixture);
      await settleResultImage(screen);
      const button = await rendered(screen, "sv-button", 'sv-button[slot="secondary"]');
      const control = button.shadowRoot?.querySelector("button");
      expect(control?.disabled).toBe(false);
      const unsubscribe = experience.subscribe(() => {
        unsubscribe();
        control?.click();
        document.body.append(replacement);
      });
      experience.setUnavailableVariants([crypto.randomUUID()]);
      await vi.waitFor(() => {
        expect(originalCart).toHaveBeenCalledOnce();
      });
      expect(replacementCart).not.toHaveBeenCalled();
    } finally {
      replacement.remove();
      dispose();
    }
  });

  it("delivers a synchronous picker completion after the opening that caused it", async () => {
    const fixture = await mountWithAdapters({
      choosePhoto(token) {
        fixture.experience.completeDevice(
          new DeviceEvent.Picker({ event: new PickerEvent.Cancelled({ token }) }),
        );
      },
    });
    const owner = fixture.experience;
    try {
      owner.dispatch(new FlowAction.Photo({ action: new PhotoAction.Replace() }));
      owner.dispatch(
        new FlowAction.Photo({
          action: new PhotoAction.BeginSource({ source: PhotoSource.Library }),
        }),
      );
      expect(owner.view.modal).toBeUndefined();
      expect(
        fixture.events.filter(({ type }) => type.startsWith("sv-try-on-photo-source")),
      ).toEqual([
        expect.objectContaining({
          type: "sv-try-on-photo-source-started",
          detail: expect.objectContaining({ originStep: "variant-selection", source: "library" }),
        }),
        expect.objectContaining({
          type: "sv-try-on-photo-source-cancelled",
          detail: expect.objectContaining({ originStep: "variant-selection", source: "library" }),
        }),
      ]);
    } finally {
      fixture.dispose();
    }
  });

  it("publishes the new product with its stock in the same update", async () => {
    const { experience, dispose } = await mountWithAdapters({ open: false });
    const productId = crypto.randomUUID();
    const id = crypto.randomUUID();
    experience.adapters.getProductDetails = async () => ({
      productId,
      variants: [{ id, foreignVariantIds: new Map([["size", "M"]]) }],
    });
    const seen: string[][] = [];
    const unsubscribe = experience.subscribe(() => {
      const { domain } = experience.view;
      if (domain.product?.id === productId) {
        seen.push(domain.unavailableVariants);
      }
    });
    try {
      const installed = await experience.installProduct(
        productId,
        () => ({
          variantId: id,
          axes: [
            { key: "size", items: [{ key: "M", display: new ItemDisplay.Text({ text: "M" }) }] },
          ],
          chosenAxes: ["size"],
          labelFormats: [],
        }),
        [id],
      );
      expect(installed).toBe(true);
      expect(seen).toEqual([[id]]);
    } finally {
      unsubscribe();
      dispose();
    }
  });

  it("ignores an aborted install's failure after restarting the same host request", async () => {
    const { experience, dispose } = await mountWithAdapters({ open: false });
    type Details = Awaited<ReturnType<NonNullable<TryOnExperienceAdapters["getProductDetails"]>>>;
    const old = deferred<Details>();
    const current = deferred<Details>();
    const productId = crypto.randomUUID();
    const variantId = crypto.randomUUID();
    const request = crypto.randomUUID();
    const present = () => ({
      variantId,
      axes: [{ key: "size", items: [{ key: "M", display: new ItemDisplay.Text({ text: "M" }) }] }],
      labelFormats: [],
      chosenAxes: ["size"],
    });
    const pending = [old.promise, current.promise];
    experience.adapters.getProductDetails = async () =>
      await (pending.shift() ?? Promise.reject(new Error("Unexpected request")));
    const abort = new AbortController();
    try {
      const abandoned = experience.installProduct(productId, present, [], abort.signal, request);
      const previousToken = experience.view.productInstallation?.token;
      abort.abort();
      const restarted = experience.installProduct(
        productId,
        present,
        [],
        globalThis.undefined,
        request,
      );
      const token = experience.view.productInstallation?.token;
      expect(token).not.toBe(previousToken);
      old.reject(new Error("Old request was aborted"));
      await expect(abandoned).rejects.toThrow("Old request was aborted");
      current.resolve({
        productId,
        variants: [{ id: variantId, foreignVariantIds: new Map([["size", "M"]]) }],
      });
      await expect(restarted).resolves.toBe(true);
      expect(experience.readyInstallation(productId, request)).toBe(token);
    } finally {
      dispose();
    }
  });

  it("ignores stock updates for a superseded installation", async () => {
    const { experience, dispose } = await mountWithAdapters({});
    try {
      const [oldVariant] = installStyles(experience, ["Buttoned"]);
      const earlier = experience.view.productInstallation?.token;
      expect(earlier).toBeDefined();
      experience.setUnavailableVariants([oldVariant.id], earlier);
      expect(experience.view.domain.unavailableVariants).toEqual([oldVariant.id]);
      const [current] = installStyles(experience, ["Buttoned"]);
      expect(experience.view.domain.unavailableVariants).toEqual([]);
      const installed = experience.view.productInstallation?.token;
      experience.setUnavailableVariants([current.id], installed);
      experience.setUnavailableVariants([], earlier);
      expect(experience.view.domain.unavailableVariants).toEqual([current.id]);
    } finally {
      dispose();
    }
  });

  it("applies stock before synchronous auto-start", async () => {
    const pending = deferred<Outcome>();
    const run = vi.fn<() => Promise<Outcome>>(async () => await pending.promise);
    const fixture = await mountWithAdapters({
      open: false,
      autoStart: AutoStartPolicy.ExplicitPreselection,
      run,
    });
    const { experience, element, variantId, dispose } = fixture;
    try {
      experience.setUnavailableVariants([variantId]);
      experience.open();
      expect(run).not.toHaveBeenCalled();
      await element.updateComplete;
      expect(experience.view.domain.unavailableVariants).toContain(variantId);
      expect(experience.view.domain.tryOnRequests).toHaveLength(0);
    } finally {
      pending.resolve(result());
      dispose();
    }
  });

  it("keeps companion failures out of foreground failure analytics", async () => {
    let calls = 0;
    const fixture = await mountWithAdapters({
      run() {
        calls += 1;
        return calls === 1 ? result() : new Outcome.Failed({ error: BackendError.Internal });
      },
    });
    const { experience, events, element, dispose } = fixture;
    try {
      const [, open] = installStyles(experience, ["Buttoned", "Open"]);
      const screen = await rendered(element, "sv-try-on-view-screen");
      await press(screen, 'sv-button[slot="primary"]');
      await vi.waitFor(() => {
        expect(
          experience.view.domain.tryOnRequests.some(
            (r) => r.variantId === open.id && TryOnRequestStatus.Failed.instanceOf(r.status),
          ),
        ).toBe(true);
      });
      expect(
        events.some((e) => e.type === "sv-try-on-failed" && e.detail.variantId === open.id),
      ).toBe(false);
      expect(
        events.some((e) => e.type === "sv-try-on-requested" && e.detail.variantId === open.id),
      ).toBe(false);
      expect(screen.state).toBe("ready");
      expect(screen.error).toBeUndefined();
    } finally {
      dispose();
    }
  });
});

describe("storefront selection", () => {
  it("preserves an in-flight render when the storefront echoes the displayed variant", async () => {
    const next = deferred<Outcome>();
    const firstId = crypto.randomUUID();
    const secondId = crypto.randomUUID();
    const run = vi
      .fn<() => Outcome | Promise<Outcome>>()
      .mockReturnValueOnce(result(firstId))
      .mockReturnValue(next.promise);
    const fixture = await mountWithAdapters({ run });
    const { experience, dispose } = fixture;
    try {
      const [medium, large] = installStyles(experience, ["Buttoned"], ["M", "L"]);
      const screen = await firstResult(fixture);
      await settleResultImage(screen);
      expect(screen.presentation?.displayed).toEqual(
        new DisplayedImage.TryOn({ tryOnId: firstId }),
      );

      experience.setSelection({ size: "L", style: "Buttoned" });
      await vi.waitFor(() => {
        expect(screen.selection?.variantId).toBe(large.id);
      });
      expect(run).toHaveBeenCalledOnce();
      await press(screen, 'sv-button[slot="primary"]');
      await vi.waitFor(() => {
        expect(run).toHaveBeenCalledTimes(2);
      });
      const requests = experience.view.domain.tryOnRequests;
      experience.setSelection({ size: "M", style: "Buttoned" });
      expect(experience.view.domain.tryOnRequests).toEqual(requests);
      await screen.updateComplete;
      expect(screen.selection?.variantId).toBe(large.id);
      expect(screen.selection?.variantId).not.toBe(medium.id);

      experience.setSelection({});
      expect(experience.view.domain.tryOnRequests).toEqual(requests);
      next.resolve(result(secondId));
      await vi.waitFor(() => {
        expect(screen.presentation?.displayed).toEqual(
          new DisplayedImage.TryOn({ tryOnId: secondId }),
        );
      });
      expect(run).toHaveBeenCalledTimes(2);
    } finally {
      next.resolve(result(secondId));
      dispose();
    }
  });
});

async function firstResult(fixture: Awaited<ReturnType<typeof mountWithAdapters>>) {
  const screen = await rendered(fixture.element, "sv-try-on-view-screen");
  await press(screen, 'sv-button[slot="primary"]');
  await vi.waitFor(() => {
    expect(screen.tryOns.length).toBeGreaterThan(0);
  });
  return screen;
}
function editHeight(experience: TryOnExperience) {
  if (experience.screen.step === "try-on") {
    back(experience);
  }
  back(experience);
}

async function pressBack(screen: HTMLElementTagNameMap["sv-screen"]) {
  await screen.updateComplete;
  const button = screen.shadowRoot?.querySelector<HTMLButtonElement>("button.back");
  expect(button?.disabled).toBe(false);
  button?.click();
}

async function chooseLibrary(element: HTMLElementTagNameMap["sv-try-on-experience"]) {
  await press(element, "[data-photo-source] sv-button:nth-of-type(2)");
}

function back(experience: TryOnExperience) {
  experience.dispatch(new FlowAction.Navigation({ action: NavigationAction.Back }));
}
describe("result recovery and height navigation", () => {
  it("goes back from result to variant selection, height and the photo guide", async () => {
    const fixture = await mountWithAdapters({ run: () => result() });
    const { element, experience, dispose } = fixture;
    try {
      const screen = await firstResult(fixture);
      const displayed = screen.presentation?.displayed;
      await pressBack(await rendered(screen, "sv-screen"));
      expect(experience.screen.step).toBe("variant-selection");
      await screen.updateComplete;
      expect(screen.presentation?.displayed).toEqual(displayed);
      await pressBack(await rendered(screen, "sv-screen"));
      const height = await rendered(element, "sv-height-setting-screen");
      await pressBack(await rendered(height, "sv-screen"));
      const intro = await rendered(element, "sv-session-intro-screen");
      expect(intro.consented).toBe(true);
    } finally {
      dispose();
    }
  });

  it("cancels image renewal when the view is suspended", async () => {
    const fixture = await mountWithAdapters({ run: () => result() });
    const pending = deferred<null>();
    const { element, experience, dispose } = fixture;
    try {
      const refresh = vi.fn<(id: string, signal: AbortSignal) => Promise<void>>(async () => {
        await pending.promise;
      });
      experience.adapters.refreshResult = refresh;
      const screen = await firstResult(fixture);
      await settleResultImage(screen, "error");
      await element.updateComplete;
      await vi.waitFor(() => {
        expect(screen.resultImageState).toBe("loading");
      });
      const image = await rendered(screen, "sv-image", "sv-image[data-result]");
      const original = image.shadowRoot?.querySelector("img");
      experience.dispatch(new FlowAction.Presence({ action: PresenceAction.Suspend }));
      expect(refresh.mock.calls[0]?.[1].aborted).toBe(true);
      pending.resolve(null);
      await pending.promise;
      experience.dispatch(new FlowAction.Presence({ action: PresenceAction.Resume }));
      await element.updateComplete;
      await vi.waitFor(() => {
        expect(screen.resultImageState).toBe("error");
      });
      expect(image.shadowRoot?.querySelector("img")).toBe(original);
      expect(screen.textContent).toContain("The try-on image could not be loaded.");
    } finally {
      pending.resolve(null);
      dispose();
    }
  });

  it("renews an expired result before retrying the download", async () => {
    const fixture = await mountWithAdapters({ run: () => result() });
    const { element, experience, dispose } = fixture;
    try {
      const renewed = "/fresh-result.webp";
      const fetchImage = vi.fn<NonNullable<TryOnExperienceAdapters["fetchImage"]>>(async (src) => {
        if (src !== renewed) {
          throw new ImageFetchError(403);
        }
        // Stop before the native download. These mocks verify the URL handoff.
        throw new Error("No download in JSDOM");
      });
      let resultUrl: string | undefined;
      const renew = vi.fn<NonNullable<TryOnExperienceAdapters["refreshResult"]>>(async () => {
        resultUrl = renewed;
      });
      experience.adapters.fetchImage = fetchImage;
      experience.adapters.refreshResult = renew;
      experience.adapters.getResult = (id) =>
        resultUrl === undefined
          ? undefined
          : {
              result: {
                tryOnId: id,
                variantId: fixture.variantId,
                status: "completed",
                imageUrl: resultUrl,
                scene: { overlayColor: "#fff" },
              },
            };
      const screen = await firstResult(fixture);
      const original = screen.tryOns[0]?.imageUrl;
      await settleResultImage(screen);
      await element.updateComplete;
      await press(screen, "sv-button.download");
      await vi.waitFor(() => {
        expect(fetchImage).toHaveBeenCalledTimes(2);
      });
      expect(fetchImage.mock.calls.map(([src]) => src)).toEqual([original, renewed]);
      expect(renew).toHaveBeenCalledOnce();
    } finally {
      dispose();
    }
  });

  it("keeps independent cart and download failures for the displayed result", async () => {
    const fixture = await mountWithAdapters({ run: () => result() });
    const { element, experience, dispose } = fixture;
    const cart = deferred<undefined>();
    const download = deferred<Blob>();
    element.addToCart = async () => {
      await cart.promise;
    };
    const refresh = vi.fn<() => Promise<void>>().mockResolvedValue(globalThis.undefined);
    experience.adapters.refreshResult = refresh;
    experience.adapters.fetchImage = async () => await download.promise;
    try {
      const screen = await firstResult(fixture);
      await settleResultImage(screen);
      await press(screen, "sv-button.download");
      await press(screen, 'sv-button[slot="secondary"]');
      expect(experience.view.renderMedia?.download.pending).toBe(true);
      expect(experience.view.renderMedia?.cart.pending).toBe(true);
      download.reject(new Error("Download failed"));
      cart.reject(new Error("Cart failed"));
      await vi.waitFor(() => {
        expect(experience.view.renderMedia?.download).toMatchObject({
          failed: true,
          pending: false,
        });
        expect(experience.view.renderMedia?.cart).toMatchObject({ failed: true, pending: false });
        expect(screen.textContent).toMatch(/could not be added/i);
      });
      expect(refresh).not.toHaveBeenCalled();
    } finally {
      dispose();
    }
  });

  it("keeps stock published before the new product", async () => {
    const run = vi.fn<() => Outcome>(() => result());
    const fixture = await mountWithAdapters({ run });
    const { element, experience, dispose } = fixture;
    try {
      const id = crypto.randomUUID();
      const variantId = crypto.randomUUID();
      experience.setUnavailableVariants([variantId]);
      experience.dispatch(
        new FlowAction.Selection({
          action: new SelectionAction.HostProductUpdated({
            hostProduct: {
              product: { id, variants: [{ id: variantId, foreignIds: new Map([["size", "M"]]) }] },
              axes: [
                {
                  key: "size",
                  role: AxisRole.Size,
                  items: [{ key: "M", display: new ItemDisplay.Text({ text: "M" }) }],
                },
              ],
              variantId,
              chosenAxes: ["size"],
              labelFormats: [],
            },
          }),
        }),
      );
      const screen = await rendered(element, "sv-try-on-view-screen");
      expect(experience.view.domain.unavailableVariants).toContain(variantId);
      expect(screen.commerce?.[variantId]?.inStock).toBe(false);
      const button = await rendered(screen, "sv-button", 'sv-button[slot="primary"]');
      expect(button.disabled).toBe(true);
      expect(run).not.toHaveBeenCalled();
    } finally {
      dispose();
    }
  });

  it.each(["same URL", "different URLs"])(
    "keeps the decoded image and fit score mounted when switching results with %s",
    async (urls) => {
      const first = crypto.randomUUID();
      const second = crypto.randomUUID();
      let next = first;
      const fixture = await mountWithAdapters({
        recommend: (variantId) =>
          new Outcome.SizeRecommendation({
            outcome: new SizeRecommendationOutcome.Fetched({
              scores: [
                {
                  variantIds: [variantId],
                  aggregate: { fit: Fit.Ideal, fitMatch: 0.75 },
                  axes: [],
                },
              ],
            }),
          }),
        run(job) {
          if (Job.Body.instanceOf(job)) {
            return new Outcome.Body({ outcome: BodyOutcome.HeightSet });
          }
          return new Outcome.TryOn({
            outcome: new TryOnOutcome.Created({
              tryOnId: next,
              imageUrl: urls === "same URL" ? "/shared.webp" : `/${next}.webp`,
            }),
          });
        },
      });
      const { element, experience, events, dispose } = fixture;
      try {
        await firstResult(fixture);
        editHeight(experience);
        experience.dispatch(
          new FlowAction.Height({ action: new HeightAction.Edit({ height: 180 }) }),
        );
        await press(
          await rendered(element, "sv-height-setting-screen"),
          'sv-button[slot="primary"]',
        );
        const screen = await rendered(element, "sv-try-on-view-screen");
        next = second;
        await press(screen, 'sv-button[slot="primary"]');
        await vi.waitFor(() => {
          expect(screen.tryOns).toHaveLength(2);
        });
        await settleResultImage(screen);
        const photo = await rendered(screen, "sv-image", "sv-image[data-result]");
        expect(photo.sourceKey).toBe(second);
        const img = photo.shadowRoot?.querySelector('img[part="image"]');
        const score = await rendered(screen, "sv-fit-score");

        show(experience, first);
        await element.updateComplete;
        const incoming = await resultImage(screen);
        if (urls === "same URL") {
          expect(incoming).toBe(photo);
          expect(incoming.shadowRoot?.querySelector('img[part="image"]')).toBe(img);
        } else {
          expect(screen.resultImageState).toBe("loading");
          expect(Object.hasOwn(incoming.dataset, "pending")).toBe(true);
          expect(screen.shadowRoot?.querySelector("sv-image:not([data-pending])")).toBe(photo);
          expect(photo.shadowRoot?.querySelector('img[part="image"]')).toBe(img);
          await expect(rendered(screen, "sv-fit-score")).resolves.toBe(score);
          const decoded = incoming.shadowRoot?.querySelector('img[part="image"]');
          await settleResultImage(screen);
          await element.updateComplete;
          await expect(rendered(screen, "sv-image", "sv-image:not([data-pending])")).resolves.toBe(
            incoming,
          );
          expect(incoming.shadowRoot?.querySelector('img[part="image"]')).toBe(decoded);
        }
        expect(incoming.sourceKey).toBe(first);
        expect(screen.resultImageState).toBe("ready");
        await expect(rendered(screen, "sv-fit-score")).resolves.toBe(score);
        expect(events.findLast(({ type }) => type === "sv-try-on-presented")?.detail.tryOnId).toBe(
          first,
        );
      } finally {
        dispose();
      }
    },
  );

  it("keeps the result visible until the dialog finishes closing", async () => {
    const fixture = await mountWithAdapters({
      run: () => result(),
      recommend: (variantId) =>
        new Outcome.SizeRecommendation({
          outcome: new SizeRecommendationOutcome.Fetched({
            scores: [
              { variantIds: [variantId], aggregate: { fit: Fit.Ideal, fitMatch: 0.75 }, axes: [] },
            ],
          }),
        }),
    });
    const { element, experience, dispose } = fixture;
    const exit = Promise.withResolvers<undefined>();
    try {
      const screen = await firstResult(fixture);
      await settleResultImage(screen);
      const photo = await resultImage(screen);
      const picture = photo.shadowRoot?.querySelector("img");
      const score = await rendered(screen, "sv-fit-score");
      const dialog = await rendered(element, "sv-dialog");
      const native = dialog.shadowRoot!.querySelector("dialog")!;
      native.getAnimations = () => [{ finished: exit.promise } as Animation];

      experience.close();
      await element.updateComplete;
      await dialog.updateComplete;
      expect(native.open).toBe(true);
      expect(photo.shadowRoot?.querySelector("img")).toBe(picture);
      await expect(rendered(screen, "sv-fit-score")).resolves.toBe(score);

      exit.resolve(globalThis.undefined);
      await vi.waitFor(() => {
        expect(native.open).toBe(false);
        expect(screen.shadowRoot?.querySelector("sv-image")?.src).toBeUndefined();
      });
    } finally {
      exit.resolve(globalThis.undefined);
      dispose();
    }
  });

  it("reports the last visible result after a replacement finishes offscreen", async () => {
    const initial = crypto.randomUUID();
    const pending = deferred<Outcome>();
    let calls = 0;
    const fixture = await mountWithAdapters({
      run(job): Outcome | Promise<Outcome> {
        if (Job.Body.instanceOf(job)) {
          return new Outcome.Body({ outcome: BodyOutcome.HeightSet });
        }
        calls += 1;
        return calls === 1 ? result(initial) : pending.promise;
      },
    });
    const { element, experience, events, dispose } = fixture;
    try {
      let screen = await firstResult(fixture);
      editHeight(experience);
      experience.dispatch(
        new FlowAction.Height({ action: new HeightAction.Edit({ height: 180 }) }),
      );
      const height = await rendered(element, "sv-height-setting-screen");
      await press(height, 'sv-button[slot="primary"]');
      screen = await rendered(element, "sv-try-on-view-screen");
      await press(screen, 'sv-button[slot="primary"]');
      await settleResultImage(screen);
      await vi.waitFor(() => {
        expect(events.findLast((e) => e.type === "sv-try-on-presented")?.detail.tryOnId).toBe(
          initial,
        );
      });
      experience.dispatch(new FlowAction.Presence({ action: PresenceAction.Suspend }));
      const second = crypto.randomUUID();
      pending.resolve(result(second));
      await vi.waitFor(() => {
        const v = experience.view.screen;
        expect(ScreenView.TryOn.instanceOf(v) && v.inner.presentation.displayed).toEqual(
          new DisplayedImage.TryOn({ tryOnId: second }),
        );
      });
      experience.close();
      const closed = events.findLast((e) => e.type === "sv-try-on-closed");
      expect(closed?.detail.displayed).toEqual({ tryOnId: initial, variantId: fixture.variantId });
      expect(events.findLast((e) => e.type === "sv-try-on-presented")?.detail.tryOnId).toBe(
        initial,
      );
    } finally {
      pending.resolve(result());
      dispose();
    }
  });

  it("preserves a new height draft when the earlier save fails", async () => {
    const pending = deferred<Outcome>();
    const fixture = await mountWithAdapters({
      height: null,
      run: async () => await pending.promise,
    });
    const { element, experience, dispose } = fixture;
    try {
      await press(await rendered(element, "sv-height-setting-screen"), 'sv-button[slot="primary"]');
      editHeight(experience);
      const height = await rendered(element, "sv-height-setting-screen");
      expect(height.heightCm).toBe(172);
      experience.dispatch(
        new FlowAction.Height({ action: new HeightAction.Edit({ height: 181 }) }),
      );
      await height.updateComplete;
      expect(height.heightCm).toBe(181);
      pending.resolve(new Outcome.Failed({ error: BackendError.Internal }));
      await vi.waitFor(() => {
        expect(height.error).toMatch(/could not save/i);
      });
      expect(height.heightCm).toBe(181);
      expect(height.error).toMatch(/could not save/i);
    } finally {
      pending.resolve(new Outcome.Failed({ error: BackendError.Internal }));
      dispose();
    }
  });

  it("shows a height-save failure after returning from photo guidance", async () => {
    const pending = deferred<Outcome>();
    const fixture = await mountWithAdapters({
      height: null,
      run: async () => await pending.promise,
    });
    const { element, experience, dispose } = fixture;
    try {
      await press(await rendered(element, "sv-height-setting-screen"), 'sv-button[slot="primary"]');
      editHeight(experience);
      experience.dispatch(new FlowAction.Photo({ action: new PhotoAction.ShowGuide() }));
      await rendered(element, "sv-session-intro-screen");
      pending.resolve(new Outcome.Failed({ error: BackendError.Internal }));
      await vi.waitFor(() => {
        expect(HeightStatus.Unset.instanceOf(bodyHeight(experience.view.domain.body))).toBe(true);
      });
      back(experience);
      const height = await rendered(element, "sv-height-setting-screen");
      expect(height.error).toMatch(/could not save/i);
    } finally {
      pending.resolve(new Outcome.Failed({ error: BackendError.Internal }));
      dispose();
    }
  });

  it("confirms the highlighted height before the wheel settles", async () => {
    const run = vi.fn<TryOnExperienceAdapters["runJob"]>(
      () => new Outcome.Body({ outcome: BodyOutcome.HeightSet }),
    );
    const fixture = await mountWithAdapters({ height: null, run });
    const { element, dispose } = fixture;
    try {
      const height = await rendered(element, "sv-height-setting-screen");
      const field = await rendered(height, "sv-height-input");
      field.mode = "wheel";
      await field.updateComplete;
      const scroller = field.shadowRoot!.querySelector<HTMLElement>(".scroller")!;
      const row = scroller.querySelector(".row")!;
      vi.spyOn(row, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 100, 24));
      scroller.scrollTop = (185 - 140) * 24;
      scroller.dispatchEvent(new Event("scroll"));
      await field.updateComplete;
      expect(scroller.querySelector(".row.center")?.textContent).toBe("185 cm");
      expect(scroller.getAttribute("aria-valuenow")).toBe("185");
      await press(height, 'sv-button[slot="primary"]');
      await vi.waitFor(() => {
        expect(run.mock.calls[0]?.[0]).toMatchObject({
          inner: { job: { inner: { height: 185 } } },
        });
      });
    } finally {
      dispose();
    }
  });

  it("labels retained results from different styles distinctly", async () => {
    const first = crypto.randomUUID(),
      second = crypto.randomUUID();
    let renderCount = 0;
    const fixture = await mountWithAdapters({
      run(job) {
        if (Job.Body.instanceOf(job)) {
          return new Outcome.Body({ outcome: BodyOutcome.HeightSet });
        }
        if (!Job.TryOn.instanceOf(job)) {
          return;
        }
        renderCount += 1;
        if (renderCount === 1) {
          return result(first);
        }
        if (renderCount === 3) {
          return result(second);
        }
        return new Outcome.Failed({ error: BackendError.Unavailable });
      },
    });
    const { element, experience, dispose } = fixture;
    try {
      const [, opened] = installStyles(experience, ["Buttoned", "Open"]);
      await firstResult(fixture);
      await vi.waitFor(() => {
        expect(renderCount).toBe(2);
      });
      editHeight(experience);
      experience.dispatch(
        new FlowAction.Height({ action: new HeightAction.Edit({ height: 181 }) }),
      );
      await press(await rendered(element, "sv-height-setting-screen"), 'sv-button[slot="primary"]');
      experience.dispatch(
        new FlowAction.Selection({
          action: new SelectionAction.SelectItem({ axis: "style", item: "Open" }),
        }),
      );
      const screen = await rendered(element, "sv-try-on-view-screen");
      expect(screen.selection?.variantId).toBe(opened?.id);
      await press(screen, 'sv-button[slot="primary"]');
      await vi.waitFor(() => {
        expect(screen.presentation?.tryOns).toEqual([first, second]);
      });
      const chips = [...screen.shadowRoot!.querySelectorAll("sv-history-chip")];
      expect(chips).toHaveLength(2);
      expect(chips[0]?.label).toMatch(/buttoned/i);
      expect(chips[1]?.label).toMatch(/open/i);
      expect(chips[0]?.textContent?.trim()).toMatch(/buttoned/i);
      expect(chips[1]?.textContent?.trim()).toMatch(/open/i);
    } finally {
      dispose();
    }
  });
});

describe("camera, photo, and fit gates", () => {
  it("resumes with the selected rear camera", async () => {
    const constraints: MediaStreamConstraints[] = [];
    const cameras = ["front", "rear"].map((deviceId) => ({ kind: "videoinput", deviceId }));
    const original = Object.getOwnPropertyDescriptor(navigator, "mediaDevices");
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        async enumerateDevices() {
          return cameras;
        },
        async getUserMedia(input: MediaStreamConstraints) {
          constraints.push(input);
          const requested = typeof input.video === "object" ? input.video.deviceId : undefined;
          const exact =
            typeof requested === "object" && !Array.isArray(requested)
              ? requested.exact
              : undefined;
          const deviceId = typeof exact === "string" ? exact : "front";
          const track = Object.assign(new EventTarget(), {
            readyState: "live",
            stop() {
              this.readyState = "ended";
            },
            getSettings() {
              return { deviceId };
            },
          });
          return { getTracks: () => [track], getVideoTracks: () => [track] };
        },
      },
    });
    const owner: { experience?: TryOnExperience } = {};
    const devices = createBrowserTryOnDevices({
      capture: async () => {
        throw new Error("Unexpected capture");
      },
      complete: (event) => {
        owner.experience?.completeDevice(event);
      },
    });
    const fixture = await mountWithAdapters({ startDeviceEffect: devices.startDeviceEffect });
    const { element, experience, dispose } = fixture;
    owner.experience = experience;
    experience.adapters.getCamera = devices.getCamera;
    try {
      experience.dispatch(
        new FlowAction.Photo({
          action: new PhotoAction.BeginSource({ source: PhotoSource.Camera }),
        }),
      );
      const screen = await rendered(element, "sv-photo-capture-screen");
      await vi.waitFor(() => {
        expect(screen.state).toBe("live");
      });
      experience.dispatch(new FlowAction.Camera({ action: new CameraAction.Switch() }));
      await vi.waitFor(() => {
        expect(constraints[1]?.video).toEqual({ deviceId: { exact: "rear" } });
      });
      await vi.waitFor(() => {
        expect(screen.state).toBe("live");
      });
      experience.dispatch(new FlowAction.Presence({ action: PresenceAction.Suspend }));
      experience.dispatch(new FlowAction.Presence({ action: PresenceAction.Resume }));
      await vi.waitFor(() => {
        expect(constraints[2]?.video).toEqual({ deviceId: { exact: "rear" } });
      });
      await vi.waitFor(() => {
        expect(screen.state).toBe("live");
      });
    } finally {
      dispose();
      devices.dispose();
      if (original === undefined) {
        Reflect.deleteProperty(navigator, "mediaDevices");
      } else {
        Object.defineProperty(navigator, "mediaDevices", original);
      }
    }
  });

  it("announces file selection while the rejected-photo picker is open", async () => {
    const picker = deferred<DeviceEvent>();
    let count = 0;
    const fixture = await mountWithAdapters({
      height: null,
      run: () =>
        new Outcome.Photo({
          outcome: new PhotoOutcome.Rejected({ reason: PhotoRejection.NoHumanDetected }),
        }),
      choosePhoto(token): DeviceEvent | Promise<DeviceEvent> {
        count += 1;
        return count === 1
          ? new DeviceEvent.Picker({
              event: new PickerEvent.Selected({ token, media: crypto.randomUUID() }),
            })
          : picker.promise;
      },
    });
    const { element, experience, dispose } = fixture;
    try {
      await press(
        await rendered(element, "sv-height-setting-screen"),
        'sv-button[slot="secondary"]',
      );
      await chooseLibrary(element);
      await vi.waitFor(() => {
        expect(ScreenView.PhotoRejected.instanceOf(experience.view.screen)).toBe(true);
      });
      const rejected = await rendered(element, "sv-photo-upload-rejected-screen");
      await press(rejected, 'sv-button[slot="primary"]');
      await chooseLibrary(element);
      await vi.waitFor(() => {
        expect(Modal.Picker.instanceOf(experience.view.modal)).toBe(true);
      });
      const shell = await rendered(rejected, "sv-screen");
      expect(shell.statusMessage).toMatch(/choosing.*photo/i);
      expect(experience.view.photoChange?.newPhoto).toBeUndefined();
    } finally {
      dispose();
    }
  });

  it("explains an individual queued fit refusal", async () => {
    const rec = deferred<Outcome>();
    const first = deferred<Outcome>();
    const run = vi
      .fn<() => Outcome | Promise<Outcome>>()
      .mockReturnValueOnce(result())
      .mockReturnValue(first.promise);
    const fixture = await mountWithAdapters({ run, recommend: async () => await rec.promise });
    const { element, experience, events, dispose } = fixture;
    try {
      const [m, , l] = installStyles(experience, ["Buttoned", "Open"], ["M", "L"]);
      const screen = await rendered(element, "sv-try-on-view-screen");
      await press(screen, 'sv-button[slot="primary"]');
      await vi.waitFor(() => {
        expect(run).toHaveBeenCalledTimes(2);
      });
      experience.dispatch(
        new FlowAction.Selection({
          action: new SelectionAction.SelectItem({ axis: "size", item: "L" }),
        }),
      );
      await screen.updateComplete;
      await element.updateComplete;
      await screen.updateComplete;
      expect(screen.presentation?.mode).toBe(PresentationMode.EditingVariant);
      await press(screen, 'sv-button[slot="primary"]');
      await vi.waitFor(() => {
        expect(
          experience.view.domain.tryOnRequests.some(
            (r) => r.variantId === l.id && TryOnRequestStatus.Waiting.instanceOf(r.status),
          ),
        ).toBe(true);
      });
      rec.resolve(
        new Outcome.SizeRecommendation({
          outcome: new SizeRecommendationOutcome.Ranked({
            preferred: [m.id],
            scores: [],
            noSuitableSize: false,
            restrictions: [{ variantId: l.id, reason: RefusalReason.GarmentTooLarge }],
          }),
        }),
      );
      await vi.waitFor(() => {
        expect(screen.state).toBe("error");
      });
      const request = experience.view.domain.tryOnRequests.find((r) => r.variantId === l.id)!;
      expect(request.status).toEqual(
        new TryOnRequestStatus.Failed({
          failure: new TryOnRequestFailure.SizeRestricted({
            reason: RefusalReason.GarmentTooLarge,
          }),
        }),
      );
      expect(screen.error).toMatch(/too large/i);
      expect(screen.textContent).not.toMatch(/too large/i);
      expect(events.find((e) => e.type === "sv-try-on-refused")?.detail.reason).toBe(
        "garment-too-large",
      );
      expect(run).toHaveBeenCalledTimes(2);
    } finally {
      first.resolve(result());
      dispose();
    }
  });

  it("remembers multiple rejected heights for the same photo", async () => {
    const calls: number[] = [];
    const fixture = await mountWithAdapters({
      height: null,
      run(job) {
        if (Job.Body.instanceOf(job)) {
          calls.push(job.inner.job.inner.height);
        }
        return new Outcome.Failed({ error: BackendError.Unusable });
      },
    });
    const { element, experience, dispose } = fixture;
    try {
      let height = await rendered(element, "sv-height-setting-screen");
      await press(height, 'sv-button[slot="primary"]');
      await vi.waitFor(() => {
        expect(experience.view.heightNeedsChange).toBe(true);
      });
      height = await rendered(element, "sv-height-setting-screen");
      experience.dispatch(
        new FlowAction.Height({ action: new HeightAction.Edit({ height: 181 }) }),
      );
      await press(height, 'sv-button[slot="primary"]');
      await vi.waitFor(() => {
        expect(experience.view.heightNeedsChange).toBe(true);
      });
      height = await rendered(element, "sv-height-setting-screen");
      experience.dispatch(
        new FlowAction.Height({ action: new HeightAction.Edit({ height: 172 }) }),
      );
      const button = await rendered(height, "sv-button", 'sv-button[slot="primary"]');
      expect(button.disabled).toBe(true);
      expect(calls).toEqual([172, 181]);
    } finally {
      dispose();
    }
  });
});

describe("return navigation and storefront", () => {
  it("offers both replacement sources from selection and keeps the image after cancelling", async () => {
    const fixture = await mountWithAdapters({ run: () => result() });
    const { experience, element, dispose } = fixture;
    try {
      const screen = await firstResult(fixture);
      const displayed = screen.presentation?.displayed;
      await pressBack(await rendered(screen, "sv-screen"));
      await press(screen, 'sv-button[slot="secondary"]');

      const chooser = await rendered(element, "sv-dialog", "[data-photo-source]");
      expect(chooser.textContent).toContain("Take a photo");
      expect(chooser.textContent).toContain("Choose from library");
      await press(element, "[data-photo-source] sv-button:first-of-type");
      await rendered(element, "sv-photo-capture-screen");
      back(experience);
      const returned = await rendered(element, "sv-try-on-view-screen");
      expect(returned.presentation?.displayed).toEqual(displayed);
      expect(returned.photoSrc).toBe("/original.jpg");
    } finally {
      dispose();
    }
  });

  it("restores an unsubmitted height edit after cancelling photo replacement", async () => {
    const fixture = await mountWithAdapters({
      height: null,
      run: () => new Outcome.Failed({ error: BackendError.InvalidRequest }),
    });
    const { element, experience, dispose } = fixture;
    try {
      const height = await rendered(element, "sv-height-setting-screen");
      experience.dispatch(
        new FlowAction.Height({ action: new HeightAction.Edit({ height: 181 }) }),
      );
      await height.updateComplete;
      expect(height.heightCm).toBe(181);
      await press(height, 'sv-button[slot="secondary"]');
      await chooseLibrary(element);
      await vi.waitFor(() => {
        expect(
          NewPhotoStatus.Failed.instanceOf(experience.view.photoChange?.newPhoto?.status),
        ).toBe(true);
      });
      await pressBack(await rendered(element, "sv-screen"));
      const returned = await rendered(element, "sv-height-setting-screen");
      expect(returned.heightCm).toBe(181);
    } finally {
      dispose();
    }
  });

  it("keeps dismissal hidden when no recommendation badge is shown", async () => {
    const fixture = await mountWithAdapters({
      recommend: (variantId) =>
        new Outcome.SizeRecommendation({
          outcome: new SizeRecommendationOutcome.Ranked({
            preferred: [variantId],
            scores: [],
            noSuitableSize: false,
            restrictions: [],
          }),
        }),
    });
    const { element, experience, variantId, dispose } = fixture;
    try {
      const product = experience.view.domain.product!;
      experience.dispatch(
        new FlowAction.Selection({
          action: new SelectionAction.HostProductUpdated({
            hostProduct: {
              product,
              axes: [
                {
                  key: "size",
                  items: [{ key: "M", display: new ItemDisplay.Text({ text: "M" }) }],
                },
              ],
              variantId,
              chosenAxes: [],
              labelFormats: [],
            },
          }),
        }),
      );
      const screen = await rendered(element, "sv-try-on-view-screen");
      await vi.waitFor(() => {
        expect(screen.selection?.recommended).toBe(true);
      });
      const picker = await rendered(screen, "sv-variant-picker");
      expect(picker.shadowRoot?.textContent).not.toMatch(/recommended m/i);
      const row = await rendered(picker, "sv-option-group");
      expect(row.options.some((o) => o.status === "recommended")).toBe(false);
      expect(screen.textContent).not.toMatch(/dismiss.*recommendation/i);
    } finally {
      dispose();
    }
  });
});

describe("permanent failures and recovery", () => {
  it("drops a recommended variant after a permanent try-on failure", async () => {
    const recommendation = deferred<Outcome>();
    const { experience, element, dispose } = await mountWithAdapters({
      recommend: async () => await recommendation.promise,
      run: () => new Outcome.Failed({ error: BackendError.NotFound }),
    });
    try {
      const [medium] = installStyles(experience, ["Buttoned"], ["M", "L"]);
      recommendation.resolve(
        new Outcome.SizeRecommendation({
          outcome: new SizeRecommendationOutcome.Ranked({
            preferred: [medium.id],
            scores: [],
            noSuitableSize: false,
            restrictions: [],
          }),
        }),
      );
      const screen = await rendered(element, "sv-try-on-view-screen");
      await vi.waitFor(() => {
        expect(screen.selection?.recommendedVariantId).toBe(medium.id);
      });
      await press(screen, 'sv-button[slot="primary"]');
      await vi.waitFor(() => {
        expect(screen.state).toBe("error");
      });
      experience.dispatch(
        new FlowAction.Selection({
          action: new SelectionAction.SelectItem({ axis: "size", item: "L" }),
        }),
      );
      const picker = await rendered(screen, "sv-variant-picker");
      expect(picker.shadowRoot?.querySelector("button.recommendation")).toBeNull();
      expect(() => {
        experience.dispatch(
          new FlowAction.SizeRecommendation({
            action: SizeRecommendationAction.Select,
          }),
        );
      }).toThrow(TryOnError.Rejected);
    } finally {
      dispose();
    }
  });

  it.each([false, true])(
    "filters a refused alternative only when blocked (%s)",
    async (blocked) => {
      let largeId: string;
      const { experience, element, dispose } = await mountWithAdapters({
        run(job) {
          if (!Job.TryOn.instanceOf(job)) {
            return new Outcome.Failed({ error: BackendError.Internal });
          }
          return new Outcome.TryOn({
            outcome:
              job.inner.job.inner.key.variantId === largeId
                ? new TryOnOutcome.Refused({ reason: RefusalReason.GarmentTooLarge })
                : new TryOnOutcome.RefusedWithAlternative({
                    reason: RefusalReason.GarmentTooSmall,
                    alternative: new Map([["size", "L"]]),
                  }),
          });
        },
      });
      const select = (item: string) => {
        experience.dispatch(
          new FlowAction.Selection({
            action: new SelectionAction.SelectItem({ axis: "size", item }),
          }),
        );
      };
      try {
        const [, large] = installStyles(experience, ["Buttoned"], ["M", "L"]);
        largeId = large.id;
        const screen = await rendered(element, "sv-try-on-view-screen");
        if (blocked) {
          select("L");
          await press(screen, 'sv-button[slot="primary"]');
          await vi.waitFor(() => {
            expect(screen.error).toMatch(/too large/iu);
          });
          select("M");
        }
        await press(screen, 'sv-button[slot="primary"]');
        await vi.waitFor(() => {
          expect(screen.error).toMatch(/too small/iu);
        });
        expect(screen.presentation?.suggestedVariantId).toBe(blocked ? undefined : largeId);
        expect(screen.textContent?.includes("Suggested")).toBe(!blocked);
      } finally {
        dispose();
      }
    },
  );

  it("keeps a missing body blocked after a replacement fails and is cancelled", async () => {
    const heightCalls = vi.fn<(bodyId: string) => void>();
    const { experience, element, dispose } = await mountWithAdapters({
      height: null,
      run(job) {
        if (Job.Body.instanceOf(job)) {
          heightCalls(job.inner.job.inner.bodyId);
          return new Outcome.Failed({ error: BackendError.BodyNotFound });
        }
        return new Outcome.Failed({ error: BackendError.InvalidRequest });
      },
    });
    try {
      const screen = await rendered(element, "sv-height-setting-screen");
      await press(screen, 'sv-button[slot="primary"]');
      const failed = await renderedAfterUpdate(element, "sv-height-setting-screen");
      await vi.waitFor(() => {
        expect(failed.error).toMatch(/photo is no longer available/iu);
      });
      await press(failed, 'sv-button[slot="secondary"]');
      await chooseLibrary(element);
      await vi.waitFor(() => {
        expect(
          NewPhotoStatus.Failed.instanceOf(experience.view.photoChange?.newPhoto?.status),
        ).toBe(true);
      });
      await pressBack(await rendered(element, "sv-screen"));
      const returned = await rendered(element, "sv-height-setting-screen");
      expect(returned.error).toMatch(/photo is no longer available/iu);
      const confirm = await rendered(returned, "sv-button", 'sv-button[slot="primary"]');
      expect(confirm.disabled).toBe(true);
      expect(() => {
        experience.dispatch(new FlowAction.Height({ action: new HeightAction.Confirm() }));
      }).toThrow(TryOnError.Rejected);
      expect(heightCalls).toHaveBeenCalledOnce();
    } finally {
      dispose();
    }
  });

  it("ends the journey and shows a dismissible error when a completion breaks a Rust invariant", async () => {
    const sameId = crypto.randomUUID();
    const { experience, element, events, dispose } = await mountWithAdapters({
      run: () => result(sameId),
    });
    const technicalError = vi.fn<() => void>();
    element.addEventListener("sv-try-on-experience-error", technicalError);
    try {
      const [medium] = installStyles(experience, ["Buttoned"], ["M", "L"]);
      const screen = await rendered(element, "sv-try-on-view-screen");
      await press(screen, 'sv-button[slot="primary"]');
      await vi.waitFor(() => {
        expect(screen.presentation?.displayed.tag).toBe("TryOn");
      });
      await settleResultImage(screen);
      await vi.waitFor(() => {
        expect(events.some(({ type }) => type === "sv-try-on-presented")).toBe(true);
      });
      experience.dispatch(
        new FlowAction.Selection({
          action: new SelectionAction.SelectItem({ axis: "size", item: "L" }),
        }),
      );
      experience.dispatch(
        new FlowAction.Presentation({ action: new PresentationAction.RequestTryOn() }),
      );
      await vi.waitFor(() => {
        expect(experience.failure).toBeDefined();
      });
      const dialog = await rendered(element, "sv-dialog");
      expect(experience.view.presence).toMatchObject({ open: false, disposed: true });
      expect(dialog.open).toBe(true);
      expect(dialog.textContent).toContain("ended unexpectedly");
      expect(element.shadowRoot?.querySelector("sv-try-on-view-screen")).toBeNull();
      expect(technicalError).toHaveBeenCalledOnce();
      const closed = events.filter(({ type }) => type === "sv-try-on-closed");
      expect(closed).toHaveLength(1);
      expect(closed[0]?.detail.displayed).toEqual({ tryOnId: sameId, variantId: medium.id });
      await press(element, ".confirmation sv-button");
      await element.updateComplete;
      expect(dialog.open).toBe(false);
    } finally {
      dispose();
    }
  });

  it("discards a late bearer refresh after a new credential is installed", async () => {
    await initializeTestUi();
    const api = { baseUrl: "https://api.example.test", clientApiKey: crypto.randomUUID() };
    const renewal = deferred<Response>();
    const capturedRefresh = vi.fn<(authorization: string | null) => void>();
    let generation = 0;
    const fresh = "2099-01-01T00:00:00Z";
    const fetch: typeof globalThis.fetch = async (input, init) => {
      const request = new Request(input, init);
      switch (`${request.method} ${new URL(request.url).pathname}`) {
        case "POST /session/cookie/prepare": {
          return Response.json({ challenge: "prepared" });
        }
        case "POST /session/cookie": {
          return Response.json(
            { kind: "session-cookie-unavailable", title: "Cookie blocked" },
            { status: 400 },
          );
        }
        case "POST /session/bearer": {
          generation += 1;
          const expiresAt = generation === 1 ? new Date(Date.now() + 60_000).toISOString() : fresh;
          return Response.json({ token: `token-${generation}`, expiresAt }, { status: 201 });
        }
        case "POST /session/bearer/refresh": {
          capturedRefresh(request.headers.get("Authorization"));
          return await renewal.promise;
        }
        case "GET /session": {
          expect(request.headers.get("Authorization")).toBe("Bearer token-2");
          return Response.json({ expiresAt: fresh });
        }
        default: {
          throw new Error(`Unexpected request ${request.url}`);
        }
      }
    };
    const client = new ApiClient(api, browserTransport(fetch));
    try {
      const session = apiSession(
        client,
        fetch,
        await bodySelectionStore(api.baseUrl, api.clientApiKey),
      );
      // oxlint-disable-next-line typescript/no-unsafe-enum-assignment -- Granted is the sole generated consent value.
      const create = new SessionJob.Create({ dataProcessingConsent: 0 });
      const signal = new AbortController().signal;
      const created = await session.run(create, signal);
      expect(created.tag).toBe("Session");
      const oldRefresh = Promise.allSettled([session.beforeAuthenticatedRequest()]);
      await vi.waitFor(() => {
        expect(capturedRefresh).toHaveBeenCalledWith("Bearer token-1");
      });
      session.clear(true);
      const recreated = await session.run(create, signal);
      expect(recreated.tag).toBe("Session");
      renewal.resolve(Response.json({ token: "renewed-token-1", expiresAt: fresh }));
      await expect(oldRefresh).resolves.toMatchObject([{ status: "rejected" }]);
      await expect(
        session.authenticated(signal, async (scoped) => await scoped.getSession()),
      ).resolves.toEqual({ expiresAt: fresh });
    } finally {
      client.uniffiDestroy();
    }
  });
});

describe("device recovery across transitions", () => {
  it("blocks height writes after a try-on establishes that the body is gone", async () => {
    const heightWrites = vi.fn<(height: number) => void>();
    const { experience, element, dispose } = await mountWithAdapters({
      run(job) {
        if (Job.Body.instanceOf(job)) {
          heightWrites(job.inner.job.inner.height);
        }
        return new Outcome.Failed({ error: BackendError.BodyNotFound });
      },
    });
    try {
      const screen = await rendered(element, "sv-try-on-view-screen");
      await press(screen, 'sv-button[slot="primary"]');
      await vi.waitFor(() => {
        expect(screen.error).toMatch(/photo is no longer available/iu);
      });
      await pressBack(await rendered(screen, "sv-screen"));
      const height = await rendered(element, "sv-height-setting-screen");
      expect(height.confirmDisabled).toBe(true);
      await press(height, 'sv-button[slot="secondary"]');
      expect(Modal.ChoosePhotoSource.instanceOf(experience.view.modal)).toBe(true);
      expect(heightWrites).not.toHaveBeenCalled();
    } finally {
      dispose();
    }
  });

  it("shows a fatal error that occurred in a background tab", async () => {
    const second = deferred<Outcome>();
    const id = crypto.randomUUID();
    let requests = 0;
    const { experience, element, dispose } = await mountWithAdapters({
      async run() {
        requests += 1;
        return requests === 1 ? result(id) : await second.promise;
      },
    });
    try {
      installStyles(experience, ["Buttoned"], ["M", "L"]);
      const screen = await rendered(element, "sv-try-on-view-screen");
      await press(screen, 'sv-button[slot="primary"]');
      await vi.waitFor(() => {
        expect(screen.presentation?.displayed.tag).toBe("TryOn");
      });
      experience.dispatch(
        new FlowAction.Selection({
          action: new SelectionAction.SelectItem({ axis: "size", item: "L" }),
        }),
      );
      experience.dispatch(
        new FlowAction.Presentation({ action: new PresentationAction.RequestTryOn() }),
      );
      experience.dispatch(new FlowAction.Presence({ action: PresenceAction.Suspend }));
      second.resolve(result(id));
      await vi.waitFor(() => {
        expect(experience.failure).toBeDefined();
      });
      experience.dispatch(new FlowAction.Presence({ action: PresenceAction.Resume }));
      const dialog = await rendered(element, "sv-dialog");
      expect(dialog.open).toBe(true);
      expect(dialog.textContent).toContain("ended unexpectedly");
    } finally {
      dispose();
    }
  });

  it("allows a valid draft while a different toolbar variant is rendering", async () => {
    const other = deferred<Outcome>();
    const seen: string[] = [];
    const { experience, element, dispose } = await mountWithAdapters({
      async run(job) {
        if (!Job.TryOn.instanceOf(job)) {
          return new Outcome.Failed({ error: BackendError.Internal });
        }
        seen.push(job.inner.job.inner.key.variantId);
        return seen.length === 1 ? result() : await other.promise;
      },
    });
    try {
      const [medium, mediumOpen, large] = installStyles(
        experience,
        ["Buttoned", "Open"],
        ["M", "L"],
      );
      const screen = await rendered(element, "sv-try-on-view-screen");
      await press(screen, 'sv-button[slot="primary"]');
      await vi.waitFor(() => {
        expect(screen.presentation?.displayed.tag).toBe("TryOn");
      });
      await settleResultImage(screen);
      experience.dispatch(
        new FlowAction.Selection({
          action: new SelectionAction.SelectItem({ axis: "size", item: "L" }),
        }),
      );
      experience.dispatch(
        new FlowAction.Presentation({
          action: new PresentationAction.ShowAxisItem({ axis: "style", item: "Open" }),
        }),
      );
      await vi.waitFor(() => {
        expect(screen.state).toBe("generating");
      });
      expect(screen.requestPending).toBe(true);
      expect(seen).toEqual([medium.id, mediumOpen.id]);
      expect(screen.selection?.variantId).toBe(large.id);
      expect(screen.presentation?.canRequestTryOn.tag).toBe("Unavailable");
      await screen.updateComplete;
      if (screen.presentation?.mode === PresentationMode.Result) {
        await press(screen, 'sv-button[slot="primary"]');
      }
      const submit = await rendered(screen, "sv-button", 'sv-button[slot="primary"]');
      expect(submit.disabled).toBe(true);
      other.resolve(result());
      await vi.waitFor(() => {
        expect(screen.presentation?.canRequestTryOn.tag).toBe("Available");
      });
      expect(seen).toEqual([medium.id, mediumOpen.id]);
    } finally {
      dispose();
    }
  });

  it("clears a removed variant and does not close the source photo when its cart request finishes", async () => {
    const { experience, element, events, dispose } = await mountWithAdapters({
      run: () => result(),
    });
    const cart = deferred<undefined>();
    const add = vi.fn<() => Promise<undefined>>(async () => {
      await cart.promise;
    });
    element.addToCart = add;
    try {
      const [, large] = installStyles(experience, ["Buttoned"], ["M", "L"]);
      const screen = await rendered(element, "sv-try-on-view-screen");
      await press(screen, 'sv-button[slot="primary"]');
      await vi.waitFor(() => {
        expect(screen.presentation?.displayed.tag).toBe("TryOn");
      });
      await settleResultImage(screen);
      await vi.waitFor(() => {
        expect(events.some((e) => e.type === "sv-try-on-presented")).toBe(true);
      });
      await press(screen, 'sv-button[slot="secondary"]');
      expect(add).toHaveBeenCalledOnce();
      experience.dispatch(
        new FlowAction.Selection({
          action: new SelectionAction.HostProductUpdated({
            hostProduct: {
              product: { id: experience.view.domain.product!.id, variants: [large] },
              axes: [
                {
                  key: "size",
                  role: AxisRole.Size,
                  items: [{ key: "L", display: new ItemDisplay.Text({ text: "L" }) }],
                },
                {
                  key: "style",
                  items: [{ key: "Buttoned", display: new ItemDisplay.Text({ text: "Buttoned" }) }],
                },
              ],
              variantId: large.id,
              chosenAxes: ["size", "style"],
              labelFormats: [],
            },
          }),
        }),
      );
      await element.updateComplete;
      const image = await rendered(screen, "sv-image", "sv-image[slot=stage]");
      expect(image.src).toBe("/original.jpg");
      expect(screen.presentation?.displayed.tag).toBe("SourcePhoto");
      expect(screen.presentation?.tryOns).toHaveLength(0);
      expect(experience.view.presence.open).toBe(true);
      cart.resolve(globalThis.undefined);
      await cart.promise;
      await element.updateComplete;
      expect(experience.view.presence.open).toBe(true);
      expect(events.some((e) => e.type === "sv-try-on-closed")).toBe(false);
    } finally {
      dispose();
    }
  });

  async function apiFixture(
    testFetch?: (request: Request, route: string) => Response | Promise<Response> | undefined,
    heightSaved = true,
    upload?: Blob,
  ) {
    await initializeTestUi();
    defineSvTryOnExperience();
    stubDialogMethods();
    const [productId, variantId, largeId, bodyId, bodyRevisionId] = Array.from({ length: 5 }, () =>
      crypto.randomUUID(),
    );
    const expiresAt = "2099-01-01T00:00:00Z";
    const api = { baseUrl: "https://api.example.test", clientApiKey: crypto.randomUUID() };
    const variants = [
      { id: variantId, foreignVariantIds: { size: "M" } },
      { id: largeId, foreignVariantIds: { size: "L" } },
    ];
    const routes: string[] = [];
    const store = await bodySelectionStore(api.baseUrl, api.clientApiKey);
    const remember = () => {
      store.save({ id: bodyId, source: PhotoSource.Library });
    };
    remember();
    const presentProduct = (label = "Size") => ({
      axes: [
        {
          key: "size",
          label,
          role: AxisRole.Size,
          items: ["M", "L"].map((key) => ({ key, display: new ItemDisplay.Text({ text: key }) })),
        },
      ],
      variantId,
      chosenAxes: ["size"],
      labelFormats: [],
    });
    const fetch: typeof globalThis.fetch = async (input, init) => {
      const request = new Request(input, init);
      const route = `${request.method} ${new URL(request.url).pathname}`;
      routes.push(route);
      const testResponse = await testFetch?.(request, route);
      if (testResponse !== undefined) {
        return testResponse;
      }
      switch (route) {
        case "GET /session": {
          return Response.json({ expiresAt });
        }
        case "GET /bodies": {
          return Response.json({
            bodies: [
              {
                bodyId,
                bodyRevisionId,
                createdAt: expiresAt,
                sourceImageUrl: "/original.jpg",
                sourceImageUrlExpiresAt: expiresAt,
                estimatedHeightCm: 170,
                ...(heightSaved && { userProvidedHeightCm: 170 }),
              },
            ],
          });
        }
        case `GET /products/${productId}`: {
          return Response.json({ productId, variants });
        }
        case `GET /products/${productId}/recommended-size`: {
          return Response.json({ bodyRevisionId, recommendations: [] });
        }
        case "DELETE /session": {
          return new Response(null, { status: 204 });
        }
        default: {
          throw new Error(route);
        }
      }
    };
    const connect = async (
      phase = SessionPhase.Ready,
      product?: { foreignId: string },
      present: PresentProduct = () => presentProduct(),
    ) => {
      const experience = await createApiTryOnExperience({
        api,
        product: product ?? { productId },
        fetch,
        presentProduct: present,
        devices: {
          applyDomainMediaEffect: vi.fn<() => void>(),
          startDeviceEffect(effect) {
            if (
              upload &&
              DeviceEffect.Picker.instanceOf(effect) &&
              PickerEffect.Open.instanceOf(effect.inner.effect)
            ) {
              return new DeviceEvent.Picker({
                event: new PickerEvent.Selected({
                  token: effect.inner.effect.inner.token,
                  media: crypto.randomUUID(),
                }),
              });
            }
          },
          restorePhoto: () => crypto.randomUUID(),
          getPhoto: () => ({ src: "/original.jpg" }),
          getUploadPhoto: () => upload,
          getCamera: vi.fn<() => undefined>(),
          dispose: vi.fn<() => void>(),
        },
      });
      await vi.waitFor(() => {
        expect(experience.view.domain.session).toBe(phase);
      });
      return experience;
    };
    return {
      api,
      fetch,
      productId,
      bodyId,
      bodyRevisionId,
      variantId,
      largeId,
      store,
      remember,
      presentProduct,
      connect,
      routes,
    };
  }

  it("uses storefront IDs at startup and on navigation, including missing and superseded products", async () => {
    const jacketId = crypto.randomUUID();
    const staleRead = deferred<Response>();
    const fixture = await apiFixture(async (_request, route) => {
      switch (route) {
        case "GET /products/by-foreign-id/shirt":
        case "GET /products/by-foreign-id/jacket": {
          return Response.json({
            productId: route.endsWith("shirt") ? fixture.productId : jacketId,
            variants: [
              { id: fixture.variantId, foreignVariantIds: { size: "M" } },
              { id: fixture.largeId, foreignVariantIds: { size: "L" } },
            ],
          });
        }
        case "GET /products/by-foreign-id/missing": {
          return new Response(null, { status: 404 });
        }
        case "GET /products/by-foreign-id/stale": {
          return await staleRead.promise;
        }
        default: {
          break;
        }
      }
    });
    const shirt = { foreignId: "shirt" };
    const jacket = { foreignId: "jacket" };
    const experience = await fixture.connect(SessionPhase.Ready, shirt);
    const present = () => fixture.presentProduct();
    try {
      const initial = experience.view.productInstallation?.request;
      expect(experience.readyInstallation(shirt, initial)).toBeDefined();
      expect(experience.open()).toBe(true);

      const missing = experience.installProduct({ foreignId: "missing" }, present);
      await expect(missing).rejects.toSatisfy(isTryOnProductUnavailable);
      expect(fixture.routes).toContain("GET /products/by-foreign-id/missing");
      expect(experience.readyInstallation(shirt, initial)).toBeUndefined();
      expect(experience.view.presence.open).toBe(false);
      expect(experience.open()).toBe(false);

      const stale = experience.installProduct({ foreignId: "stale" }, present);
      await vi.waitFor(() => {
        expect(fixture.routes).toContain("GET /products/by-foreign-id/stale");
      });
      const request = crypto.randomUUID();
      await expect(
        experience.installProduct(jacket, present, [fixture.largeId], undefined, request),
      ).resolves.toBe(true);
      staleRead.resolve(Response.json({ productId: fixture.productId, variants: [] }));
      await expect(stale).resolves.toBe(false);
      expect(experience.readyInstallation(jacket, request)).toBeDefined();
      expect(experience.view.domain.product?.id).toBe(jacketId);
      expect(experience.view.domain.unavailableVariants).toEqual([fixture.largeId]);
      expect(fixture.routes).not.toContain(`GET /products/${jacketId}`);
    } finally {
      experience.dispose();
    }
  });

  it("installs initial commerce and updates the mounted screen for the current installation", async () => {
    const fixture = await apiFixture();
    const { variantId, largeId, productId } = fixture;
    const initial = {
      [variantId]: { price: "€89" },
      [largeId]: { price: "€99", inStock: false },
    };
    const present = () => ({ ...fixture.presentProduct(), commerce: initial });
    const experience = await fixture.connect(SessionPhase.Ready, undefined, present);
    const element = document.createElement("sv-try-on-experience");
    try {
      const installation = experience.view.readyInstallation!;
      expect(installation).toBeDefined();
      expect(experience.view.domain.unavailableVariants).toEqual([largeId]);
      expect(experience.prices).toEqual({ [variantId]: "€89", [largeId]: "€99" });

      element.experience = experience;
      document.body.append(element);
      expect(experience.open()).toBe(true);
      await vi.waitFor(async () => {
        const screen = await rendered(element, "sv-try-on-view-screen");
        expect(screen.commerce?.[variantId]?.price).toBe("€89");
      });
      const screen = await rendered(element, "sv-try-on-view-screen");
      experience.updateCommerce({ [variantId]: { price: "€79" } }, installation);
      await element.updateComplete;
      await expect(rendered(element, "sv-try-on-view-screen")).resolves.toBe(screen);
      expect(screen.commerce?.[variantId]?.price).toBe("€79");
      expect(experience.view.domain.unavailableVariants).toEqual([largeId]);
      expect(experience.view.readyInstallation).toBe(installation);

      experience.updateCommerce({ [largeId]: { inStock: true } }, installation);
      expect(experience.prices?.[variantId]).toBe("€89");
      expect(experience.view.domain.unavailableVariants).toEqual([]);

      await expect(
        experience.installProduct(productId, () => ({
          ...fixture.presentProduct(),
          commerce: { [variantId]: { price: "€109", inStock: false } },
        })),
      ).resolves.toBe(true);
      expect(experience.view.readyInstallation).not.toBe(installation);
      experience.updateCommerce({ [variantId]: { price: "€1", inStock: true } }, installation);
      expect(experience.prices).toEqual({ [variantId]: "€109" });
      expect(experience.view.domain.unavailableVariants).toEqual([variantId]);
    } finally {
      element.remove();
      experience.dispose();
    }
  });

  it.each(["startup", "product switch"] as const)(
    "rejects a response for a different product during %s",
    async (when) => {
      const otherProduct = crypto.randomUUID();
      const fixture = await apiFixture((_request, route) => {
        if (when === "startup" && route === `GET /products/${fixture.productId}`) {
          return Response.json({ productId: otherProduct, variants: [] });
        }
        if (route === `GET /products/${otherProduct}`) {
          return Response.json({ productId: fixture.productId, variants: [] });
        }
      });
      if (when === "startup") {
        await expect(fixture.connect()).rejects.toThrow(ApiError.Decode);
        expect(fixture.routes).not.toContain("GET /session");
        return;
      }
      const experience = await fixture.connect();
      const present = vi.fn<() => ReturnType<typeof fixture.presentProduct>>(() =>
        fixture.presentProduct(),
      );
      try {
        await expect(experience.installProduct(otherProduct, present)).rejects.toThrow(
          ApiError.Decode,
        );
        expect(present).not.toHaveBeenCalled();
        expect(experience.view.domain.product?.id).toBe(fixture.productId);
      } finally {
        experience.dispose();
      }
    },
  );

  it("renews the committed photo when reopening near expiry without a renderer", async () => {
    const now = Date.now();
    const clock = vi.spyOn(Date, "now").mockReturnValue(now);
    let bodyReads = 0;
    const fixture = await apiFixture((_request, route) => {
      if (route !== "GET /bodies") {
        return;
      }
      bodyReads += 1;
      return Response.json({
        bodies: [
          {
            bodyId: fixture.bodyId,
            bodyRevisionId: fixture.bodyRevisionId,
            createdAt: new Date(now).toISOString(),
            sourceImageUrl: bodyReads === 1 ? "/original.jpg" : "/renewed.jpg",
            sourceImageUrlExpiresAt: new Date(
              now + (bodyReads === 1 ? 60_000 : 120_000),
            ).toISOString(),
            estimatedHeightCm: 170,
            userProvidedHeightCm: 170,
          },
        ],
      });
    });
    const experience = await fixture.connect();
    try {
      const { media } = experience.view.domain.photo!;
      experience.open();
      expect(bodyReads).toBe(1);
      experience.close();
      clock.mockReturnValue(now + 56_000);
      experience.open();
      await vi.waitFor(() => {
        expect(experience.adapters.getPhoto(media)?.src).toBe("/renewed.jpg");
      });
      expect(bodyReads).toBe(2);
    } finally {
      experience.dispose();
      clock.mockRestore();
    }
  });

  it("keeps a refreshed session and result after a request using the previous credential is rejected", async () => {
    const oldRecommendation = deferred<Response>();
    const tryOnId = crypto.randomUUID();
    const initialTime = Date.now();
    const clock = vi.spyOn(Date, "now").mockReturnValue(initialTime);
    const fixture = await apiFixture(
      (_request, route): Response | Promise<Response> | undefined => {
        if (route === "GET /session") {
          return Response.json({ expiresAt: new Date(initialTime + 301_000).toISOString() });
        }
        if (route === "POST /session/cookie/refresh") {
          return Response.json({ expiresAt: new Date(initialTime + 600_000).toISOString() });
        }
        if (route === `GET /products/${fixture.productId}/recommended-size`) {
          return oldRecommendation.promise;
        }
        if (route === `POST /products/${fixture.productId}/try-on`) {
          return Response.json(
            {
              status: "completed",
              tryOnId,
              variantId: fixture.variantId,
              bodyRevisionId: fixture.bodyRevisionId,
              imageUrl: "/result.webp",
              scene: { overlayColor: "#ffffff" },
            },
            { status: 201 },
          );
        }
      },
    );
    const experience = await fixture.connect();
    try {
      expect(experience.open()).toBe(true);
      await vi.waitFor(() => {
        expect(fixture.routes).toContain(`GET /products/${fixture.productId}/recommended-size`);
      });
      clock.mockReturnValue(initialTime + 2_000);
      experience.dispatch(
        new FlowAction.Presentation({ action: new PresentationAction.RequestTryOn() }),
      );
      await vi.waitFor(() => {
        expect(experience.view.domain.tryOns[0]?.id).toBe(tryOnId);
      });
      expect(fixture.routes).toContain("POST /session/cookie/refresh");
      oldRecommendation.resolve(
        Response.json({ kind: "session-invalid", title: "Old credential" }, { status: 401 }),
      );
      await vi.waitFor(() => {
        expect(experience.view.domain.sizeRecommendationError).toBe(BackendError.Unavailable);
      });
      expect(experience.view.domain.session).toBe(SessionPhase.Ready);
      expect(experience.view.domain.tryOns[0]?.id).toBe(tryOnId);
    } finally {
      oldRecommendation.resolve(Response.error());
      experience.dispose();
      clock.mockRestore();
    }
  });

  it("does not authenticate an older mount with a newer cookie", async () => {
    await initializeTestUi();
    const api = { baseUrl: "https://api.example.test", clientApiKey: crypto.randomUUID() };
    const fetch = vi.fn<typeof globalThis.fetch>();
    const client = new ApiClient(api, browserTransport(fetch));
    try {
      const original = await bodySelectionStore(api.baseUrl, api.clientApiKey);
      original.beginSession();
      const session = apiSession(client, fetch, original);
      const newer = await bodySelectionStore(api.baseUrl, api.clientApiKey);
      newer.beginSession();

      const outcome = await session.run(new SessionJob.Restore(), new AbortController().signal);
      expect(Outcome.SessionExpired.instanceOf(outcome)).toBe(true);
      session.clear(false);
      await expect(session.beforeAuthenticatedRequest()).rejects.toThrow("cookie session changed");
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      client.uniffiDestroy();
    }
  });

  it.each(["selection", "cookie"] as const)(
    "discards an in-flight body restore when the saved %s changes",
    async (change) => {
      await initializeTestUi();
      const api = { baseUrl: "https://api.example.test", clientApiKey: crypto.randomUUID() };
      const selection = await bodySelectionStore(api.baseUrl, api.clientApiKey);
      const peer = await bodySelectionStore(api.baseUrl, api.clientApiKey);
      const first = { id: crypto.randomUUID(), source: PhotoSource.Library };
      const second = { id: crypto.randomUUID(), source: PhotoSource.Camera };
      selection.save(first);
      const expiresAt = "2099-01-01T00:00:00Z";
      const body = (id: string, url: string) => ({
        bodyId: id,
        createdAt: expiresAt,
        estimatedHeightCm: 170,
        sourceImageUrl: url,
        sourceImageUrlExpiresAt: expiresAt,
      });
      const started = deferred<boolean>();
      const pending = deferred<Response>();
      let bodyReads = 0;
      const fetch: typeof globalThis.fetch = async (input, init) => {
        const path = new URL(new Request(input, init).url).pathname;
        if (path === "/session") {
          return Response.json({ expiresAt });
        }
        bodyReads += 1;
        if (bodyReads === 1) {
          started.resolve(true);
          return await pending.promise;
        }
        return Response.json({ bodies: [body(second.id, "/fresh.jpg")] });
      };
      const client = new ApiClient(api, browserTransport(fetch));
      const register = vi.fn<(url: string) => string>(() => crypto.randomUUID());
      const session = apiSession(client, fetch, selection, register);
      try {
        const restore = session.run(new SessionJob.Restore(), new AbortController().signal);
        await started.promise;
        if (change === "cookie") {
          peer.beginSession();
        }
        peer.save(second);
        pending.resolve(
          Response.json({ bodies: [body(first.id, "/first.jpg"), body(second.id, "/stale.jpg")] }),
        );
        const outcome = await restore;
        expect(selection.current).toEqual(second);
        if (change === "cookie") {
          expect(Outcome.SessionExpired.instanceOf(outcome)).toBe(true);
          expect(bodyReads).toBe(1);
          expect(register).not.toHaveBeenCalled();
        } else {
          expect(outcome).toMatchObject({
            tag: "Session",
            inner: {
              outcome: {
                tag: "CookieEstablished",
                inner: { body: { bodyId: second.id, source: second.source } },
              },
            },
          });
          expect(bodyReads).toBe(2);
          expect(register.mock.calls).toEqual([["/fresh.jpg"]]);
        }
      } finally {
        session.dispose();
        client.uniffiDestroy();
      }
    },
  );

  it.each(["missing", "malformed"] as const)(
    "restores without a photo when the committed body is %s",
    async (kind) => {
      const fixture = await apiFixture();
      fixture.store.save({
        id: kind === "missing" ? crypto.randomUUID() : "not-a-body-id",
        source: PhotoSource.Library,
      });
      const experience = await fixture.connect();
      try {
        expect(BodyState.NoBody.instanceOf(experience.view.domain.body)).toBe(true);
        expect(experience.view.domain.photo).toBeUndefined();
        expect(fixture.store.current).toBeNull();
        expect(fixture.routes.includes("GET /bodies")).toBe(kind === "missing");
      } finally {
        experience.dispose();
      }
    },
  );

  it("leaves the original photo in place when the replacement URL is expired", async () => {
    let bodyReads = 0;
    const fixture = await apiFixture((_request, route) => {
      if (route !== "GET /bodies") {
        return;
      }
      bodyReads += 1;
      if (bodyReads === 1) {
        return;
      }
      return Response.json({
        bodies: [
          {
            bodyId: fixture.bodyId,
            createdAt: "2025-01-01T00:00:00Z",
            estimatedHeightCm: 170,
            sourceImageUrl: "/expired-replacement.jpg",
            sourceImageUrlExpiresAt: "2025-01-02T00:00:00Z",
          },
        ],
      });
    });
    const experience = await fixture.connect();
    try {
      const { media } = experience.view.domain.photo!;
      const photo = experience.adapters.getPhoto(media);
      expect(photo?.src).toBe("/original.jpg");
      await expect(experience.adapters.refreshPhoto?.(media, photo?.src)).rejects.toThrow(
        ApiSessionOutcomeError,
      );
      expect(bodyReads).toBe(2);
      expect(experience.adapters.getPhoto(media)).toEqual(photo);
    } finally {
      experience.dispose();
    }
  });

  it("renews only the URL of the accepted try-on and rejects mismatched identities", async () => {
    const id = crypto.randomUUID();
    const other = crypto.randomUUID();
    let mismatch: "tryOnId" | "variantId" | "bodyRevisionId" | undefined;
    const fixture = await apiFixture((_request, route) => {
      const result = {
        status: "completed",
        tryOnId: id,
        variantId: fixture.variantId,
        bodyRevisionId: fixture.bodyRevisionId,
        imageUrl: "/original-result.webp",
        scene: { overlayColor: "#ffffff" },
      };
      if (route === `POST /products/${fixture.productId}/try-on`) {
        return Response.json(result, { status: 201 });
      }
      if (route === `GET /try-ons/${id}`) {
        return Response.json({
          ...result,
          ...(mismatch === undefined ? {} : { [mismatch]: other }),
          imageUrl: "/renewed-result.webp",
          scene: { overlayColor: "#000000" },
        });
      }
    });
    const experience = await fixture.connect();
    try {
      experience.open();
      experience.dispatch(
        new FlowAction.Presentation({ action: new PresentationAction.RequestTryOn() }),
      );
      await vi.waitFor(() => {
        expect(experience.adapters.getResult?.(id)?.result.imageUrl).toBe("/original-result.webp");
      });
      const original = experience.adapters.getResult?.(id)?.result;
      const signal = new AbortController().signal;
      const expectRejected = async (field: NonNullable<typeof mismatch>) => {
        mismatch = field;
        await expect(experience.adapters.refreshResult?.(id, signal)).rejects.toThrow(
          ApiSessionOutcomeError,
        );
        expect(experience.adapters.getResult?.(id)?.result).toEqual(original);
      };
      await expectRejected("tryOnId");
      await expectRejected("variantId");
      await expectRejected("bodyRevisionId");
      mismatch = undefined;
      await experience.adapters.refreshResult?.(id, signal);
      expect(experience.view.domain.tryOns.find((item) => item.id === id)?.imageUrl).toBe(
        "/renewed-result.webp",
      );
      expect(experience.adapters.getResult?.(id)?.result).toEqual({
        ...original,
        imageUrl: "/renewed-result.webp",
      });
    } finally {
      experience.dispose();
    }
  });

  it("cannot overwrite the active body when another tab rotates the cookie during a write", async () => {
    const key = crypto.randomUUID();
    const first = await bodySelectionStore("https://api.example.test", key);
    const peer = await bodySelectionStore("https://api.example.test", key);
    const old = first.beginSession();
    const setItem = Object.getOwnPropertyDescriptor(Storage.prototype, "setItem")
      ?.value as Storage["setItem"];
    const current = { id: crypto.randomUUID(), source: PhotoSource.Library };
    const stale = { id: crypto.randomUUID(), source: PhotoSource.Camera };
    let rotate = true;
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(function rotateCookie(
      this: Storage,
      record,
      value,
    ) {
      if (rotate && record.endsWith(`.body.${old}`)) {
        rotate = false;
        peer.beginSession();
        peer.save(current);
      }
      setItem.call(this, record, value);
    });
    try {
      first.save(stale, old);
      expect(first.generation).not.toBe(old);
      expect(first.current).toEqual(current);
      expect(peer.current).toEqual(current);
    } finally {
      spy.mockRestore();
    }
  });

  it("cannot erase a newer body in the same cookie session while rejecting a restore", async () => {
    const key = crypto.randomUUID();
    const first = await bodySelectionStore("https://api.example.test", key);
    const peer = await bodySelectionStore("https://api.example.test", key);
    first.beginSession();
    first.save({ id: crypto.randomUUID(), source: PhotoSource.Library });
    const restored = first.selected();
    expect(restored).toBeDefined();
    const newer = { id: crypto.randomUUID(), source: PhotoSource.Camera };
    const setItem = Object.getOwnPropertyDescriptor(Storage.prototype, "setItem")
      ?.value as Storage["setItem"];
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(function selectBody(
      this: Storage,
      record,
      value,
    ) {
      if (record.includes(".rejected.")) {
        peer.save(newer);
      }
      setItem.call(this, record, value);
    });
    try {
      if (restored !== undefined) {
        first.rejectSelection(restored);
      }
      expect(first.current).toEqual(newer);
      expect(peer.current).toEqual(newer);
    } finally {
      spy.mockRestore();
    }
  });

  it("uses the mount's generation when browser storage rejects writes", async () => {
    const key = crypto.randomUUID();
    const store = await bodySelectionStore("https://api.example.test", key);
    const earlier = store.beginSession();
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("No storage capacity", "QuotaExceededError");
    });
    try {
      const generation = store.beginSession();
      expect(generation).not.toBe(earlier);
      expect(store.generation).toBe(generation);
    } finally {
      setItem.mockRestore();
    }
    const other = await bodySelectionStore("https://api.example.test", key);
    const newer = other.beginSession();
    expect(store.generation).toBe(newer);
  });

  it("keeps a fit-refused variant blocked after its request is evicted", async () => {
    const run = vi.fn<(id: string) => void>();
    const { experience, element, dispose } = await mountWithAdapters({
      run(job) {
        if (!Job.TryOn.instanceOf(job)) {
          return new Outcome.Failed({ error: BackendError.Internal });
        }
        run(job.inner.job.inner.key.variantId);
        return new Outcome.TryOn({
          outcome: new TryOnOutcome.Refused({ reason: RefusalReason.GarmentTooLarge }),
        });
      },
    });
    try {
      const sizes = Array.from({ length: 65 }, (_, i) => `Size ${i}`);
      const variants = installStyles(experience, ["Buttoned"], sizes);
      const screen = await rendered(element, "sv-try-on-view-screen");
      const select = (item: string) => {
        experience.dispatch(
          new FlowAction.Selection({
            action: new SelectionAction.SelectItem({ axis: "size", item }),
          }),
        );
      };
      const request = () => {
        experience.dispatch(
          new FlowAction.Presentation({ action: new PresentationAction.RequestTryOn() }),
        );
      };
      await press(screen, 'sv-button[slot="primary"]');
      await vi.waitFor(() => {
        expect(screen.error).toMatch(/too large/iu);
      });
      expect(screen.presentation?.canRequestTryOn.tag).toBe("Unavailable");
      for (const size of sizes.slice(1)) {
        select(size);
        request();
        // oxlint-disable-next-line eslint/no-await-in-loop -- Each refusal must settle before selecting the next variant.
        await Promise.resolve();
      }
      expect(run).toHaveBeenCalledTimes(65);
      expect(
        experience.view.domain.tryOnRequests.some((r) => r.variantId === variants[0]?.id),
      ).toBe(false);
      select(sizes[0]);
      await element.updateComplete;
      expect(Capability.Unavailable.instanceOf(screen.presentation?.canRequestTryOn)).toBe(true);
      const button = await rendered(screen, "sv-button", 'sv-button[slot="primary"]');
      expect(button.disabled).toBe(true);
      expect(request).toThrow(TryOnError.Rejected);
      expect(run).toHaveBeenCalledTimes(65);
    } finally {
      dispose();
    }
  });

  it("cancels the self-timer on a preview stall and re-enables it when frames resume", async () => {
    const timer = vi.fn<() => void>();
    const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
    const context = vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      drawImage: vi.fn<CanvasRenderingContext2D["drawImage"]>(),
      save: vi.fn<CanvasRenderingContext2D["save"]>(),
      restore: vi.fn<CanvasRenderingContext2D["restore"]>(),
      translate: vi.fn<CanvasRenderingContext2D["translate"]>(),
      scale: vi.fn<CanvasRenderingContext2D["scale"]>(),
      clearRect: vi.fn<CanvasRenderingContext2D["clearRect"]>(),
    } as unknown as CanvasRenderingContext2D);
    const stream = {} as MediaStream;
    const { experience, element, dispose } = await mountWithAdapters({
      restore: false,
      startDeviceEffect(effect) {
        if (DeviceEffect.Camera.instanceOf(effect)) {
          const action = effect.inner.effect;
          if (CameraEffect.Acquire.instanceOf(action)) {
            return new DeviceEvent.Camera({
              event: new CameraEvent.Acquired({
                token: action.inner.token,
                lease: crypto.randomUUID(),
              }),
            });
          }
          if (CameraEffect.ScheduleTimer.instanceOf(action)) {
            timer();
          }
        }
      },
    });
    experience.adapters.getCamera = () => ({ stream });
    try {
      const intro = await rendered(element, "sv-session-intro-screen");
      const checkbox = await rendered(intro, "sv-checkbox");
      checkbox.shadowRoot?.querySelector("button")?.click();
      await press(intro, 'sv-button[slot="secondary"]');
      const camera = await rendered(element, "sv-photo-capture-screen");
      await vi.waitFor(() => {
        expect(camera.state).toBe("live");
      });
      const preview = await rendered(camera, "sv-camera");
      const video = preview.shadowRoot!.querySelector("video")!;
      let readyState: number = HTMLMediaElement.HAVE_CURRENT_DATA;
      Object.defineProperties(video, {
        videoWidth: { value: 320 },
        videoHeight: { value: 480 },
        readyState: { get: () => readyState },
      });
      video.dispatchEvent(new Event("loadeddata"));
      await camera.updateComplete;
      const start = await rendered(camera, "sv-button", 'sv-button[slot="primary"]');
      expect(start.disabled).toBe(false);
      await press(camera, 'sv-button[slot="primary"]');
      expect(timer).toHaveBeenCalledOnce();
      expect(experience.view.screen).toMatchObject({ inner: { camera: { tag: "Countdown" } } });
      await element.updateComplete;
      readyState = HTMLMediaElement.HAVE_METADATA;
      video.dispatchEvent(new Event("waiting"));
      await element.updateComplete;
      await camera.updateComplete;
      expect(experience.view.screen).toMatchObject({ inner: { camera: { tag: "Live" } } });
      expect(start.disabled).toBe(true);
      await expect(preview.capture()).rejects.toThrow("no picture");
      readyState = HTMLMediaElement.HAVE_CURRENT_DATA;
      video.dispatchEvent(new Event("playing"));
      await element.updateComplete;
      await camera.updateComplete;
      expect(start.disabled).toBe(false);
    } finally {
      dispose();
      play.mockRestore();
      context.mockRestore();
    }
  });

  it.each(["storage", "resume"])(
    "invalidates a ready cookie session on %s before another request",
    async (when) => {
      const fixture = await apiFixture(() => globalThis.undefined, true);
      const experience = await fixture.connect();
      try {
        const peer = await bodySelectionStore(fixture.api.baseUrl, fixture.api.clientApiKey);
        experience.open();
        experience.dispatch(new FlowAction.Presence({ action: PresenceAction.Suspend }));
        const requestCount = fixture.routes.length;
        const storage = vi.spyOn(Storage.prototype, "setItem");
        peer.beginSession();
        const key = storage.mock.lastCall?.[0];
        storage.mockRestore();
        if (when === "storage") {
          expect(key).toBeDefined();
          globalThis.dispatchEvent(new StorageEvent("storage", { key: key ?? null }));
        } else {
          experience.dispatch(new FlowAction.Presence({ action: PresenceAction.Resume }));
        }
        expect(experience.view.domain.session).toBe(SessionPhase.Absent);
        expect(experience.view.domain.photo).toBeUndefined();
        expect(fixture.routes).toHaveLength(requestCount);
      } finally {
        experience.dispose();
      }
    },
  );

  it.each(["before upload", "before body creation"])(
    "blocks a stale cookie session %s",
    async (when) => {
      const storage = "https://storage.example.test/replacement";
      const upload = new Blob(
        [
          Uint8Array.fromBase64(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==",
          ),
        ],
        { type: "image/png" },
      );
      const staged = deferred<Response>();
      const fixture = await apiFixture(
        async (request, route) => {
          if (request.url === storage) {
            return await staged.promise;
          }
          if (route === "POST /bodies/upload-urls") {
            return Response.json({
              uploadUrl: storage,
              method: "PUT",
              stagingKey: "new-body",
              requiredHeaders: [{ name: "Content-Type", value: "image/png" }],
              expiresAt: "2099-01-01T00:00:00Z",
            });
          }
        },
        true,
        upload,
      );
      const experience = await fixture.connect();
      const peer = await bodySelectionStore(fixture.api.baseUrl, fixture.api.clientApiKey);
      const generation = fixture.store.generation;
      try {
        experience.open();
        if (when === "before upload") {
          peer.beginSession();
        }
        experience.dispatch(new FlowAction.Photo({ action: new PhotoAction.Replace() }));
        experience.dispatch(
          new FlowAction.Photo({
            action: new PhotoAction.BeginSource({ source: PhotoSource.Library }),
          }),
        );
        if (when === "before body creation") {
          await vi.waitFor(() => {
            expect(fixture.routes).toContain("PUT /replacement");
          });
          peer.beginSession();
          staged.resolve(new Response(null));
        }
        await vi.waitFor(() => {
          expect(experience.view.domain.session).toBe(SessionPhase.Absent);
        });
        expect(fixture.store.generation).not.toBe(generation);
        expect(experience.view.domain.photo).toBeUndefined();
        expect(fixture.routes).not.toContain("POST /bodies");
        if (when === "before upload") {
          expect(fixture.routes).not.toContain("POST /bodies/upload-urls");
        }
      } finally {
        staged.resolve(new Response(null));
        experience.dispose();
      }
    },
  );

  it("fails an unconfirmed cookie creation when a different tab has a readable session", async () => {
    const expiresAt = "2099-01-01T00:00:00Z";
    let cookieFromPeer = false;
    const fixture = await apiFixture((_request, route) => {
      if (route === "GET /session") {
        return cookieFromPeer
          ? Response.json({ expiresAt })
          : Response.json({ kind: "session-token-required", title: "No cookie" }, { status: 401 });
      }
      if (route === "POST /session/cookie/prepare") {
        return Response.json({ challenge: "prepared" });
      }
      if (route === "POST /session/cookie") {
        throw new TypeError("Creation failed before reaching server");
      }
    });
    const experience = await fixture.connect(SessionPhase.Absent);
    const element = document.createElement("sv-try-on-experience");
    element.experience = experience;
    document.body.append(element);
    const consent = vi.fn<() => void>();
    element.addEventListener("sv-try-on-consent-granted", consent);
    try {
      experience.open();
      const intro = await rendered(element, "sv-session-intro-screen");
      const checkbox = await rendered(intro, "sv-checkbox");
      checkbox.shadowRoot?.querySelector("button")?.click();
      const peer = await bodySelectionStore(fixture.api.baseUrl, fixture.api.clientApiKey);
      const peerGeneration = peer.beginSession();
      fixture.remember();
      cookieFromPeer = true;
      await press(intro, 'sv-button[slot="secondary"]');
      await vi.waitFor(() => {
        expect(experience.view.domain.session).toBe(SessionPhase.CreateFailed);
      });
      expect(consent).not.toHaveBeenCalled();
      expect(fixture.routes).toContain("POST /session/cookie");
      expect(fixture.store.generation).toBe(peerGeneration);
      expect(fixture.store.current?.id).toBe(fixture.bodyId);
    } finally {
      element.remove();
      experience.dispose();
    }
  });

  it("keeps a permanent failure after unrelated requests rotate history", async () => {
    const run = vi.fn<(id: string) => void>();
    let mediumId: string;
    const { experience, element, dispose } = await mountWithAdapters({
      run(job) {
        if (!Job.TryOn.instanceOf(job)) {
          return new Outcome.Failed({ error: BackendError.Internal });
        }
        const variant = job.inner.job.inner.key.variantId;
        run(variant);
        return variant === mediumId
          ? new Outcome.Failed({ error: BackendError.NotFound })
          : result();
      },
    });
    try {
      const [medium, large] = installStyles(experience, ["Buttoned"], ["M", "L"]);
      mediumId = medium.id;
      const screen = await rendered(element, "sv-try-on-view-screen");
      const request = () => {
        experience.dispatch(
          new FlowAction.Presentation({ action: new PresentationAction.RequestTryOn() }),
        );
      };
      const select = (item: string) => {
        experience.dispatch(
          new FlowAction.Selection({
            action: new SelectionAction.SelectItem({ axis: "size", item }),
          }),
        );
      };
      await press(screen, 'sv-button[slot="primary"]');
      await vi.waitFor(() => {
        expect(screen.state).toBe("error");
      });
      expect(screen.presentation?.canRequestTryOn.tag).toBe("Unavailable");
      select("L");
      request();
      await vi.waitFor(() => {
        expect(screen.presentation?.displayed.tag).toBe("TryOn");
      });
      for (let i = 0; i < 63; i += 1) {
        request();
      }
      expect(experience.view.domain.tryOnRequests).toHaveLength(64);
      expect(experience.view.domain.tryOnRequests.some((r) => r.variantId === medium.id)).toBe(
        false,
      );
      expect(run.mock.calls.map(([id]) => id)).toEqual([medium.id, large.id]);
      select("M");
      await element.updateComplete;
      expect(screen.presentation?.canRequestTryOn.tag).toBe("Unavailable");
      expect(request).toThrow(TryOnError.Rejected);
      expect(run.mock.calls.map(([id]) => id)).toEqual([medium.id, large.id]);
    } finally {
      dispose();
    }
  });

  it("clears the web adapter result when a replacement photo is committed", async () => {
    const replacementId = crypto.randomUUID();
    const resultId = crypto.randomUUID();
    const upload = new Blob(
      [
        Uint8Array.fromBase64(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==",
        ),
      ],
      { type: "image/png" },
    );
    const storage = "https://storage.example.test/replacement";
    const expiresAt = "2099-01-01T00:00:00Z";
    const fixture = await apiFixture(
      (request, route) => {
        if (request.url === storage) {
          return new Response(null);
        }
        if (route === `POST /products/${fixture.productId}/try-on`) {
          return Response.json(
            {
              status: "completed",
              tryOnId: resultId,
              variantId: fixture.variantId,
              bodyRevisionId: fixture.bodyRevisionId,
              imageUrl: "/old-result.webp",
              scene: { overlayColor: "#ffffff" },
            },
            { status: 201 },
          );
        }
        if (route === "POST /bodies/upload-urls") {
          expect(fixture.store.selected()?.version).toBe(selectedVersion);
          return Response.json({
            uploadUrl: storage,
            method: "PUT",
            stagingKey: "new-body",
            requiredHeaders: [{ name: "Content-Type", value: "image/png" }],
            expiresAt,
          });
        }
        if (route === "POST /bodies") {
          return Response.json(
            {
              status: "ready",
              body: {
                bodyId: replacementId,
                createdAt: expiresAt,
                sourceImageUrl: "/new.jpg",
                sourceImageUrlExpiresAt: expiresAt,
                estimatedHeightCm: 174,
              },
            },
            { status: 201 },
          );
        }
      },
      true,
      upload,
    );
    const selectedVersion = fixture.store.selected()?.version;
    expect(selectedVersion).toBeDefined();
    const experience = await fixture.connect();
    const element = document.createElement("sv-try-on-experience");
    element.experience = experience;
    document.body.append(element);
    try {
      experience.open();
      const screen = await rendered(element, "sv-try-on-view-screen");
      await press(screen, 'sv-button[slot="primary"]');
      await vi.waitFor(() => {
        expect(screen.tryOns).toHaveLength(1);
      });
      expect(experience.adapters.getResult?.(resultId)?.result.imageUrl).toBe("/old-result.webp");
      experience.dispatch(new FlowAction.Photo({ action: new PhotoAction.Replace() }));
      await chooseLibrary(element);
      await vi.waitFor(() => {
        expect(bodyIdentity(experience.view.domain.body)?.bodyId).toBe(replacementId);
      });
      expect(fixture.store.current).toEqual({ id: replacementId, source: PhotoSource.Library });
      expect(fixture.store.selected()?.version).not.toBe(selectedVersion);
      expect(experience.view.domain.tryOnRequests).toHaveLength(0);
      expect(experience.adapters.getResult?.(resultId)).toBeUndefined();
    } finally {
      element.remove();
      experience.dispose();
    }
  });

  it("shows camera recovery when browser playback fails before the first frame", async () => {
    const playback = deferred<undefined>();
    const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockReturnValue(playback.promise);
    const original = Object.getOwnPropertyDescriptor(navigator, "mediaDevices");
    const track = Object.assign(new EventTarget(), {
      readyState: "live",
      stop: vi.fn<() => void>(),
      getSettings: () => ({ deviceId: "fixture-camera" }),
    });
    const stream = {
      getTracks: () => [track],
      getVideoTracks: () => [track],
    } as unknown as MediaStream;
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: async () => stream,
        enumerateDevices: async () => [],
      },
    });
    const timer = vi.fn<() => void>();
    const capture = vi.fn<HTMLElementTagNameMap["sv-try-on-experience"]["captureCamera"]>();
    const devices = createBrowserTryOnDevices({
      capture,
      complete: vi.fn<() => void>(),
    });
    const { experience, element, dispose } = await mountWithAdapters({
      restore: false,
      async startDeviceEffect(effect) {
        if (
          DeviceEffect.Camera.instanceOf(effect) &&
          CameraEffect.ScheduleTimer.instanceOf(effect.inner.effect)
        ) {
          const { token, deadline } = effect.inner.effect.inner;
          timer();
          return new DeviceEvent.Camera({
            event: new CameraEvent.TimerElapsed({ token, now: deadline }),
          });
        }
        return await devices.startDeviceEffect(effect);
      },
    });
    experience.adapters.getCamera = devices.getCamera;
    try {
      const intro = await rendered(element, "sv-session-intro-screen");
      const checkbox = await rendered(intro, "sv-checkbox");
      checkbox.shadowRoot?.querySelector("button")?.click();
      await press(intro, 'sv-button[slot="secondary"]');
      const camera = await rendered(element, "sv-photo-capture-screen");
      await vi.waitFor(() => {
        expect(camera.state).toBe("live");
      });
      const start = await rendered(camera, "sv-button", 'sv-button[slot="primary"]');
      expect(start.disabled).toBe(true);
      playback.reject(new DOMException("Playback blocked", "NotAllowedError"));
      await vi.waitFor(() => {
        expect(camera.state).toBe("error");
      });
      expect(play).toHaveBeenCalledWith();
      expect(timer).not.toHaveBeenCalled();
      expect(capture).not.toHaveBeenCalled();
      expect(experience.view.screen).toMatchObject({ inner: { camera: { tag: "Unavailable" } } });
      const button = await rendered(camera, "sv-button", 'sv-button[slot="primary"]');
      expect(button.textContent).toMatch(/try again/iu);
      expect(button.disabled).toBe(false);
    } finally {
      dispose();
      devices.dispose();
      play.mockRestore();
      if (original) {
        Object.defineProperty(navigator, "mediaDevices", original);
      } else {
        delete (navigator as Partial<Navigator>).mediaDevices;
      }
    }
  });
});
