import type { BodyValidationCode } from "@studio-vaai/js-client";

import { LitElement, html, nothing } from "lit";

import type { DebugSnapshot } from "../debug-snapshot.js";
import type {
  ApiCallLogEntry,
  DebugErrorKind,
  DebugLocale,
  DebugMethodId,
  DebugState,
} from "../types.js";

import { projectDebugSnapshot } from "../debug-snapshot.js";
import {
  clearBodyValidationFailure,
  clearError,
  getDebugState,
  injectBodyValidationFailure,
  injectError,
  setDebugLocale,
  subscribeDebugState,
} from "../debug-state.js";
import {
  ALL_METHOD_IDS,
  BODY_VALIDATION_CODES,
  DEBUG_LOCALES,
  DOMAIN_ERROR_METHOD_IDS,
  STANDARD_ERROR_KINDS,
} from "../types.js";
import { debuggerStyles } from "./studio-vaai-debugger.styles.js";

// ── Tab type ──────────────────────────────────────────────────────────────────

type Tab = "state" | "context" | "errors" | "log";

// ── Helpers ───────────────────────────────────────────────────────────────────

function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 1000) {
    return `${diff}ms ago`;
  }
  if (diff < 60_000) {
    return `${Math.round(diff / 1000)}s ago`;
  }
  return `${Math.round(diff / 60_000)}m ago`;
}

function groupedMethodIds(): { ns: string; ids: DebugMethodId[] }[] {
  const map = new Map<string, DebugMethodId[]>();
  for (const id of ALL_METHOD_IDS) {
    const ns = id.split(".")[0] ?? id;
    if (!map.has(ns)) {
      map.set(ns, []);
    }
    const arr = map.get(ns);
    if (arr !== undefined) {
      arr.push(id);
    }
  }
  return [...map.entries()].map(([ns, ids]) => ({ ns, ids }));
}

// ── Component ─────────────────────────────────────────────────────────────────

/**
 * `<studio-vaai-debugger>` — fixed overlay panel for SDK debugging.
 *
 * Uses Shadow DOM with self-contained styles (no host-page stylesheet dependency).
 * CSS custom properties (`--sv-color-*`) are inherited through Shadow DOM for
 * visual consistency, with standalone fallback values.
 *
 * Set `snapshot` (JS property) from the React `DebugSheetButton` bridge component.
 * Set `open` to show/hide the panel.
 */
class StudioVaaiDebugger extends LitElement {
  static override styles = [debuggerStyles];

  static override properties = {
    snapshot: { attribute: false, noAccessor: true },
    open: { type: Boolean, reflect: true },
  };

  // `declare` prevents TypeScript from emitting class field initializers that would
  // shadow Lit's reactive property accessors (https://lit.dev/msg/class-field-shadowing).
  private _snapshot: DebugSnapshot | null = null;
  get snapshot(): DebugSnapshot | null {
    return this._snapshot;
  }
  set snapshot(value: unknown) {
    const previous = this._snapshot;
    this._snapshot = projectDebugSnapshot(value);
    this.requestUpdate("snapshot", previous);
  }
  declare open: boolean;

  // Internal state (not reactive Lit properties — call `requestUpdate()` manually after mutating).
  private _tab: Tab = "state";
  private _debugState: DebugState = getDebugState();
  private _unsubscribe: (() => void) | null = null;
  private _errorKind: Partial<Record<DebugMethodId, DebugErrorKind>> = {};
  private _errorMessage: Partial<Record<DebugMethodId, string>> = {};
  private _validationCode: Partial<Record<DebugMethodId, BodyValidationCode>> = {};
  private _validationMessage: Partial<Record<DebugMethodId, string>> = {};

  constructor() {
    super();
    this.snapshot = null;
    this.open = false;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this._debugState = getDebugState();
    this._unsubscribe = subscribeDebugState((s) => {
      this._debugState = s;
      this.requestUpdate();
    });
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this._unsubscribe?.();
    this._unsubscribe = null;
    this.snapshot = null;
  }

  // ── Render helpers ──────────────────────────────────────────────────────────

  private _renderTabBar() {
    const tabs: Tab[] = ["state", "context", "errors", "log"];
    const activeInjections = Object.keys(this._debugState.injectedErrors).length;
    return html`
      <div class="tab-bar">
        ${tabs.map(
          (t) => html`
            <button
              type="button"
              class="tab-btn ${this._tab === t ? "tab-btn--active" : ""}"
              @click=${() => {
                this._tab = t;
                this.requestUpdate();
              }}
            >
              ${
                t === "errors" && activeInjections > 0
                  ? html`${t} <span class="tab-badge">${activeInjections}</span>`
                  : t
              }
            </button>
          `,
        )}
      </div>
    `;
  }

