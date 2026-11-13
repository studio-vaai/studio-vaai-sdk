import { inspectImageHeader } from "@studio-vaai/js-client";
// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { usePhotoPreviewUrl } from "../src/utils/use-photo-preview-url.js";

vi.mock(import("@studio-vaai/js-client"), () => ({
  inspectImageHeader:
    vi.fn<
      (blob: Blob, signal?: AbortSignal) => Promise<{ width: number; height: number } | undefined>
    >(),
}));
const image = { type: "blob" as const, blob: new Blob([new Uint8Array([1, 2, 3])]) };
function stubObjectUrls() {
  const revoke = vi.fn<(url: string) => void>();
  // oxlint-disable-next-line vitest/prefer-spy-on -- jsdom ships no object URL methods.
  const create = vi.fn<() => string>(() => "blob:photo");
  URL.createObjectURL = create;
  // oxlint-disable-next-line vitest/prefer-spy-on -- jsdom ships no object URL methods.
  URL.revokeObjectURL = revoke;
  vi.mocked(inspectImageHeader).mockResolvedValue({ width: 10, height: 10 });
  return { revoke, create };
}
describe("usePhotoPreviewUrl", () => {
  afterEach(() => {
    vi.resetAllMocks();
  });
  it("validates before creating a preview and survives Strict Mode remount", async () => {
    const { revoke, create } = stubObjectUrls();
    const { result } = renderHook(() => usePhotoPreviewUrl(image, true), { wrapper: StrictMode });
    expect(result.current).toBeUndefined();
    expect(create).not.toHaveBeenCalled();
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current).toBe("blob:photo");
    expect(create).toHaveBeenCalledOnce();
    expect(revoke).not.toHaveBeenCalled();
  });
  it("revokes the old preview before validating a replacement", async () => {
    const { revoke } = stubObjectUrls();
    let count = 0;
    // oxlint-disable-next-line vitest/prefer-spy-on -- jsdom ships no object URL methods.
    URL.createObjectURL = vi.fn<() => string>(() => {
      count += 1;
      return `blob:photo-${String(count)}`;
    });
    const next = { type: "blob" as const, blob: new Blob([new Uint8Array([4, 5, 6])]) };
    const { result, rerender } = renderHook(({ photo }) => usePhotoPreviewUrl(photo, true), {
      initialProps: { photo: image },
    });
    await act(async () => {
      await Promise.resolve();
    });
    rerender({ photo: next });
    expect(result.current).toBeUndefined();
    expect(revoke).toHaveBeenCalledWith("blob:photo-1");
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current).toBe("blob:photo-2");
    expect(revoke).not.toHaveBeenCalledWith("blob:photo-2");
  });
  it("releases the object URL when the preview expires or unmounts", async () => {
    const { revoke } = stubObjectUrls();
    const { result, rerender, unmount } = renderHook(
      ({ active }) => usePhotoPreviewUrl(image, active),
      { initialProps: { active: true } },
    );
    await act(async () => {
      await Promise.resolve();
    });
    rerender({ active: false });
    expect(result.current).toBeUndefined();
    expect(revoke).toHaveBeenCalledWith("blob:photo");
    unmount();
  });
  it("never creates a preview for rejected input or a late validation after unmount", async () => {
    const { create } = stubObjectUrls();
    vi.mocked(inspectImageHeader).mockRejectedValueOnce(new Error("over budget"));
    const { result, unmount } = renderHook(() => usePhotoPreviewUrl(image, true));
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current).toBeUndefined();
    expect(create).not.toHaveBeenCalled();
    unmount();
    let finish!: (value: { width: number; height: number } | undefined) => void;
    // oxlint-disable-next-line promise/avoid-new -- Verify late callback completion after unmount.
    const pending = new Promise<{ width: number; height: number } | undefined>((resolve) => {
      finish = resolve;
    });
    vi.mocked(inspectImageHeader).mockReturnValueOnce(pending);
    const late = renderHook(() => usePhotoPreviewUrl(image, true));
    late.unmount();
    await act(async () => {
      finish({ width: 10, height: 10 });
      await Promise.resolve();
    });
    expect(create).not.toHaveBeenCalled();
  });
});
