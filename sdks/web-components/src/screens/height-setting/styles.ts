import { css } from "lit";

/** Only the screen's arrangement lives here; image and input rendering stay in their elements. */
export const heightSettingStyles = css`
  :host {
    container: sv-height-setting / inline-size;
    display: block;
    block-size: 100%;
    min-block-size: 0;
    color: var(--_sv-foreground);
  }
  sv-screen::part(stage) {
    background: transparent;
    border-radius: 0;
  }
  .picker {
    display: grid;
    gap: calc(var(--_sv-spacing) * 2);
  }
  .height-label {
    font-size: var(--_sv-text-xs);
    line-height: 1.5;
    color: var(--_sv-muted-foreground);
  }
  .error {
    margin-block-end: calc(var(--_sv-spacing) * 2);
  }
  @container sv-height-setting (min-width: 40rem) {
    .height-label {
      font-size: var(--_sv-text-base);
      font-weight: var(--_sv-font-weight-medium);
      color: var(--_sv-foreground);
    }
  }
`;
