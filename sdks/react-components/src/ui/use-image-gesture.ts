"use client";

import type { PointerEventHandler, TouchEventHandler } from "react";

import { useCallback, useEffect, useRef, useState } from "react";

import type { ZoomPortalState } from "./image-zoom-portal.js";

const MIN_SCALE = 1;
const MAX_SCALE = 4;
// Activate pinch on a ≥5% scale change OR ≥12px midpoint translation, so two-finger drag works
// even without a true zoom-in (e.g. during/after a zoom-out gesture).
const ACTIVATION_SCALE_THRESHOLD = 1.05;
const ACTIVATION_TRANSLATE_PX = 12;
const SPRING_DURATION_MS = 420;
const MAX_BACKDROP_OPACITY = 1;

// Axis-lock threshold: how far one finger must travel before we commit it to "horizontal swipe"
// vs "vertical scroll" vs "tap." Lower is more sensitive but eats more taps.
const AXIS_LOCK_PX = 6;
// Past this fraction of frame width OR this px/ms velocity, release commits to next slide.
// Tuned for Instagram's hair-trigger commit feel.
const SWIPE_DISTANCE_RATIO = 0.15;
const SWIPE_VELOCITY_PX_MS = 0.25;
// Resistance applied to drag past first/last slide (Instagram-style rubber-band).
// Lower → stiffer overscroll. ~0.35 matches the feel of native iOS UIScrollView bounce.
const OVERSCROLL_RESISTANCE = 0.35;
// Snap duration. Instagram's slide commit lands in ~160–180ms with a steep deceleration
// curve; longer feels mushy, shorter loses the "lands at the dot" affordance.
const SNAP_DURATION_MS = 180;
// Trackpad two-finger horizontal scroll: silence after the last wheel event before we commit.
// macOS momentum scroll has gaps toward the tail; this delay waits for momentum end so a
// single burst doesn't fire mid-burst and double-commit.
const WHEEL_SETTLE_MS = 140;
// cubic-bezier for the snap. Approximates iOS UIView animation w/ ease-out: front-loads
// the motion so the slide is visibly past halfway in the first ~30% of the duration.
const SNAP_EASING = "cubic-bezier(0.22, 0.61, 0.36, 1)";

interface TouchPoint {
  clientX: number;
  clientY: number;
}

function touchDist(a: TouchPoint, b: TouchPoint): number {
  return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
}

