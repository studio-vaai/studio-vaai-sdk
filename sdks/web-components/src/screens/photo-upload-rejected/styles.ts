import { css } from "lit";

/** Keep the rejected photo, failure message and recovery actions together at every width. */
export const photoUploadRejectedStyles = css`
  :host {
    display: block;
    block-size: 100%;
    min-block-size: 0;
    color: var(--_sv-foreground);
  }
  .heading {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: calc(var(--_sv-spacing) * 2);
    min-inline-size: 0;
  }
  .heading sv-icon {
    flex: none;
    --_sv-icon-size: calc(var(--_sv-spacing) * 4);
  }
  .heading span {
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    overflow: hidden;
    overflow-wrap: break-word;
    text-wrap: balance;
  }
`;
