"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";

import { useStudioVaaiUiMessages } from "../i18n/context.js";
import { centimeterAffixes } from "../i18n/number-format.js";
import { useStudioVaaiUiComponent } from "../studio-vaai-ui-components-context.js";
import { cn } from "./cn.js";
import {
  MAX_CM,
  MIN_CM,
  normalizeCm,
  type HeightCmPickerProps,
} from "./height-cm-picker-shared.js";

function ChevronUp(): React.ReactElement {
  return (
    <svg viewBox="0 0 10 6" width="10" height="6" aria-hidden focusable="false">
      <path
        d="M1 5L5 1L9 5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ChevronDown(): React.ReactElement {
  return (
    <svg viewBox="0 0 10 6" width="10" height="6" aria-hidden focusable="false">
      <path
        d="M1 1L5 5L9 1"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function HeightCmPickerStepperDefault({
  valueCm,
  onChange,
  disabled = false,
  "aria-labelledby": ariaLabelledBy,
}: HeightCmPickerProps) {
  const { locale, heightCalibration: copy } = useStudioVaaiUiMessages();
  const inputRef = useRef<HTMLInputElement>(null);
  const normalizedValueCm = normalizeCm(valueCm);
  // The input draws the number; the locale decides the unit text and which side it sits on.
  const unit = centimeterAffixes(locale, normalizedValueCm);
  const [draft, setDraft] = useState(String(normalizedValueCm));

  useEffect(() => {
    setDraft(String(normalizedValueCm));
  }, [normalizedValueCm]);

  const commit = (n: number): void => {
    const next = normalizeCm(n);
    setDraft(String(next));
    if (next !== valueCm) {
      onChange(next);
    }
  };

  const commitDraft = (): void => {
    const n = Number.parseInt(draft, 10);
    if (Number.isNaN(n)) {
      setDraft(String(normalizedValueCm));
      return;
    }
    commit(n);
  };

  const step = (delta: number): void => {
    commit(normalizedValueCm + delta);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === "ArrowUp") {
      e.preventDefault();
      step(1);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      step(-1);
    } else if (e.key === "Enter") {
      e.preventDefault();
      commitDraft();
    }
  };

  return (
    <div
      className={cn(
        "sv:relative sv:flex sv:w-full sv:items-stretch sv:overflow-hidden",
        "sv:rounded-[var(--sv-radius-button-primary)] sv:border sv:border-[var(--sv-color-border)] sv:bg-[var(--sv-color-bg)]",
        "sv:transition-colors sv:focus-within:border-[var(--sv-color-foreground)]",
        disabled && "sv:pointer-events-none sv:opacity-60",
      )}
      aria-disabled={disabled || undefined}
    >
      {/* `<label>` natively delegates click to the wrapped input, so the unit
          text and empty padding focus the input without a JS click handler.
          The chevron column is a sibling, so arrow clicks are unaffected. */}
      <label className="sv:flex sv:min-w-0 sv:flex-1 sv:cursor-text sv:items-baseline sv:gap-1.5 sv:px-4 sv:py-2.5">
        {unit.prefix === "" ? null : (
          <span
            aria-hidden
            className="sv:pointer-events-none sv:text-base sv:font-normal sv:leading-none sv:text-[var(--sv-color-foreground-secondary)]"
          >
            {unit.prefix}
          </span>
        )}
        <input
          ref={inputRef}
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={3}
          value={draft}
          disabled={disabled}
          role="spinbutton"
          aria-valuemin={MIN_CM}
          aria-valuemax={MAX_CM}
          aria-valuenow={normalizedValueCm}
          {...(ariaLabelledBy === undefined
            ? { "aria-label": copy.heightInputSr }
            : { "aria-labelledby": ariaLabelledBy })}
          onChange={(e) => {
            // Strip non-digits live so pasted values like "175 cm" land as
            // "175"; `maxLength={3}` caps the length without blocking shorter
            // intermediate states (e.g. "1" while typing "175").
            const digitsOnly = e.currentTarget.value.replaceAll(/\D/g, "");
            setDraft(digitsOnly);
          }}
          onBlur={commitDraft}
          onKeyDown={onKeyDown}
          className="sv:w-[3ch] sv:shrink-0 sv:appearance-none sv:border-0 sv:bg-transparent sv:p-0 sv:text-right sv:text-base sv:font-medium sv:tabular-nums sv:leading-none sv:text-[var(--sv-color-foreground)] sv:outline-none sv:focus:outline-none"
        />
        {unit.suffix === "" ? null : (
          <span
            aria-hidden
            className="sv:pointer-events-none sv:text-base sv:font-normal sv:leading-none sv:text-[var(--sv-color-foreground-secondary)]"
          >
            {unit.suffix}
          </span>
        )}
      </label>
      <div className="sv:flex sv:w-9 sv:shrink-0 sv:flex-col sv:border-l sv:border-[var(--sv-color-border)]">
        <button
          type="button"
          disabled={disabled || normalizedValueCm >= MAX_CM}
          aria-label={copy.increaseHeightSr}
          tabIndex={-1}
          onClick={() => {
            step(1);
          }}
          className="sv:flex sv:flex-1 sv:appearance-none sv:items-center sv:justify-center sv:border-0 sv:bg-transparent sv:p-0 sv:text-[var(--sv-color-foreground)] sv:outline-none sv:transition-colors sv:hover:bg-[var(--sv-color-muted)] sv:active:bg-[var(--sv-color-border)] sv:disabled:cursor-not-allowed sv:disabled:opacity-30 sv:disabled:hover:bg-transparent"
        >
          <ChevronUp />
        </button>
        <div aria-hidden className="sv:h-px sv:bg-[var(--sv-color-border)]" />
        <button
          type="button"
          disabled={disabled || normalizedValueCm <= MIN_CM}
          aria-label={copy.decreaseHeightSr}
          tabIndex={-1}
          onClick={() => {
            step(-1);
          }}
          className="sv:flex sv:flex-1 sv:appearance-none sv:items-center sv:justify-center sv:border-0 sv:bg-transparent sv:p-0 sv:text-[var(--sv-color-foreground)] sv:outline-none sv:transition-colors sv:hover:bg-[var(--sv-color-muted)] sv:active:bg-[var(--sv-color-border)] sv:disabled:cursor-not-allowed sv:disabled:opacity-30 sv:disabled:hover:bg-transparent"
        >
          <ChevronDown />
        </button>
      </div>
    </div>
  );
}

export function HeightCmPickerStepper(props: HeightCmPickerProps) {
  const Comp = useStudioVaaiUiComponent("HeightCmPickerStepper", HeightCmPickerStepperDefault);
  return <Comp {...props} />;
}
