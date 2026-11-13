import { beforeAll, afterEach, describe, expect, it, vi } from "vitest";

import { convertHeicToJpeg } from "../../src/experience/browser/photo/heic.js";
import { initializeTestUi } from "../ui-fixture.js";
import { heif } from "./helpers/image-fixtures.js";

class FakeWorker extends EventTarget {
  static instances: FakeWorker[] = [];
  terminate = vi.fn<() => void>();
  postMessage = vi.fn<(message: Blob) => void>();
  constructor() {
    super();
    FakeWorker.instances.push(this);
  }
}

describe("isolated HEIC conversion", () => {
  beforeAll(initializeTestUi);

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    FakeWorker.instances = [];
  });

  async function started(): Promise<FakeWorker> {
    await vi.waitFor(() => {
      expect(FakeWorker.instances).toHaveLength(1);
    });
    return FakeWorker.instances[0];
  }

  it("retires its worker after conversion and refuses concurrent decode work", async () => {
    vi.stubGlobal("Worker", FakeWorker);
    const result = convertHeicToJpeg(heif());
    const worker = await started();
    await expect(convertHeicToJpeg(heif())).resolves.toBeUndefined();
    const jpeg = new Blob([new Uint8Array([1])], { type: "image/jpeg" });
    worker.dispatchEvent(new MessageEvent("message", { data: jpeg }));
    await expect(result).resolves.toBe(jpeg);
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it("terminates stalled native/WASM work at its independent deadline", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("Worker", FakeWorker);
    const result = convertHeicToJpeg(heif());
    const worker = await started();
    await vi.advanceTimersByTimeAsync(10_000);
    await expect(result).resolves.toBeUndefined();
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it("terminates cancelled work and rejects before loading oversized inputs", async () => {
    vi.stubGlobal("Worker", FakeWorker);
    const controller = new AbortController();
    const result = convertHeicToJpeg(heif(), "photo.heic", controller.signal);
    const worker = await started();
    controller.abort(new Error("cancelled"));
    await expect(result).rejects.toThrow("cancelled");
    expect(worker.terminate).toHaveBeenCalledOnce();
    FakeWorker.instances = [];
    await expect(convertHeicToJpeg(heif(32_768, 1))).resolves.toBeUndefined();
    expect(FakeWorker.instances).toHaveLength(0);
  });
});
