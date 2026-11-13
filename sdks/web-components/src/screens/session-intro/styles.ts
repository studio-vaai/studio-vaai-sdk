import { css } from "lit";

/** Screen-local composition rules; shared controls keep their own styling. */
export const sessionIntroStyles = css`
  :host {
    --_sv-legal-link: #007aff;
    --_sv-legal-link-hover: #0051d5;
    container: sv-session-intro / inline-size;
    display: block;
    block-size: 100%;
    min-block-size: 0;
    color: var(--_sv-foreground);
  }
  :host([data-sv-appearance="dark"]) {
    --_sv-legal-link-hover: #5daaff;
  }
  sv-screen::part(stage) {
    background: transparent;
    border-radius: 0;
  }
  sv-screen::part(panel),
  sv-screen::part(actions) {
    padding-block-start: calc(var(--_sv-spacing) * 2.5);
  }
  .guide {
    display: flex;
    align-items: center;
    justify-content: center;
    min-inline-size: 0;
    min-block-size: 0;
  }
  .guide-frame {
    /* The attribution sits at the foot of the illustration on narrow screens. */
    position: relative;
    aspect-ratio: 589 / 600;
    inline-size: 100%;
    max-block-size: 100%;
    background: transparent;
    border-radius: var(--_sv-radius-lg);
  }
  .guide sv-photo-guide {
    inline-size: 100%;
    block-size: 100%;
  }
  .guide-credit {
    position: absolute;
    inset-inline-end: 0;
    inset-block-end: 0;
    display: flex;
  }
  .guide-credit::part(lockup) {
    flex-direction: column;
    align-items: flex-end;
    gap: calc(var(--_sv-spacing) * 0.5);
    font-size: calc(var(--_sv-root) * 0.6875);
  }
  .guide-credit::part(lockup),
  .header-credit::part(lockup) {
    color: var(--_sv-muted-foreground);
  }
  .header-credit,
  .steps {
    display: none;
  }
  .panel {
    display: grid;
    gap: calc(var(--_sv-spacing) * 4);
  }
  .privacy::part(card) {
    background: var(--_sv-surface-raised);
    box-shadow: 0 calc(var(--_sv-spacing) * 0.5) calc(var(--_sv-spacing) * 4) rgb(0 0 0 / 0.07);
    backdrop-filter: none;
  }
  .privacy::part(summary) {
    font-size: calc(var(--_sv-root) * 0.8125);
    line-height: 1.25;
  }
  .privacy::part(chevron) {
    /* Fill the legacy 12px slot: this glyph occupies half its shared 24px viewBox. */
    scale: 2;
    --_sv-icon-stroke: 1;
  }
  .consent {
    margin-block-end: calc(var(--_sv-spacing) * 2.5);
  }
  .consent sv-checkbox::part(validation-error) {
    /* The visible alert sits above the actions. aria-describedby still references this text. */
    display: none;
  }
  sv-checkbox::part(text),
  .legal,
  .withdrawal::part(summary),
  .withdrawal::part(content) {
    font-size: calc(var(--_sv-root) * 0.6875);
    line-height: 1.375;
    font-weight: var(--_sv-font-weight-normal);
    color: var(--_sv-muted-foreground);
  }
  .withdrawal {
    --_sv-ease: cubic-bezier(0, 0, 0.2, 1);
    margin-inline-start: calc(var(--_sv-spacing) * 6.5);
  }
  .withdrawal::part(card) {
    background: transparent;
    box-shadow: none;
    backdrop-filter: none;
  }
  .withdrawal::part(summary) {
    inline-size: fit-content;
    padding: 0;
    gap: calc(var(--_sv-spacing) * 1);
    color: var(--_sv-legal-link);
  }
  .withdrawal::part(summary):hover {
    color: var(--_sv-legal-link-hover);
  }
  .withdrawal::part(chevron) {
    --_sv-icon-size: calc(var(--_sv-root) * 0.625);
    transition: transform 200ms cubic-bezier(0.4, 0, 0.2, 1);
  }
  .withdrawal::part(content) {
    padding: calc(var(--_sv-spacing) * 1) 0 0;
    /* Let the expanding height reveal the text without fading it. */
    opacity: 1;
    transition: none;
  }
  .legal {
    margin: 0 0 calc(var(--_sv-spacing) * 2);
  }
  a {
    color: var(--_sv-legal-link);
    text-decoration: none;
  }
  .before-actions:has(.errors) .legal {
    margin-block-end: 0;
  }
  .errors {
    display: grid;
    gap: calc(var(--_sv-spacing) * 2);
    margin-block: calc(var(--_sv-spacing) * 3);
  }
  @container sv-session-intro (min-width: 40rem) {
    .guide-frame {
      block-size: 100%;
      inline-size: auto;
      max-inline-size: 100%;
    }
    .steps {
      display: block;
    }
    .header-credit {
      display: inline-block;
    }
    .subtitle,
    .guide-credit {
      display: none;
    }
    sv-screen::part(panel) {
      padding-block-start: 0;
    }
    sv-screen::part(actions) {
      padding-block-start: calc(var(--_sv-spacing) * 4);
    }
  }
`;
