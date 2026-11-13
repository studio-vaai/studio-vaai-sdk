// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import type {
  SvCameraCapture,
  SvPhotoCaptureActionDetail,
  SvPhotoCaptureScreenProps,
} from "../src/index.js";

import { defineSvElements, SvCamera, createUiContext } from "../src/index.js";
import { initializeTestUi } from "./ui-fixture.js";

async function mount(props: SvPhotoCaptureScreenProps = {}) {
  const host = document.createElement("div");
  const screen = document.createElement("sv-photo-capture-screen");
  Object.assign(screen, props);
  host.append(screen);
  document.body.append(host);
  await screen.updateComplete;
  const actions: SvPhotoCaptureActionDetail["action"][] = [];
  host.addEventListener("sv-photo-capture-action", (event) => {
    actions.push(event.detail.action);
  });
  return { screen, host, actions };
}

async function child<K extends keyof HTMLElementTagNameMap>(root: Element, tag: K, suffix = "") {
  const el = root.shadowRoot?.querySelector<HTMLElementTagNameMap[K]>(`${tag}${suffix}`);
  if (!el) {
    throw new Error(`Missing ${tag}${suffix}`);
  }
  if ("updateComplete" in el) {
    await el.updateComplete;
  }
  return el;
}

async function press(root: Element, slot: "primary" | "secondary") {
  const el = await child(root, "sv-button", `[slot="${slot}"]`);
  el.shadowRoot?.querySelector("button")?.click();
  return el;
}

