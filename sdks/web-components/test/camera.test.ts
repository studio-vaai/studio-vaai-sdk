import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// @vitest-environment jsdom
import type { SvCamera } from "../src/index.js";

import { defineSvElements } from "../src/index.js";

async function mount(props: Partial<SvCamera>): Promise<SvCamera> {
  const el = document.createElement("sv-camera");
  Object.assign(el, props);
  document.body.append(el);
  await el.updateComplete;
  return el;
}

function part(el: SvCamera, selector: string): HTMLElement | null {
  return el.shadowRoot?.querySelector<HTMLElement>(selector) ?? null;
}

describe("sv-camera", () => {
  beforeAll(() => {
    defineSvElements();
  });

  afterEach(() => {
    document.body.replaceChildren();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("keeps the video hidden, silent and inline, and draws to a canvas instead", async () => {
    const el = await mount({});
    const video = el.shadowRoot?.querySelector("video");
    expect(video?.muted).toBe(true);
    expect(video?.hasAttribute("playsinline")).toBe(true);
    expect(video?.getAttribute("aria-hidden")).toBe("true");
    expect(part(el, "canvas")).not.toBeNull();
  });

  it("draws on video frames and cancels the pending callback when the stream ends", async () => {
    const el = await mount({});
    const video = el.shadowRoot!.querySelector("video")!;
    const canvas = el.shadowRoot!.querySelector("canvas")!;
    const drawImage = vi.fn<CanvasRenderingContext2D["drawImage"]>();
    vi.spyOn(canvas, "getContext").mockReturnValue({
      drawImage,
      save: vi.fn<CanvasRenderingContext2D["save"]>(),
      restore: vi.fn<CanvasRenderingContext2D["restore"]>(),
      clearRect: vi.fn<CanvasRenderingContext2D["clearRect"]>(),
    } as unknown as CanvasRenderingContext2D);
    vi.spyOn(video, "play").mockResolvedValue(globalThis.undefined);
    const requestFrame = vi
      .fn<HTMLVideoElement["requestVideoFrameCallback"]>()
      .mockReturnValueOnce(31)
      .mockReturnValueOnce(32);
    const cancelFrame = vi.fn<HTMLVideoElement["cancelVideoFrameCallback"]>();
    Object.assign(video, {
      requestVideoFrameCallback: requestFrame,
      cancelVideoFrameCallback: cancelFrame,
    });
    el.stream = {} as MediaStream;
    await el.updateComplete;

    const ready = vi.fn<(event: HTMLElementEventMap["sv-camera-preview-state"]) => void>();
    el.addEventListener("sv-camera-preview-state", ready);
    Object.defineProperties(video, {
      videoWidth: { value: 320 },
      videoHeight: { value: 480 },
      readyState: { value: HTMLMediaElement.HAVE_CURRENT_DATA },
    });
    expect(drawImage).not.toHaveBeenCalled();
    requestFrame.mock.calls[0]?.[0](performance.now(), {} as VideoFrameCallbackMetadata);
    expect(drawImage).toHaveBeenCalledOnce();
    expect(ready).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ detail: { stream: el.stream, state: "ready" } }),
    );
    expect(requestFrame).toHaveBeenCalledTimes(2);
    el.stream = null;
    await el.updateComplete;
    expect(cancelFrame).toHaveBeenCalledWith(32);
  });

  it("uses paint callbacks when a ready video stalls on frame callbacks", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "performance"] });
    const requestPaint = vi.fn<Window["requestAnimationFrame"]>().mockReturnValue(42);
    const cancelPaint = vi.fn<Window["cancelAnimationFrame"]>();
    vi.stubGlobal("requestAnimationFrame", requestPaint);
    vi.stubGlobal("cancelAnimationFrame", cancelPaint);
    const el = await mount({});
    const video = el.shadowRoot!.querySelector("video")!;
    vi.spyOn(video, "play").mockResolvedValue(globalThis.undefined);
    const cancelFrame = vi.fn<HTMLVideoElement["cancelVideoFrameCallback"]>();
    Object.assign(video, {
      requestVideoFrameCallback: () => 31,
      cancelVideoFrameCallback: cancelFrame,
    });
    Object.defineProperty(video, "readyState", { value: HTMLMediaElement.HAVE_CURRENT_DATA });
    el.stream = {} as MediaStream;
    await el.updateComplete;
    expect(requestPaint).not.toHaveBeenCalled();
    vi.advanceTimersByTime(500);
    expect(cancelFrame).toHaveBeenCalledWith(31);
    expect(requestPaint).toHaveBeenCalledOnce();
    el.remove();
    expect(cancelPaint).toHaveBeenCalledWith(42);
  });

  it("shows a switch-camera button only with a label, and reports presses", async () => {
    const plain = await mount({});
    expect(part(plain, ".switch")).toBeNull();
    const el = await mount({ switchLabel: "Switch camera" });
    let switches = 0;
    el.addEventListener("sv-switch-camera", () => {
      switches += 1;
    });
    const button = part(el, ".switch");
    expect(button?.getAttribute("aria-label")).toBe("Switch camera");
    button?.click();
    expect(switches).toBe(1);
  });

  it("shows the countdown with its announcement, and hides the switch button meanwhile", async () => {
    const el = await mount({
      countdownSeconds: 3,
      countdownLabel: "Photo in 3 seconds",
      switchLabel: "Switch camera",
    });
    const status = part(el, "[role=status]");
    expect(status?.textContent).toContain("Photo in 3 seconds");
    expect(part(el, "[part=countdown]")?.textContent).toBe("3");
    expect(part(el, ".switch")).toBeNull();
    el.setAttribute("countdown-seconds", "0");
    await el.updateComplete;
    expect(part(el, "[role=status]")).toBeNull();
    expect(part(el, ".switch")).not.toBeNull();
  });

  it("refuses to capture before there is a picture", async () => {
    const el = await mount({});
    await expect(el.capture()).rejects.toThrow(/no picture/);
  });

  it("lays slotted content over the picture", async () => {
    const el = await mount({});
    const hint = document.createElement("p");
    hint.textContent = "Stand 2 m back";
    el.append(hint);
    expect(part(el, ".overlay slot")).not.toBeNull();
  });
});