  private _renderStateTab() {
    if (this.snapshot === null) {
      return html`<div class="pane">
        <p class="empty-msg">No snapshot yet. Open the sheet to start.</p>
      </div>`;
    }
    const snap = this.snapshot;
    const { phase, productPhase, variant, recommendation, tryOnPipeline } = snap;

    return html`
      <div class="pane">
        ${this._row("phase", this._badge(phase, phase === "unknown" ? "muted" : "primary"))}
        ${
          productPhase !== null
            ? this._row("productPhase", this._badge(productPhase, "muted"))
            : nothing
        }
        ${variant !== null ? this._row("variant", this._badge(variant, "muted")) : nothing}
        ${
          recommendation !== null
            ? this._row(
                "recommendation",
                this._badge(recommendation, recommendation === "error" ? "danger" : "muted"),
              )
            : nothing
        }
        ${
          tryOnPipeline !== null
            ? this._row(
                "tryOnPipeline",
                this._badge(tryOnPipeline, tryOnPipeline === "error" ? "danger" : "muted"),
              )
            : nothing
        }
        <details>
          <summary>Phase summary</summary>
          <pre>${JSON.stringify(snap, null, 2)}</pre>
        </details>
      </div>
    `;
  }

  private _renderContextTab() {
    if (this.snapshot === null) {
      return html`<div class="pane"><p class="empty-msg">No snapshot yet.</p></div>`;
    }
    const snap = this.snapshot;
    return html`
      <div class="pane">
        ${this._row("productId", html`<code>${snap.productId ?? "–"}</code>`)}
        ${this._row("variantResolved", html`<code>${snap.variantResolved}</code>`)}
        <p class="empty-msg">Only machine phases and product metadata are captured.</p>
      </div>
    `;
  }

  private _renderErrorsTab() {
    return html`
      <div class="pane">
        <div class="errors-groups">
          ${groupedMethodIds().map(
            ({ ns, ids }) => html`
              <div class="ns-group">
                <p class="ns-label">${ns}</p>
                ${ids.map((id) => this._renderMethodRow(id))}
              </div>
            `,
          )}
        </div>
      </div>
    `;
  }

  private _renderMethodRow(id: DebugMethodId) {
    const methodName = id.split(".")[1] ?? id;
    const active = this._debugState.injectedErrors[id] !== undefined;
    // Domain (validation) failures are not DebugErrorKinds — they are injected via
    // `injectBodyValidationFailure` and rendered in a separate row below for `body.createBody`.
    const kinds: readonly DebugErrorKind[] = STANDARD_ERROR_KINDS;
    const currentKind: DebugErrorKind =
      this._errorKind[id] ?? this._debugState.injectedErrors[id]?.kind ?? "internal_server_error";
    const currentMsg: string =
      this._errorMessage[id] ?? this._debugState.injectedErrors[id]?.message ?? "Injected error";

    return html`
      <div class="method-row ${active ? "method-row--active" : ""}">
        <div class="method-row__head">
          <input
            type="checkbox"
            id="chk-${id}"
            .checked=${active}
            @change=${(e: Event) => {
              const { checked } = e.target as HTMLInputElement;
              if (checked) {
                injectError(id, currentKind, currentMsg);
              } else {
                clearError(id);
              }
            }}
          />
          <label for="chk-${id}" class="method-row__name">${methodName}</label>
          ${active ? html`<span class="method-row__dot" aria-hidden="true"></span>` : nothing}
        </div>
        <div class="method-row__fields">
          <select
            class="select"
            .value=${currentKind}
            @change=${(e: Event) => {
              const kind = (e.target as HTMLSelectElement).value as DebugErrorKind;
              this._errorKind = { ...this._errorKind, [id]: kind };
              if (active) {
                injectError(id, kind, currentMsg);
              }
              this.requestUpdate();
            }}
          >
            ${kinds.map(
              (k) => html`<option value=${k} .selected=${k === currentKind}>${k}</option>`,
            )}
          </select>
          <input
            type="text"
            placeholder="message"
            class="text-input"
            .value=${currentMsg}
            @input=${(e: Event) => {
              const msg = (e.target as HTMLInputElement).value;
              this._errorMessage = { ...this._errorMessage, [id]: msg };
              if (active) {
                injectError(id, currentKind, msg);
              }
            }}
          />
        </div>
        ${DOMAIN_ERROR_METHOD_IDS.has(id) ? this._renderValidationRow(id) : nothing}
      </div>
    `;
  }