describe("stateless photo capture", () => {
  beforeAll(async () => {
    await initializeTestUi();
    defineSvElements();
  });
  afterEach(() => {
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it("requests permission and library upload without changing state or opening a camera", async () => {
    const { screen, actions } = await mount();
    await press(screen, "primary");
    await press(screen, "secondary");
    expect(actions).toEqual(["request-permission", "upload"]);
    expect(screen.state).toBe("permission");
    expect(screen.stream).toBeUndefined();
    expect(screen.shadowRoot?.textContent).toContain("We need your permission");
    await expect(screen.capture()).rejects.toThrow("requires a live camera");
  });

  it("requests start/cancel/switch while leaving the host's countdown and state intact", async () => {
    const { screen, host, actions } = await mount({
      state: "live",
      cameras: [{ deviceId: "front" }, { deviceId: "back" }],
      selfTimerDurationSeconds: 5,
    });
    const camera = await child(screen, "sv-camera");
    expect(camera.mirrored).toBe(true);
    const start = await press(screen, "primary");
    expect(start.textContent).toContain("5s");
    let rawSwitches = 0;
    host.addEventListener("sv-switch-camera", () => {
      rawSwitches += 1;
    });
    camera.dispatchEvent(new CustomEvent("sv-switch-camera", { bubbles: true, composed: true }));
    expect(actions).toEqual(["start-timer", "switch-camera"]);
    expect(rawSwitches).toBe(0);
    expect(screen.countdownSeconds).toBe(0);

    screen.setAttribute("countdown-seconds", "3");
    await screen.updateComplete;
    await camera.updateComplete;
    expect(camera.countdownSeconds).toBe(3);
    expect(camera.countdownLabel).toBe("Capturing in 3 seconds");
    expect(camera.shadowRoot?.querySelector(".switch")).toBeNull();
    const shell = await child(screen, "sv-screen");
    expect(shell.busy).toBe(true);
    await press(screen, "secondary");
    camera.dispatchEvent(new CustomEvent("sv-switch-camera", { bubbles: true, composed: true }));
    await press(screen, "primary");
    expect(actions).toEqual(["start-timer", "switch-camera", "cancel-timer"]);
    expect(screen.countdownSeconds).toBe(3);
    expect(screen.state).toBe("live");
  });

  it.each([
    ["denied", "Please allow camera access"],
    ["unavailable", "We couldn't find a camera"],
    ["error", "The camera is unavailable"],
  ] as const)(
    "renders %s with retry and a library escape without creating error state",
    async (state, message) => {
      const { screen, actions } = await mount({ state });
      expect(screen.shadowRoot?.textContent).toContain(message);
      await press(screen, "primary");
      await press(screen, "secondary");
      expect(actions).toEqual(["retry", "upload"]);
      expect(screen.state).toBe(state);
      expect(screen.error).toBeUndefined();
      screen.error = "A host-supplied failure";
      await screen.updateComplete;
      expect(screen.shadowRoot?.textContent).toContain("A host-supplied failure");
    },
  );

  it("delegates capture and preserves its crop in the upload preview without taking stream ownership", async () => {
    const shot: SvCameraCapture = {
      blob: new Blob(["jpeg"], { type: "image/jpeg" }),
      width: 1920,
      height: 1080,
      crop: { cx: 0.5, cy: 0.5, width: 0.75, height: 1 },
    };
    const capture = vi.spyOn(SvCamera.prototype, "capture").mockResolvedValue(shot);
    const { screen, actions } = await mount({ state: "live", countdownSeconds: 1 });
    await expect(screen.capture()).resolves.toBe(shot);
    expect(capture).toHaveBeenCalledOnce();
    expect(screen.state).toBe("live");
    expect(screen.countdownSeconds).toBe(1);
    screen.photoSrc = "/captured.jpg";
    screen.photoCrop = shot.crop;
    screen.state = "uploading";
    await screen.updateComplete;
    const image = await child(screen, "sv-image");
    expect(image.src).toBe("/captured.jpg");
    expect(image.crop).toBe(shot.crop);
    expect(screen.shadowRoot?.querySelector("sv-camera")).toBeNull();
    const shell = await child(screen, "sv-screen");
    expect(shell.busy).toBe(true);
    expect(shell.statusMessage).toBe("Processing your photo");
    expect(shell.description).toBe("Capture a full-body image of yourself");
    const primary = await press(screen, "primary");
    expect(primary.busy).toBe(true);
    expect(primary.textContent).toContain("Start self-timer");
    const secondary = await press(screen, "secondary");
    expect(secondary.disabled).toBe(true);
    expect(actions).toEqual([]);
    expect(screen.shadowRoot?.textContent).not.toContain("Uploading your photo");
    await expect(screen.capture()).rejects.toThrow("requires a live camera");
  });

  it("locks requests while busy and keeps the camera mirrored", async () => {
    const { screen, actions } = await mount({
      state: "live",
      busy: true,
      cameras: [{ deviceId: "front" }, { deviceId: "back" }],
    });
    await press(screen, "primary");
    await press(screen, "secondary");
    const camera = await child(screen, "sv-camera");
    camera.dispatchEvent(new CustomEvent("sv-switch-camera", { bubbles: true, composed: true }));
    expect(actions).toEqual([]);
    await screen.updateComplete;
    await camera.updateComplete;
    expect(screen.shadowRoot?.querySelector('[slot="secondary"]')).not.toBeNull();
    expect(camera.mirrored).toBe(true);
  });

  it("derives camera switching from the supplied cameras and locks it during countdown", async () => {
    const { screen, actions } = await mount({ state: "live" });
    const camera = await child(screen, "sv-camera");
    const switchRequest = () => {
      camera.dispatchEvent(new CustomEvent("sv-switch-camera", { bubbles: true, composed: true }));
    };
    expect(camera.shadowRoot?.querySelector(".switch")).toBeNull();
    switchRequest();
    screen.cameras = [{ deviceId: "front" }];
    await screen.updateComplete;
    await camera.updateComplete;
    expect(camera.shadowRoot?.querySelector(".switch")).toBeNull();
    switchRequest();
    expect(actions).toEqual([]);

    screen.cameras = [{ deviceId: "front" }, { deviceId: "back" }];
    await screen.updateComplete;
    await camera.updateComplete;
    expect(camera.shadowRoot?.querySelector(".switch")).not.toBeNull();
    switchRequest();
    expect(actions).toEqual(["switch-camera"]);
    expect(screen.cameras).toHaveLength(2);
    expect(camera.mirrored).toBe(true);

    screen.countdownSeconds = 3;
    await screen.updateComplete;
    await camera.updateComplete;
    expect(camera.shadowRoot?.querySelector(".switch")).toBeNull();
    switchRequest();
    expect(actions).toEqual(["switch-camera"]);
  });

  it("localizes timer labels and announcements without resetting the screen state", async () => {
    const { host, screen } = await mount({
      state: "live",
      countdownSeconds: 3,
      selfTimerDurationSeconds: 5,
    });
    const ui = createUiContext();
    const detach = ui.attach(host);
    await ui.ready();
    ui.configure({ locale: "de", appearance: "dark" });
    await screen.updateComplete;
    const camera = await child(screen, "sv-camera");
    const shell = await child(screen, "sv-screen");
    expect(camera.countdownLabel).toBe("Aufnahme in 3 Sekunden");
    expect(shell.description).toBe("Mach ein Ganzkörperfoto von dir");
    expect(screen.state).toBe("live");
    expect(screen.countdownSeconds).toBe(3);
    expect(screen.dataset.svAppearance).toBe("dark");
    screen.countdownSeconds = 0;
    await screen.updateComplete;
    const start = await child(screen, "sv-button", '[slot="primary"]');
    expect(start.textContent).toContain("5s");
    detach();
  });
});
