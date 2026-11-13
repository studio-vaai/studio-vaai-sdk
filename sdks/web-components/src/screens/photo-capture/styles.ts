import { css } from "lit";

/** Only composition lives here; the camera and image elements own their rendering. */
export const photoCaptureStyles = css`
  :host {
    container: sv-photo-capture / inline-size;
    display: block;
    block-size: 100%;
    min-block-size: 0;
    color: var(--_sv-foreground);
  }
  sv-screen::part(stage) {
    background: transparent;
  }
  .stage {
    position: relative;
    display: grid;
    place-items: center;
    container-type: size;
    --_sv-capture-aspect: 0.75;
  }
  .frame {
    position: relative;
    inline-size: min(100cqi, 100cqb * var(--_sv-capture-aspect));
    aspect-ratio: var(--_sv-capture-aspect);
    min-block-size: 0;
    overflow: hidden;
    border-radius: var(--_sv-radius-xl);
    background: var(--_sv-media-background);
    color: var(--_sv-media-foreground);
  }
  sv-camera,
  .frame > sv-image {
    inline-size: 100%;
    block-size: 100%;
  }
  .frame > sv-image::part(frame) {
    border-radius: var(--_sv-radius-xl);
  }
  .placeholder {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: calc(var(--_sv-spacing) * 3);
    padding: calc(var(--_sv-spacing) * 6);
    text-align: center;
    overflow-y: auto;
  }
  .placeholder p,
  .placeholder h3 {
    margin: 0;
    font-size: var(--_sv-text-base);
    line-height: 1.5;
  }
  .placeholder h3 {
    font-weight: var(--_sv-font-weight-medium);
  }
  .placeholder sv-icon {
    --_sv-icon-size: calc(var(--_sv-spacing) * 6);
    padding: calc(var(--_sv-spacing) * 3);
    border-radius: var(--_sv-radius-full);
    background: var(--_sv-media-control);
  }
  .failure {
    background: transparent;
    color: var(--_sv-foreground);
  }
  .failure sv-message {
    text-align: start;
  }
  .guidance::part(message) {
    border: 0;
    border-radius: var(--_sv-radius-lg);
    padding: calc(var(--_sv-spacing) * 3) calc(var(--_sv-spacing) * 4);
    color: var(--_sv-foreground);
    line-height: 1.5;
  }
  .guidance::part(icon) {
    --_sv-icon-size: calc(var(--_sv-spacing) * 4);
    margin-block-start: calc(var(--_sv-spacing) * 0.5);
    color: inherit;
  }
  .mobile-guidance {
    position: absolute;
    inset-inline: 0;
    inset-block-end: 0;
    border-radius: 0 0 var(--_sv-radius-xl) var(--_sv-radius-xl);
    /* As with the picker, clip the composited blur to the surface's actual outline. */
    clip-path: inset(0 round 0 0 var(--_sv-radius-xl) var(--_sv-radius-xl));
  }
  .mobile-guidance .guidance::part(message) {
    background: transparent;
    color: inherit;
  }
  .desktop-guidance {
    display: none;
  }
  @container sv-photo-capture (width < 40rem) {
    sv-screen::part(stage) {
      margin-block-start: var(--_sv-screen-gap);
    }
    sv-screen::part(panel) {
      /* Narrow layouts show guidance inside the camera frame. */
      padding-block-start: 0;
    }
  }
  @container sv-photo-capture (min-width: 40rem) {
    .stage {
      --_sv-capture-aspect: 1.3333333333;
    }
    .desktop-guidance {
      display: block;
    }
    .mobile-guidance {
      display: none;
    }
  }
`;
