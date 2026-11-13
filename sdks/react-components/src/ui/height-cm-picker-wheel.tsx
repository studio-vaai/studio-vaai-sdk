"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useStudioVaaiUiMessages } from "../i18n/context.js";
import { formatCentimeters } from "../i18n/number-format.js";
import { useStudioVaaiUiComponent } from "../studio-vaai-ui-components-context.js";
import { cn } from "./cn.js";
import {
  MAX_CM,
  MIN_CM,
  normalizeCm,
  type HeightCmPickerProps,
} from "./height-cm-picker-shared.js";

/**
 * Pixel-based sizing — scroll math (snap target, `cmFromScrollTop`) assumes these
 * are the actual rendered dimensions. Rem-based Tailwind utilities (`h-6`, `h-14`)
 * desync from `ROW_PX` when the host page has a non-16px root font-size, so rows
 * and viewport are pinned via inline `style` instead.
 */
const ROW_PX = 24;
const VIEWPORT_PX = 56;
const PAD_PX = (VIEWPORT_PX - ROW_PX) / 2;

function supportsScrollEnd(): boolean {
  return typeof globalThis !== "undefined" && "onscrollend" in globalThis;
}

const heightCmRowBaseClass =
  "sv:box-border sv:flex sv:w-full sv:shrink-0 sv:snap-center sv:items-center sv:justify-center sv:text-base sv:leading-none sv:tracking-normal sv:transition-colors";

function rowClassForDistance(dist: number): string {
  if (dist === 0) {
    return "sv:font-normal sv:text-black";
  }
  if (dist === 1) {
    return "sv:font-normal sv:text-[var(--sv-color-foreground-secondary)] sv:opacity-80";
  }
  return "sv:font-normal sv:text-[var(--sv-color-foreground-secondary)] sv:opacity-70";
}

export function HeightCmPickerWheelDefault({
  valueCm,
  onChange,
  disabled = false,
  "aria-labelledby": ariaLabelledBy,
}: HeightCmPickerProps) {
  const { locale, heightCalibration: copy } = useStudioVaaiUiMessages();
  const values = useMemo(
    () => Array.from({ length: MAX_CM - MIN_CM + 1 }, (_, i) => MIN_CM + i),
    [],
  );

  const normalizedValueCm = normalizeCm(valueCm);

  const scrollRef = useRef<HTMLDivElement>(null);
  /** Row nearest the viewport center — updates while scrolling for tiered fading. */
  const [centerCm, setCenterCm] = useState(normalizedValueCm);

  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const valueCmRef = useRef(normalizedValueCm);
  valueCmRef.current = normalizedValueCm;

  const cmFromScrollTop = useCallback(
    (scrollTop: number): number => {
      const idx = Math.round(scrollTop / ROW_PX);
      const clamped = Math.max(0, Math.min(values.length - 1, idx));
      return MIN_CM + clamped;
    },
    [values.length],
  );

  const updateCenterFromScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) {
      return;
    }
    setCenterCm(cmFromScrollTop(el.scrollTop));
  }, [cmFromScrollTop]);

  const syncSelectionFromScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) {
      return;
    }
    const cm = cmFromScrollTop(el.scrollTop);
    if (cm !== valueCmRef.current) {
      onChangeRef.current(cm);
    }
    setCenterCm(cm);
  }, [cmFromScrollTop]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) {
      return;
    }
    const idx = Math.max(0, Math.min(values.length - 1, normalizedValueCm - MIN_CM));
    const target = idx * ROW_PX;
    if (Math.abs(el.scrollTop - target) > 1) {
      el.scrollTop = target;
    }
    setCenterCm(normalizedValueCm);
  }, [normalizedValueCm, values.length]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) {
      return;
    }

    const onScroll = (): void => {
      updateCenterFromScroll();
    };

    const onScrollEnd = (): void => {
      syncSelectionFromScroll();
    };

    el.addEventListener("scroll", onScroll, { passive: true });
    updateCenterFromScroll();

    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    const onScrollDebounced = (): void => {
      if (debounceTimer !== null) {
        clearTimeout(debounceTimer);
      }
      debounceTimer = setTimeout(() => {
        onScrollEnd();
        debounceTimer = null;
      }, 80);
    };

    if (supportsScrollEnd()) {
      el.addEventListener("scrollend", onScrollEnd, { passive: true });
    } else {
      el.addEventListener("scroll", onScrollDebounced, { passive: true });
    }

    return () => {
      el.removeEventListener("scroll", onScroll);
      if (supportsScrollEnd()) {
        el.removeEventListener("scrollend", onScrollEnd);
      } else {
        el.removeEventListener("scroll", onScrollDebounced);
        if (debounceTimer !== null) {
          clearTimeout(debounceTimer);
        }
      }
    };
  }, [syncSelectionFromScroll, updateCenterFromScroll]);

  return (
    <div
      className={cn(
        "sv:relative sv:w-full sv:shrink-0 sv:select-none sv:overflow-hidden sv:rounded-[var(--sv-radius-button-primary)] sv:border sv:border-[var(--sv-color-border)] sv:bg-[var(--sv-color-bg)]",
        disabled && "sv:pointer-events-none sv:opacity-60",
      )}
      style={{ height: VIEWPORT_PX }}
      aria-disabled={disabled || undefined}
    >
      <div
        className="sv:pointer-events-none sv:absolute sv:inset-x-0 sv:top-0 sv:z-10 sv:h-2.5 sv:bg-gradient-to-b sv:from-[var(--sv-color-bg)] sv:to-transparent"
        aria-hidden
      />
      <div
        className="sv:pointer-events-none sv:absolute sv:inset-x-0 sv:bottom-0 sv:z-10 sv:h-2.5 sv:bg-gradient-to-t sv:from-[var(--sv-color-bg)] sv:to-transparent"
        aria-hidden
      />
      <div
        ref={scrollRef}
        tabIndex={disabled ? -1 : undefined}
        role="spinbutton"
        aria-valuemin={MIN_CM}
        aria-valuemax={MAX_CM}
        aria-valuenow={normalizedValueCm}
        {...(ariaLabelledBy === undefined
          ? { "aria-label": copy.heightInputSr }
          : { "aria-labelledby": ariaLabelledBy })}
        className={cn(
          "sv:h-full sv:overflow-y-auto sv:overscroll-y-contain sv:snap-y sv:snap-mandatory",
          "sv:[scrollbar-width:none] sv:[&::-webkit-scrollbar]:hidden",
        )}
      >
        <div style={{ paddingTop: PAD_PX, paddingBottom: PAD_PX }}>
          {values.map((v) => (
            <div
              key={v}
              style={{ height: ROW_PX }}
              className={cn(heightCmRowBaseClass, rowClassForDistance(Math.abs(v - centerCm)))}
            >
              {formatCentimeters(locale, v)}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function HeightCmPickerWheel(props: HeightCmPickerProps) {
  const Comp = useStudioVaaiUiComponent("HeightCmPickerWheel", HeightCmPickerWheelDefault);
  return <Comp {...props} />;
}