  /** Sub-row for typed validation-failure injection (only `body.createBody`). */
  private _renderValidationRow(id: DebugMethodId) {
    const active = this._debugState.injectedBodyValidationFailures[id] !== undefined;
    const defaultCode = BODY_VALIDATION_CODES.at(0);
    if (defaultCode === undefined) {
      return nothing;
    }
    const currentCode: BodyValidationCode =
      this._validationCode[id] ??
      this._debugState.injectedBodyValidationFailures[id]?.code ??
      defaultCode;
    const currentMsg: string =
      this._validationMessage[id] ??
      this._debugState.injectedBodyValidationFailures[id]?.message ??
      "";

    return html`
      <div class="method-row__fields" style="margin-top: 8px;">
        <input
          type="checkbox"
          id="val-${id}"
          .checked=${active}
          @change=${(e: Event) => {
            const { checked } = e.target as HTMLInputElement;
            if (checked) {
              injectBodyValidationFailure(id, currentCode, currentMsg || undefined);
            } else {
              clearBodyValidationFailure(id);
            }
          }}
        />
        <label for="val-${id}" class="method-row__name">domain rejection</label>
        <select
          class="select"
          .value=${currentCode}
          @change=${(e: Event) => {
            const code = (e.target as HTMLSelectElement).value as BodyValidationCode;
            this._validationCode = { ...this._validationCode, [id]: code };
            if (active) {
              injectBodyValidationFailure(id, code, currentMsg || undefined);
            }
            this.requestUpdate();
          }}
        >
          ${BODY_VALIDATION_CODES.map(
            (c) => html`<option value=${c} .selected=${c === currentCode}>${c}</option>`,
          )}
        </select>
        <input
          type="text"
          placeholder="optional message"
          class="text-input"
          .value=${currentMsg}
          @input=${(e: Event) => {
            const msg = (e.target as HTMLInputElement).value;
            this._validationMessage = { ...this._validationMessage, [id]: msg };
            if (active) {
              injectBodyValidationFailure(id, currentCode, msg || undefined);
            }
          }}
        />
      </div>
    `;
  }

  private _renderLogTab() {
    const entries = [...this._debugState.log].toReversed();
    if (entries.length === 0) {
      return html`<div class="pane"><p class="empty-msg">No API calls recorded yet.</p></div>`;
    }
    return html`
      <div class="pane pane--log">
        <div class="log-list">${entries.map((e) => this._renderLogEntry(e))}</div>
      </div>
    `;
  }

  private _renderLogEntry(e: ApiCallLogEntry) {
    const isInjected = e.summary.includes("injected");
    return html`
      <div class="log-entry">
        <span class="log-entry__status ${e.ok ? "log-entry__status--ok" : "log-entry__status--err"}"
          >${e.ok ? "✓" : "✗"}</span
        >
        <div class="log-entry__body">
          <div class="log-entry__meta">
            <code>${e.methodId}</code>
            ${isInjected ? html`<span class="log-entry__injected">injected</span>` : nothing}
            <span class="log-entry__duration">${e.durationMs}ms</span>
          </div>
          <div class="log-entry__time">${relativeTime(e.ts)}</div>
        </div>
      </div>
    `;
  }

  /**
   * SDK-UI language override in the header: `app` follows the host's own locale; picking a locale
   * forces it (persisted; hosts follow via the locale contract — see `setDebugLocale`).
   */
  private _renderLocaleSelect() {
    const current = this._debugState.locale ?? "";
    return html`
      <select
        class="select select--locale"
        title="SDK UI language (app = host default)"
        aria-label="SDK UI language"
        .value=${current}
        @change=${(e: Event) => {
          const v = (e.target as HTMLSelectElement).value;
          setDebugLocale(v === "" ? null : (v as DebugLocale));
        }}
      >
        <option value="" .selected=${current === ""}>lang: app</option>
        ${DEBUG_LOCALES.map(
          (l) => html`<option value=${l} .selected=${l === current}>lang: ${l}</option>`,
        )}
      </select>
    `;
  }

  // ── Small UI helpers ────────────────────────────────────────────────────────

  private _row(label: string, value: unknown) {
    return html`
      <div class="row">
        <span class="row__label">${label}</span>
        <span class="row__value">${value}</span>
      </div>
    `;
  }

  private _badge(text: string, variant: "primary" | "muted" | "danger" | "ok") {
    return html`<span class="badge badge--${variant}">${text}</span>`;
  }

  // ── Main render ─────────────────────────────────────────────────────────────

  override render() {
    if (!this.open) {
      return nothing;
    }

    return html`
      <div class="panel">
        <!-- Header -->
        <div class="header">
          <span class="header__title">studio vaai debugger</span>
          <span class="header__controls">
            ${this._renderLocaleSelect()}
            <button
              type="button"
              class="close-btn"
              aria-label="Close debugger"
              @click=${() => {
                this.open = false;
              }}
            >
              ×
            </button>
          </span>
        </div>

        <!-- Tab bar -->
        ${this._renderTabBar()}

        <!-- Tab content -->
        <div class="content">
          ${this._tab === "state" ? this._renderStateTab() : nothing}
          ${this._tab === "context" ? this._renderContextTab() : nothing}
          ${this._tab === "errors" ? this._renderErrorsTab() : nothing}
          ${this._tab === "log" ? this._renderLogTab() : nothing}
        </div>
      </div>
    `;
  }
}

customElements.define("studio-vaai-debugger", StudioVaaiDebugger);
