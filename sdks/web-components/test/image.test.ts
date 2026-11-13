import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// @vitest-environment jsdom
import type { SvImage } from "../src/index.js";

import { defineSvElements } from "../src/index.js";

async function mount(props: Partial<SvImage>): Promise<SvImage> {
  const el = document.createElement("sv-image");
  Object.assign(el, props);
  document.body.append(el);
  await el.updateComplete;
  return el;
}

function ratioOf(el: SvImage): string | undefined {
  const space = el.shadowRoot?.querySelector<HTMLElement>(".space");
  return space?.style.getPropertyValue("--_sv-image-ratio");
}

async function liftedImage() {
  const el = await mount({ src: "/try-on.webp", zoomable: true });
  const frame = el.shadowRoot!.querySelector<HTMLElement>(".frame")!;
  const zoom = el.shadowRoot!.querySelector<HTMLElement>(".zoom")!;
  const completion = Promise.withResolvers<Animation>();
  const animation = { finished: completion.promise } as Animation;
  let open = false;
  zoom.showPopover = () => {
    open = true;
  };
  zoom.hidePopover = () => {
    open = false;
  };
  zoom.matches = (selector) => selector === ":popover-open" && open;
  zoom.getAnimations = () => [animation];
  const touch = (type: string, ...positions: number[]) => {
    const event = new Event(type, { cancelable: true });
    Object.assign(event, { touches: positions.map((clientX) => ({ clientX, clientY: 0 })) });
    frame.dispatchEvent(event);
  };
  touch("touchstart", 0, 20);
  touch("touchmove", 0, 40);
  expect(zoom.matches(":popover-open")).toBe(true);
  return {
    el,
    frame,
    zoom,
    touch,
    finish: () => {
      completion.resolve(animation);
    },
  };
}

