import { css } from "lit";

export const debuggerStyles = css`
  :host {
    --dbg-bg: #ffffff;
    --dbg-fg: #18181b;
    --dbg-muted: #f4f4f5;
    --dbg-muted-fg: #71717a;
    --dbg-border: #e4e4e7;
    --dbg-primary: #18181b;
    --dbg-primary-fg: #fafafa;
    --dbg-danger: #dc2626;
    --dbg-radius: 4px;
    --dbg-font: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    --dbg-mono: ui-monospace, "SFMono-Regular", "Cascadia Code", Menlo, monospace;
    display: block;
  }

  /* ── Panel ──────────────────────────────────────────────────── */
  .panel {
    position: fixed;
    inset-block: 0;
    inset-inline-end: 0;
    z-index: 9999;
    width: 24rem;
    display: flex;
    flex-direction: column;
    background: var(--dbg-bg);
    box-shadow: -4px 0 24px rgba(0, 0, 0, 0.12);
    color: var(--dbg-fg);
    font-family: var(--dbg-font);
    font-size: 0.875rem;
  }

  /* ── Header ─────────────────────────────────────────────────── */
  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.75rem 1rem;
    border-bottom: 1px solid var(--dbg-border);
    flex-shrink: 0;
  }

  .header__title {
    font-size: 0.875rem;
    font-weight: 600;
  }

  .header__controls {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  /* Compact enough to sit in the header next to the close button. */
  .select--locale {
    flex: none;
    width: auto;
  }

  .close-btn {
    appearance: none;
    background: none;
    border: none;
    cursor: pointer;
    color: var(--dbg-muted-fg);
    font-size: 1.25rem;
    line-height: 1;
    width: 2rem;
    height: 2rem;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: var(--dbg-radius);
    padding: 0;
    transition:
      color 0.1s,
      background 0.1s;
  }

  .close-btn:hover {
    color: var(--dbg-fg);
    background: var(--dbg-muted);
  }

  /* ── Tab bar ────────────────────────────────────────────────── */
  .tab-bar {
    display: flex;
    border-bottom: 1px solid var(--dbg-border);
    flex-shrink: 0;
  }

  .tab-btn {
    appearance: none;
    background: none;
    border: none;
    border-bottom: 2px solid transparent;
    cursor: pointer;
    flex: 1;
    padding: 0.5rem 0.25rem;
    font-size: 0.75rem;
    font-weight: 500;
    font-family: inherit;
    color: var(--dbg-muted-fg);
    transition: color 0.1s;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.25rem;
  }

  .tab-btn:hover {
    color: var(--dbg-fg);
  }

  .tab-btn--active {
    border-bottom-color: var(--dbg-primary);
    color: var(--dbg-fg);
  }

  .tab-badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1rem;
    height: 1rem;
    border-radius: 9999px;
    background: var(--dbg-danger);
    color: #fff;
    font-size: 0.625rem;
    font-weight: 700;
  }

  /* ── Content ────────────────────────────────────────────────── */
  .content {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
    overflow: hidden;
  }

  .pane {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 1rem;
    gap: 0.5rem;
  }

  .pane--log {
    padding: 0;
  }

  .empty-msg {
    font-size: 0.75rem;
    color: var(--dbg-muted-fg);
  }

  /* ── Row ────────────────────────────────────────────────────── */
  .row {
    display: flex;
    align-items: flex-start;
    gap: 0.75rem;
    font-size: 0.75rem;
  }

  .row__label {
    width: 8rem;
    flex-shrink: 0;
    color: var(--dbg-muted-fg);
    font-weight: 500;
  }

  .row__value {
    flex: 1;
    min-width: 0;
    word-break: break-all;
  }

  /* ── Badges ─────────────────────────────────────────────────── */
  .badge {
    display: inline-flex;
    align-items: center;
    border-radius: var(--dbg-radius);
    padding: 0.125rem 0.375rem;
    font-size: 0.625rem;
    font-weight: 600;
    line-height: 1.4;
  }

  .badge--primary {
    background: var(--dbg-primary);
    color: var(--dbg-primary-fg);
  }

  .badge--muted {
    background: var(--dbg-muted);
    color: var(--dbg-muted-fg);
  }

  .badge--danger {
    background: #fee2e2;
    color: var(--dbg-danger);
  }

  .badge--ok {
    background: #dcfce7;
    color: #16a34a;
  }

  /* ── Code / Pre ─────────────────────────────────────────────── */
  code {
    font-family: var(--dbg-mono);
    font-size: 0.625rem;
    background: var(--dbg-muted);
    border-radius: var(--dbg-radius);
    padding: 0.125rem 0.25rem;
  }

  pre {
    font-family: var(--dbg-mono);
    font-size: 0.625rem;
    line-height: 1.6;
    background: var(--dbg-muted);
    border-radius: var(--dbg-radius);
    padding: 0.5rem;
    overflow-x: auto;
    margin: 0.5rem 0 0;
  }

  details summary {
    cursor: pointer;
    user-select: none;
    font-size: 0.75rem;
    color: var(--dbg-muted-fg);
  }

  /* ── Link ───────────────────────────────────────────────────── */
  a {
    color: #2563eb;
    text-decoration: underline;
    font-size: 0.625rem;
    font-family: var(--dbg-mono);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    display: inline-block;
    max-width: 14rem;
    vertical-align: bottom;
  }

  /* ── Errors tab ─────────────────────────────────────────────── */
  .errors-groups {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .ns-group {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .ns-label {
    font-size: 0.625rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--dbg-muted-fg);
  }

  .method-row {
    border: 1px solid var(--dbg-border);
    border-radius: var(--dbg-radius);
    padding: 0.5rem;
  }

  .method-row--active {
    border-color: var(--dbg-danger);
  }

  .method-row__head {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 0.5rem;
  }

  .method-row__name {
    font-size: 0.75rem;
    font-weight: 500;
    cursor: pointer;
    flex: 1;
    font-family: var(--dbg-mono);
  }

  .method-row__dot {
    width: 0.5rem;
    height: 0.5rem;
    border-radius: 9999px;
    background: var(--dbg-danger);
    flex-shrink: 0;
  }

  .method-row__fields {
    display: flex;
    gap: 0.5rem;
  }

  .select,
  .text-input {
    flex: 1;
    font-size: 0.75rem;
    font-family: inherit;
    border: 1px solid var(--dbg-border);
    border-radius: var(--dbg-radius);
    background: var(--dbg-bg);
    color: var(--dbg-fg);
    padding: 0.25rem 0.5rem;
    min-width: 0;
  }

  .select:focus,
  .text-input:focus {
    outline: 2px solid var(--dbg-primary);
    outline-offset: -1px;
  }

  input[type="checkbox"] {
    cursor: pointer;
    width: 0.875rem;
    height: 0.875rem;
    accent-color: var(--dbg-primary);
    flex-shrink: 0;
  }

  /* ── Log tab ────────────────────────────────────────────────── */
  .log-list {
    display: flex;
    flex-direction: column;
    overflow-y: auto;
    flex: 1;
    min-height: 0;
  }

  .log-entry {
    display: flex;
    align-items: flex-start;
    gap: 0.5rem;
    padding: 0.5rem 1rem;
    border-bottom: 1px solid var(--dbg-border);
    font-size: 0.75rem;
  }

  .log-entry__status {
    flex-shrink: 0;
    font-weight: 700;
  }

  .log-entry__status--ok {
    color: #16a34a;
  }

  .log-entry__status--err {
    color: var(--dbg-danger);
  }

  .log-entry__body {
    flex: 1;
    min-width: 0;
  }

  .log-entry__meta {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    flex-wrap: wrap;
  }

  .log-entry__injected {
    font-size: 0.625rem;
    font-weight: 500;
    color: var(--dbg-danger);
  }

  .log-entry__duration {
    color: var(--dbg-muted-fg);
  }

  .log-entry__time {
    font-size: 0.625rem;
    color: var(--dbg-muted-fg);
    margin-top: 0.125rem;
  }
`;