function touchMid(a: TouchPoint, b: TouchPoint): { cx: number; cy: number } {
  return { cx: (a.clientX + b.clientX) / 2, cy: (a.clientY + b.clientY) / 2 };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function computeTransform(
  imgRect: DOMRect,
  cx0: number,
  cy0: number,
  cxN: number,
  cyN: number,
  S: number,
): string {
  const originX = imgRect.left + imgRect.width / 2;
  const originY = imgRect.top + imgRect.height / 2;
  const tx = (cx0 - originX) * (1 - S) + (cxN - cx0);
  const ty = (cy0 - originY) * (1 - S) + (cyN - cy0);
  return `translate3d(${tx}px, ${ty}px, 0) scale(${S})`;
}

interface SwipeOptions {
  enabled: boolean;
  /** Total slides in the track. When ≤ 1, swipe is a no-op even if `enabled`. */
  slidesCount: number;
  /** Currently committed slide; the hook computes drag offset on top of this. */
  activeIndex: number;
  /** Called on release when the user swiped far/fast enough to advance or retreat. */
  onActiveIndexChange: (next: number) => void;
}

interface SwipeState {
  /** Pixel offset to apply to the carousel track on top of `-activeIndex * width`. */
  dragOffsetPx: number;
  /**
   * True while a finger / pointer is actively driving the track. Consumers gate the
   * track's CSS `transition` on `!dragging` — that way the track follows the finger
   * with zero latency during a swipe, and animates with `snapDurationMs` / `snapEasing`
   * for everything else: the post-release snap, programmatic dot-tap navigation, AND
   * external `activeIndex` jumps (e.g. parent appending a new slide and bumping the cursor).
   */
  dragging: boolean;
  snapDurationMs: number;
  /** CSS easing for transitions; consumers compose it with `snapDurationMs`. */
  snapEasing: string;
}

interface UseImageGestureReturn {
  imgRef: React.RefObject<HTMLImageElement | null>;
  containerRef: React.RefObject<HTMLDivElement | null>;
  zoomActive: boolean;
  /**
   * Unified pointer/touch handlers. Spread on the container. They coordinate pinch
   * (two-finger) and swipe (one-finger) in a single state machine — a second finger
   * cancels any in-flight swipe and a pinch suppresses swipe until release.
   *
   * The container must carry `data-base-ui-swipe-ignore` to opt out of an enclosing
   * Base UI Drawer's gestures. Touch events bubble so the drawer can update its
   * native touch tracking; stopping propagation leaves its capture listener stale.
   */
  touchHandlers: {
    onTouchStart: TouchEventHandler<HTMLDivElement>;
    onTouchMove: TouchEventHandler<HTMLDivElement>;
    onTouchEnd: TouchEventHandler<HTMLDivElement>;
    onTouchCancel: TouchEventHandler<HTMLDivElement>;
    onPointerDown: PointerEventHandler<HTMLDivElement>;
    onPointerMove: PointerEventHandler<HTMLDivElement>;
    onPointerUp: PointerEventHandler<HTMLDivElement>;
    onPointerCancel: PointerEventHandler<HTMLDivElement>;
  };
  portalState: ZoomPortalState | null;
  swipe: SwipeState;
}

type Phase =
  | "idle"
  | "tracking" // single finger down, axis not yet locked
  | "swiping" // single finger, horizontal lock
  | "vertical" // single finger, vertical lock — bail out, let browser scroll
  | "pinch-pre" // two fingers down, threshold not yet crossed
  | "pinching" // two fingers, threshold crossed, applying zoom transform
  | "spring" // post-pinch animation
  | "snap" // post-swipe animation
  | "wheeling"; // trackpad two-finger horizontal scroll in flight

interface GestureState {
  phase: Phase;
  imgRect: DOMRect | null;
  // Pinch
  initialDist: number;
  cx0: number;
  cy0: number;
  cxN: number;
  cyN: number;
  scale: number;
  springTimer: ReturnType<typeof setTimeout> | null;
  // Swipe
  startX: number;
  startY: number;
  lastX: number;
  lastT: number;
  velocity: number;
  width: number;
  swipePointerId: number | null;
  snapTimer: ReturnType<typeof setTimeout> | null;
  // Multi-touch tracking for stopPropagation behavior parity with prior hook
  pointerIds: Set<number>;
  // Wheel (trackpad horizontal scroll)
  wheelAccum: number;
  wheelTimer: ReturnType<typeof setTimeout> | null;
  /**
   * Index this burst started from. Each burst commits AT MOST one slide (forward or
   * backward); after a commit, the rest of the momentum-tail events are absorbed so a
   * single hard trackpad flick can't walk through the whole carousel.
   */
  wheelCommittedIndex: number;
  /** True once we've committed a slide this burst — subsequent events absorb silently. */
  wheelHasCommittedThisBurst: boolean;
}

/**
 * Unified gesture hook for an image (or carousel). Co-locates pinch-to-zoom and
 * horizontal swipe so they share one touch/pointer pipeline — without this, two
 * separate handler sets fight each other (each `stopPropagation`s the other,
 * the duplicate-prop spread overwrites one set, and the activation thresholds
 * race).
 *
 * - Pinch (two-finger): scales an image around its center; released → springs back.
 * - Swipe (one-finger): translates a carousel track with axis-lock; released →
 *   snaps to the next/prev slide if past a distance OR velocity threshold,
 *   otherwise snaps back. Rubber-bands at the first/last slide.
 *
 * `swipe` is opt-in; pass `swipe.enabled = false` (or omit) for the single-image
 * case and the hook behaves identically to the older `useImageZoom`.
 */
export function useImageGesture(opts: {
  zoomEnabled: boolean;
  swipe?: SwipeOptions;
}): UseImageGestureReturn {
  const { zoomEnabled } = opts;
  const swipeOpts = opts.swipe;
  // Latest swipe options held in a ref so handlers don't re-bind on every render.
  const swipeOptsRef = useRef(swipeOpts);
  swipeOptsRef.current = swipeOpts;

  const imgRef = useRef<HTMLImageElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [portalState, setPortalState] = useState<ZoomPortalState | null>(null);
  const [dragOffsetPx, setDragOffsetPx] = useState(0);
  const [dragging, setDragging] = useState(false);

  const gestureRef = useRef<GestureState>({
    phase: "idle",
    imgRect: null,
    initialDist: 0,
    cx0: 0,
    cy0: 0,
    cxN: 0,
    cyN: 0,
    scale: 1,
    springTimer: null,
    startX: 0,
    startY: 0,
    lastX: 0,
    lastT: 0,
    velocity: 0,
    width: 0,
    swipePointerId: null,
    snapTimer: null,
    pointerIds: new Set<number>(),
    wheelAccum: 0,
    wheelTimer: null,
    wheelCommittedIndex: 0,
    wheelHasCommittedThisBurst: false,
  });

  const startSpring = useCallback(() => {
    const g = gestureRef.current;
    if (g.springTimer !== null) {
      clearTimeout(g.springTimer);
    }
    g.phase = "spring";
    setPortalState((prev) =>
      prev === null
        ? null
        : {
            ...prev,
            pinching: false,
            transform: "translate3d(0px, 0px, 0) scale(1)",
            backdropOpacity: 0,
          },
    );
    g.springTimer = setTimeout(() => {
      g.phase = "idle";
      g.springTimer = null;
      setPortalState(null);
    }, SPRING_DURATION_MS);
  }, []);

  const startSnap = useCallback((commitTo: number | null) => {
    const g = gestureRef.current;
    if (g.snapTimer !== null) {
      clearTimeout(g.snapTimer);
    }
    g.phase = "snap";
    // Drop dragging immediately so the CSS transition takes effect for the snap.
    setDragging(false);
    setDragOffsetPx(0);
    if (commitTo !== null) {
      const o = swipeOptsRef.current;
      if (o !== undefined && commitTo !== o.activeIndex) {
        o.onActiveIndexChange(commitTo);
      }
    }
    g.snapTimer = setTimeout(() => {
      g.phase = "idle";
      g.snapTimer = null;
    }, SNAP_DURATION_MS);
  }, []);

  const beginPinchSetup = useCallback((a: TouchPoint, b: TouchPoint) => {
    const g = gestureRef.current;
    if (imgRef.current === null) {
      return;
    }
    const { cx, cy } = touchMid(a, b);
    g.imgRect = imgRef.current.getBoundingClientRect();
    g.initialDist = touchDist(a, b);
    g.cx0 = cx;
    g.cy0 = cy;
    g.cxN = cx;
    g.cyN = cy;
    g.scale = 1;
    g.phase = "pinch-pre";
  }, []);

  // ---- Touch events (cover pinch + touch-driven swipe) ----

  const onTouchStart = useCallback<TouchEventHandler<HTMLDivElement>>(
    (e) => {
      const g = gestureRef.current;
      // Re-enter from a spring/snap mid-animation: clear timers, return to idle.
      if (g.phase === "spring" && g.springTimer !== null) {
        clearTimeout(g.springTimer);
        g.springTimer = null;
        g.phase = "idle";
      }
      if (g.phase === "snap" && g.snapTimer !== null) {
        clearTimeout(g.snapTimer);
        g.snapTimer = null;
        g.phase = "idle";
      }
      if (g.phase === "wheeling" && g.wheelTimer !== null) {
        clearTimeout(g.wheelTimer);
        g.wheelTimer = null;
        g.wheelAccum = 0;
        g.phase = "idle";
        setDragOffsetPx(0);
        setDragging(false);
      }

      if (e.touches.length === 2 && zoomEnabled) {
        const a = e.touches.item(0);
        const b = e.touches.item(1);
        if (a !== null && b !== null) {
          // Cancel any in-flight swipe — second finger means pinch.
          if (g.phase === "swiping" || g.phase === "tracking") {
            setDragOffsetPx(0);
            setDragging(false);
            g.swipePointerId = null;
          }
          beginPinchSetup(a, b);
        }
        return;
      }

      if (e.touches.length === 1) {
        const o = swipeOptsRef.current;
        if (o !== undefined && o.enabled && o.slidesCount > 1) {
          const t = e.touches.item(0);
          if (t === null) {
            return;
          }
          const el = containerRef.current;
          if (el === null) {
            return;
          }
          const rect = el.getBoundingClientRect();
          g.startX = t.clientX;
          g.startY = t.clientY;
          g.lastX = t.clientX;
          g.lastT = performance.now();
          g.velocity = 0;
          g.width = rect.width;
          g.phase = "tracking";
          setDragging(true);
        }
      }
    },
    [zoomEnabled, beginPinchSetup],
  );

  const onTouchMove = useCallback<TouchEventHandler<HTMLDivElement>>(
    (e) => {
      const g = gestureRef.current;

      // ---- Pinch path ----
      if (zoomEnabled && (g.phase === "pinch-pre" || g.phase === "pinching")) {
        if (e.touches.length < 2) {
          return;
        }
        if (g.imgRect === null) {
          return;
        }
        const a = e.touches.item(0);
        const b = e.touches.item(1);
        if (a === null || b === null) {
          return;
        }
        const currentDist = touchDist(a, b);
        const { cx: cxN, cy: cyN } = touchMid(a, b);
        const rawScale = currentDist / g.initialDist;
        const S = clamp(rawScale, MIN_SCALE, MAX_SCALE);

        if (g.phase === "pinch-pre") {
          const movedPx = Math.hypot(cxN - g.cx0, cyN - g.cy0);
          const zoomed = Math.abs(rawScale - 1) >= ACTIVATION_SCALE_THRESHOLD - 1;
          if (!zoomed && movedPx < ACTIVATION_TRANSLATE_PX) {
            return;
          }
          g.phase = "pinching";
        }

        g.cxN = cxN;
        g.cyN = cyN;
        g.scale = S;
        const transform = computeTransform(g.imgRect, g.cx0, g.cy0, cxN, cyN, S);
        const backdropOpacity = ((S - 1) / (MAX_SCALE - 1)) * MAX_BACKDROP_OPACITY;
        setPortalState({ pinching: true, imgRect: g.imgRect, transform, backdropOpacity });
        return;
      }

      // ---- Swipe path ----
      if (g.phase === "tracking" || g.phase === "swiping") {
        if (e.touches.length !== 1) {
          return;
        }
        const t = e.touches.item(0);
        if (t === null) {
          return;
        }
        const dx = t.clientX - g.startX;
        const dy = t.clientY - g.startY;

        if (g.phase === "tracking") {
          const ax = Math.abs(dx);
          const ay = Math.abs(dy);
          if (ax < AXIS_LOCK_PX && ay < AXIS_LOCK_PX) {
            return;
          }
          if (ay > ax) {
            g.phase = "vertical";
            return;
          }
          g.phase = "swiping";
        }

        const now = performance.now();
        const dt = Math.max(1, now - g.lastT);
        g.velocity = (t.clientX - g.lastX) / dt;
        g.lastX = t.clientX;
        g.lastT = now;

        const o = swipeOptsRef.current;
        if (o === undefined) {
          return;
        }
        const atFirst = o.activeIndex === 0;
        const atLast = o.activeIndex === o.slidesCount - 1;
        const next = (atFirst && dx > 0) || (atLast && dx < 0) ? dx * OVERSCROLL_RESISTANCE : dx;
        setDragOffsetPx(next);
      }
    },
    [zoomEnabled],
  );

  const onTouchEnd = useCallback<TouchEventHandler<HTMLDivElement>>(
    (_e) => {
      const g = gestureRef.current;

      if (g.phase === "pinching") {
        startSpring();
        return;
      }
      // pinch-pre with no activation: just reset
      if (g.phase === "pinch-pre") {
        g.phase = "idle";
        return;
      }

      if (g.phase === "swiping") {
        const o = swipeOptsRef.current;
        if (o === undefined || g.width === 0) {
          startSnap(null);
          return;
        }
        const dx = g.lastX - g.startX;
        const distanceRatio = Math.abs(dx) / g.width;
        const v = g.velocity;
        const goingForward = dx < 0 || v < -SWIPE_VELOCITY_PX_MS;
        const goingBackward = dx > 0 || v > SWIPE_VELOCITY_PX_MS;
        const past = distanceRatio > SWIPE_DISTANCE_RATIO || Math.abs(v) > SWIPE_VELOCITY_PX_MS;
        let target = o.activeIndex;
        if (past && goingForward && o.activeIndex < o.slidesCount - 1) {
          target = o.activeIndex + 1;
        } else if (past && goingBackward && o.activeIndex > 0) {
          target = o.activeIndex - 1;
        }
        startSnap(target);
        return;
      }

      // tracking / vertical / idle: nothing to commit
      if (g.phase === "tracking" || g.phase === "vertical") {
        g.phase = "idle";
      }
    },
    [startSpring, startSnap],
  );

  // ---- Pointer events (mouse swipe + bottom-sheet-stop sandbox parity) ----

  const onPointerDown = useCallback<PointerEventHandler<HTMLDivElement>>((e) => {
    const g = gestureRef.current;
    g.pointerIds.add(e.pointerId);
    e.stopPropagation();
    // Mouse swipe path. Touch is handled by onTouchStart above (more reliable
    // for multi-touch and iOS pinch suppression via the non-passive listener).
    if (e.pointerType !== "mouse") {
      return;
    }
    if (g.phase !== "idle") {
      return;
    }
    const o = swipeOptsRef.current;
    if (o === undefined || !o.enabled || o.slidesCount <= 1) {
      return;
    }
    const el = containerRef.current;
    if (el === null) {
      return;
    }
    const rect = el.getBoundingClientRect();
    g.startX = e.clientX;
    g.startY = e.clientY;
    g.lastX = e.clientX;
    g.lastT = performance.now();
    g.velocity = 0;
    g.width = rect.width;
    g.swipePointerId = e.pointerId;
    g.phase = "tracking";
    setDragging(true);
    e.currentTarget.setPointerCapture(e.pointerId);
  }, []);

  const onPointerMove = useCallback<PointerEventHandler<HTMLDivElement>>((e) => {
    const g = gestureRef.current;
    e.stopPropagation();
    if (e.pointerType !== "mouse") {
      return;
    }
    if (g.swipePointerId !== e.pointerId) {
      return;
    }
    if (g.phase !== "tracking" && g.phase !== "swiping") {
      return;
    }
    const dx = e.clientX - g.startX;
    const dy = e.clientY - g.startY;
    if (g.phase === "tracking") {
      const ax = Math.abs(dx);
      const ay = Math.abs(dy);
      if (ax < AXIS_LOCK_PX && ay < AXIS_LOCK_PX) {
        return;
      }
      if (ay > ax) {
        g.phase = "vertical";
        return;
      }
      g.phase = "swiping";
    }
    const now = performance.now();
    const dt = Math.max(1, now - g.lastT);
    g.velocity = (e.clientX - g.lastX) / dt;
    g.lastX = e.clientX;
    g.lastT = now;
    const o = swipeOptsRef.current;
    if (o === undefined) {
      return;
    }
    const atFirst = o.activeIndex === 0;
    const atLast = o.activeIndex === o.slidesCount - 1;
    const next = (atFirst && dx > 0) || (atLast && dx < 0) ? dx * OVERSCROLL_RESISTANCE : dx;
    setDragOffsetPx(next);
  }, []);

  const onPointerUp = useCallback<PointerEventHandler<HTMLDivElement>>(
    (e) => {
      const g = gestureRef.current;
      g.pointerIds.delete(e.pointerId);
      e.stopPropagation();
      if (e.pointerType !== "mouse") {
        return;
      }
      if (g.swipePointerId !== e.pointerId) {
        return;
      }
      g.swipePointerId = null;
      if (g.phase === "swiping") {
        const o = swipeOptsRef.current;
        if (o === undefined || g.width === 0) {
          startSnap(null);
          return;
        }
        const dx = g.lastX - g.startX;
        const distanceRatio = Math.abs(dx) / g.width;
        const v = g.velocity;
        const goingForward = dx < 0 || v < -SWIPE_VELOCITY_PX_MS;
        const goingBackward = dx > 0 || v > SWIPE_VELOCITY_PX_MS;
        const past = distanceRatio > SWIPE_DISTANCE_RATIO || Math.abs(v) > SWIPE_VELOCITY_PX_MS;
        let target = o.activeIndex;
        if (past && goingForward && o.activeIndex < o.slidesCount - 1) {
          target = o.activeIndex + 1;
        } else if (past && goingBackward && o.activeIndex > 0) {
          target = o.activeIndex - 1;
        }
        startSnap(target);
      } else if (g.phase === "tracking" || g.phase === "vertical") {
        g.phase = "idle";
      }
    },
    [startSnap],
  );

  // Non-passive touchmove listener: preventDefault during pinch (two fingers) to keep iOS
  // from grabbing it for native page zoom, and during a locked horizontal swipe to keep
  // the page from rubber-banding horizontally on Safari/Chrome. The wheel listener is
  // co-registered here (non-passive) so a horizontal trackpad swipe can preventDefault
  // browser-level back/forward navigation; React's onWheel is passive by default.
  useEffect(() => {
    const el = containerRef.current;
    if (el === null) {
      return;
    }
    function handleNativeTouchMove(e: TouchEvent) {
      const g = gestureRef.current;
      if (e.touches.length >= 2) {
        e.preventDefault();
        return;
      }
      if (g.phase === "swiping") {
        e.preventDefault();
      }
    }
    function handleNativeWheel(e: WheelEvent) {
      // macOS trackpad pinch-to-zoom emits wheel with ctrlKey=true; let the browser handle it.
      if (e.ctrlKey) {
        return;
      }
      const o = swipeOptsRef.current;
      if (o === undefined || !o.enabled || o.slidesCount <= 1) {
        return;
      }
      // Only intercept when the gesture is dominantly horizontal — leave vertical page scroll alone.
      if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) {
        return;
      }
      const container = containerRef.current;
      if (container === null) {
        return;
      }
      const g = gestureRef.current;
      // Don't fight an in-flight touch/pinch.
      if (
        g.phase === "swiping" ||
        g.phase === "tracking" ||
        g.phase === "pinching" ||
        g.phase === "pinch-pre"
      ) {
        return;
      }
      // Once we've decided this is our gesture, prevent the browser default (Safari/Chrome
      // history back/forward swipe) AND stop bubbling so an enclosing scroll container or
      // bottom-sheet doesn't also react to the same burst.
      e.preventDefault();
      e.stopPropagation();
      // Cancel any in-flight snap so a fresh burst takes over.
      if (g.phase === "snap" && g.snapTimer !== null) {
        clearTimeout(g.snapTimer);
        g.snapTimer = null;
        g.phase = "idle";
      }
      // If the parent's activeIndex changed mid-burst (e.g. user clicked an arrow or
      // pressed an arrow key while a momentum-tail event was still arriving), defer to
      // that change and re-seed the burst around the new committed index.
      if (g.phase === "wheeling" && g.wheelCommittedIndex !== o.activeIndex) {
        g.wheelCommittedIndex = o.activeIndex;
        g.wheelAccum = 0;
        g.wheelHasCommittedThisBurst = false;
      }
      // Burst start: record geometry and seed our local committed-index tracker.
      if (g.phase !== "wheeling") {
        g.width = container.getBoundingClientRect().width;
        g.wheelAccum = 0;
        g.wheelCommittedIndex = o.activeIndex;
        g.wheelHasCommittedThisBurst = false;
        g.phase = "wheeling";
        setDragging(true);
      }
      const slideWidth = g.width;
      const lastIndex = o.slidesCount - 1;
      // One slide per burst, max. The first half-slide crossing commits, then the rest of
      // the momentum tail is absorbed silently — a hard flick can't walk through the whole
      // carousel. Settle timer just snaps back the sub-50% drift when the user truly stops.
      if (!g.wheelHasCommittedThisBurst) {
        g.wheelAccum += e.deltaX;
        if (Math.abs(g.wheelAccum) > slideWidth * 0.5) {
          const direction = g.wheelAccum > 0 ? 1 : -1;
          const target = Math.max(0, Math.min(lastIndex, g.wheelCommittedIndex + direction));
          if (target !== g.wheelCommittedIndex) {
            g.wheelCommittedIndex = target;
            g.wheelHasCommittedThisBurst = true;
            g.wheelAccum = 0;
            setDragOffsetPx(0);
            o.onActiveIndexChange(target);
          }
        }
        if (!g.wheelHasCommittedThisBurst) {
          // Live drag with rubber-band at the carousel ends.
          const offset = -g.wheelAccum;
          const atFirst = g.wheelCommittedIndex === 0;
          const atLast = g.wheelCommittedIndex === lastIndex;
          const resisted =
            (atFirst && offset > 0) || (atLast && offset < 0)
              ? offset * OVERSCROLL_RESISTANCE
              : offset;
          setDragOffsetPx(resisted);
        }
      }
      if (g.wheelTimer !== null) {
        clearTimeout(g.wheelTimer);
      }
      g.wheelTimer = setTimeout(() => {
        g.wheelTimer = null;
        g.wheelAccum = 0;
        const opts = swipeOptsRef.current;
        // Don't stomp on an external activeIndex change that happened during the burst.
        if (opts !== undefined && opts.activeIndex !== g.wheelCommittedIndex) {
          g.phase = "idle";
          setDragging(false);
          setDragOffsetPx(0);
          return;
        }
        startSnap(g.wheelCommittedIndex);
      }, WHEEL_SETTLE_MS);
    }
    el.addEventListener("touchmove", handleNativeTouchMove, { passive: false });
    el.addEventListener("wheel", handleNativeWheel, { passive: false });
    return () => {
      el.removeEventListener("touchmove", handleNativeTouchMove);
      el.removeEventListener("wheel", handleNativeWheel);
    };
  }, [startSnap]);

  useEffect(() => {
    const g = gestureRef.current;
    return () => {
      if (g.springTimer !== null) {
        clearTimeout(g.springTimer);
      }
      if (g.snapTimer !== null) {
        clearTimeout(g.snapTimer);
      }
      if (g.wheelTimer !== null) {
        clearTimeout(g.wheelTimer);
      }
    };
  }, []);

  return {
    imgRef,
    containerRef,
    zoomActive: portalState !== null,
    touchHandlers: {
      onTouchStart,
      onTouchMove,
      onTouchEnd,
      onTouchCancel: onTouchEnd,
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel: onPointerUp,
    },
    portalState,
    swipe: {
      dragOffsetPx,
      dragging,
      snapDurationMs: SNAP_DURATION_MS,
      snapEasing: SNAP_EASING,
    },
  };
}