describe("sv-image", () => {
  beforeAll(() => {
    defineSvElements();
  });

  afterEach(() => {
    document.body.replaceChildren();
  });

  it("shows the image with its description, or a placeholder without one", async () => {
    const el = await mount({ src: "/try-on.webp", alt: "Try-on in M" });
    const img = el.shadowRoot?.querySelector("img");
    expect(img?.getAttribute("src")).toBe("/try-on.webp");
    expect(img?.getAttribute("alt")).toBe("Try-on in M");
    const empty = await mount({});
    expect(empty.shadowRoot?.querySelector("img")).toBeNull();
    expect(empty.shadowRoot?.querySelector(".frame")).not.toBeNull();
  });

  it("is decorative without alt", async () => {
    const el = await mount({ src: "/try-on.webp" });
    expect(el.shadowRoot?.querySelector("img")?.getAttribute("alt")).toBe("");
  });

  it("takes the image's proportions once it loads, a portrait photo's before", async () => {
    const el = await mount({ src: "/try-on.webp" });
    expect(ratioOf(el)).toBe(String(3 / 4));
    const img = el.shadowRoot?.querySelector("img");
    if (!img) {
      throw new Error("no img");
    }
    Object.defineProperty(img, "naturalWidth", { value: 1000 });
    Object.defineProperty(img, "naturalHeight", { value: 500 });
    img.dispatchEvent(new Event("load"));
    await el.updateComplete;
    expect(ratioOf(el)).toBe("2");
    el.src = "/other.webp";
    await el.updateComplete;
    expect(ratioOf(el)).toBe(String(3 / 4));
  });

  it("covers the image with a shimmer while busy", async () => {
    const el = await mount({ src: "/try-on.webp", busy: true });
    expect(el.shadowRoot?.querySelector(".frame")?.getAttribute("aria-busy")).toBe("true");
    expect(el.shadowRoot?.querySelector(".shine")?.getAttribute("aria-hidden")).toBe("true");
    el.busy = false;
    await el.updateComplete;
    expect(el.shadowRoot?.querySelector(".shine")).toBeNull();
  });

  it("finishes a release when the next two-finger touch never zooms", async () => {
    const { frame, zoom, touch, finish } = await liftedImage();
    touch("touchend");
    touch("touchstart", 0, 20);
    touch("touchend");
    finish();
    await vi.waitFor(() => {
      expect(zoom.matches(":popover-open")).toBe(false);
    });
    expect(frame.classList.contains("zooming")).toBe(false);
  });

  it("restores the original image when zoom is disabled mid-gesture", async () => {
    const { el, frame, zoom } = await liftedImage();
    el.zoomable = false;
    await el.updateComplete;
    expect(zoom.matches(":popover-open")).toBe(false);
    expect(frame.classList.contains("zooming")).toBe(false);
  });

  it("keeps the common reference when result URLs and intrinsic dimensions change", async () => {
    const el = await mount({ src: "/first.webp", framing: {} });
    const img = el.shadowRoot!.querySelector("img")!;
    Object.defineProperty(img, "naturalWidth", { value: 1000, configurable: true });
    Object.defineProperty(img, "naturalHeight", { value: 500, configurable: true });
    img.dispatchEvent(new Event("load"));
    await el.updateComplete;
    expect(ratioOf(el)).toBe("2");
    el.src = "/second.webp";
    await el.updateComplete;
    expect(ratioOf(el)).toBe("2");
    Object.defineProperty(img, "naturalWidth", { value: 500 });
    Object.defineProperty(img, "naturalHeight", { value: 1000 });
    img.dispatchEvent(new Event("load"));
    await el.updateComplete;
    expect(ratioOf(el)).toBe("2");
  });

  it("keeps crop and framed placement identical in the zoom copy and maps full-source anchors", async () => {
    const el = await mount({
      src: "/capture.jpg",
      zoomable: true,
      crop: { cx: 0.75, cy: 0.5, width: 0.5, height: 1 },
      framing: { aspectRatio: 0.75 },
    });
    el._viewport = { width: 370, height: 500 };
    await el.updateComplete;
    const frame = el.shadowRoot!.querySelector<HTMLElement>(".frame")!;
    expect(frame.classList.contains("framed")).toBe(true);
    expect(el.shadowRoot!.querySelector(".frame .composition")!.getAttribute("style")).toBe(
      el.shadowRoot!.querySelector(".lifted .composition")!.getAttribute("style"),
    );
    expect(el.shadowRoot!.querySelector(".overlay")!.getAttribute("style")).toContain(
      "--sv-image-content-left",
    );
  });

  it("preserves an off-center capture crop, including in the lifted zoom image", async () => {
    const el = await mount({
      src: "/captured.jpg",
      zoomable: true,
      crop: { cx: 0.75, cy: 0.5, width: 0.5, height: 1 },
    });
    const img = el.shadowRoot?.querySelector(".frame img");
    if (!img) {
      throw new Error("no image");
    }
    Object.defineProperty(img, "naturalWidth", { value: 1000 });
    Object.defineProperty(img, "naturalHeight", { value: 500 });
    img.dispatchEvent(new Event("load"));
    await el.updateComplete;
    expect(ratioOf(el)).toBe("1");
    const picture = el.shadowRoot?.querySelector<HTMLElement>(".frame .picture");
    expect(picture?.style.getPropertyValue("--_sv-image-width")).toBe("200%");
    expect(picture?.style.getPropertyValue("--_sv-image-left")).toBe("-100%");
    expect(el.shadowRoot?.querySelector(".lifted .picture")?.getAttribute("style")).toBe(
      picture?.getAttribute("style"),
    );
    el.crop = undefined;
    await el.updateComplete;
    expect(ratioOf(el)).toBe("2");
  });

  it.each([
    { cx: 0.5, cy: 0.5, width: 0, height: 1 },
    { cx: 0.5, cy: 0.5, width: Number.MIN_VALUE, height: 1 },
    { cx: 0.9, cy: 0.5, width: 1, height: 1 },
    { cx: Number.NaN, cy: 0.5, width: 1, height: 1 },
    { cx: 0.5, cy: 0.5, width: 1, height: -1 },
  ])("falls back to the whole image for invalid crop %j", async (crop) => {
    const el = await mount({ src: "/captured.jpg", crop });
    expect(ratioOf(el)).toBe(String(3 / 4));
    const picture = el.shadowRoot?.querySelector<HTMLElement>(".picture");
    expect(picture?.style.getPropertyValue("--_sv-image-width")).toBe("100%");
    expect(picture?.style.getPropertyValue("--_sv-image-left")).toBe("0%");
  });

  it("has a hidden zoom layer only when zoomable", async () => {
    const plain = await mount({ src: "/try-on.webp" });
    expect(plain.shadowRoot?.querySelector(".zoom")).toBeNull();
    const zoomable = await mount({ src: "/try-on.webp", zoomable: true });
    const zoom = zoomable.shadowRoot?.querySelector(".zoom");
    expect(zoom?.getAttribute("popover")).toBe("manual");
    expect(zoom?.getAttribute("aria-hidden")).toBe("true");
  });
});
