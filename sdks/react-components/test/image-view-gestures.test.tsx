// @vitest-environment jsdom

import { Drawer } from "@base-ui/react/drawer";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ImageViewDefault } from "../src/ui/image-view.js";

function touches(...points: { clientX: number; clientY: number }[]): TouchList {
  return Object.assign(points, { item: (index: number) => points[index] ?? null }) as TouchList;
}

function dispatchTouch(target: Element, type: string, points: TouchList): TouchEvent {
  const event = new TouchEvent(type, {
    bubbles: true,
    cancelable: true,
  });
  Object.defineProperty(event, "touches", { value: points });
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
}

function renderImageInDrawer(zoomable: boolean) {
  const onOpenChange = vi.fn<() => void>();
  render(
    <Drawer.Root open onOpenChange={onOpenChange}>
      <Drawer.Portal>
        <Drawer.Viewport>
          <Drawer.Popup>
            <Drawer.Title>Image preview</Drawer.Title>
            <Drawer.Description>Hold the image to save it</Drawer.Description>
            <div data-testid="drawer-surface">Sheet surface</div>
            <ImageViewDefault
              src="https://example.com/photo.jpg"
              alt="Your photo"
              zoomable={zoomable}
            />
          </Drawer.Popup>
        </Drawer.Viewport>
      </Drawer.Portal>
    </Drawer.Root>,
  );
  const image = screen.getByAltText("Your photo");
  const hitTest = vi.fn<() => Element>(() => image);
  Object.defineProperty(document, "elementFromPoint", { configurable: true, value: hitTest });
  return { image, hitTest, onOpenChange };
}

describe("ImageView native touch gestures in a drawer", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    Reflect.deleteProperty(document, "elementFromPoint");
  });

  it.each([false, true])(
    "leaves small one-finger movements uncanceled (zoomable=%s)",
    (zoomable) => {
      const { image, onOpenChange } = renderImageInDrawer(zoomable);
      dispatchTouch(image, "touchstart", touches({ clientX: 100, clientY: 100 }));

      // Natural finger jitter while holding must not cancel the browser's image callout.
      const move = dispatchTouch(image, "touchmove", touches({ clientX: 100, clientY: 102 }));
      expect(move.defaultPrevented).toBe(false);
      dispatchTouch(image, "touchend", touches());
      expect(onOpenChange).not.toHaveBeenCalled();
    },
  );

  it("clears existing drawer touch tracking when a second finger touches the image", () => {
    const { image, hitTest } = renderImageInDrawer(true);
    const surface = screen.getByTestId("drawer-surface");
    hitTest.mockReturnValue(surface);
    dispatchTouch(surface, "touchstart", touches({ clientX: 100, clientY: 50 }));

    hitTest.mockReturnValue(image);
    dispatchTouch(
      image,
      "touchstart",
      touches({ clientX: 100, clientY: 50 }, { clientX: 100, clientY: 100 }),
    );
    dispatchTouch(image, "touchend", touches({ clientX: 100, clientY: 100 }));

    expect(
      dispatchTouch(image, "touchmove", touches({ clientX: 100, clientY: 102 })).defaultPrevented,
    ).toBe(false);
  });

  it.each(["touchend", "touchcancel"])(
    "restores drawer touch handling after %s on the image",
    (type) => {
      const { image, hitTest } = renderImageInDrawer(true);
      dispatchTouch(image, "touchstart", touches({ clientX: 100, clientY: 100 }));
      dispatchTouch(image, type, touches());

      const surface = screen.getByTestId("drawer-surface");
      hitTest.mockReturnValue(surface);
      dispatchTouch(surface, "touchstart", touches({ clientX: 100, clientY: 50 }));
      expect(
        dispatchTouch(surface, "touchmove", touches({ clientX: 100, clientY: 52 }))
          .defaultPrevented,
      ).toBe(true);
    },
  );

  it("still handles pinch zoom and springs back on release", () => {
    const { image } = renderImageInDrawer(true);
    vi.spyOn(image, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 200, 300));
    dispatchTouch(
      image,
      "touchstart",
      touches({ clientX: 50, clientY: 100 }, { clientX: 150, clientY: 100 }),
    );
    const move = dispatchTouch(
      image,
      "touchmove",
      touches({ clientX: 25, clientY: 100 }, { clientX: 175, clientY: 100 }),
    );
    expect(move.defaultPrevented).toBe(true);
    expect(document.querySelector(".sv-image-zoom-portal--pinching")).not.toBeNull();

    dispatchTouch(image, "touchend", touches());
    expect(document.querySelector(".sv-image-zoom-portal--springing")).not.toBeNull();
  });

  it("leaves pinch gestures native when zoom is disabled", () => {
    const { image } = renderImageInDrawer(false);
    dispatchTouch(
      image,
      "touchstart",
      touches({ clientX: 50, clientY: 100 }, { clientX: 150, clientY: 100 }),
    );
    const move = dispatchTouch(
      image,
      "touchmove",
      touches({ clientX: 25, clientY: 100 }, { clientX: 175, clientY: 100 }),
    );
    expect(move.defaultPrevented).toBe(false);
    expect(document.querySelector(".sv-image-zoom-portal")).toBeNull();
  });
});
