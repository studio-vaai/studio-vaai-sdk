/**
 * What `sv-dialog` and `sv-alert-dialog` share: page scroll lock, the exit transition, and the
 * native `<dialog>` calls. The top layer itself is the browser's (`showModal()`).
 */

let locks = 0;
let previous: { overflow: string; gutter: string } | null = null;

/**
 * Stop the shop's page from scrolling behind an open overlay. `showModal()` makes the page inert
 * but leaves it scrollable. Counted, so the alert dialog closing doesn't unlock under the flow.
 * `scrollbar-gutter: stable` keeps the page from shifting when its scrollbar disappears.
 */
function lockPageScroll(): void {
  locks += 1;
  if (locks > 1) {
    return;
  }
  const { style } = document.documentElement;
  previous = { overflow: style.overflow, gutter: style.scrollbarGutter };
  style.overflow = "hidden";
  style.scrollbarGutter = "stable";
}

export function unlockPageScroll(): void {
  if (locks === 0) {
    return;
  }
  locks -= 1;
  if (locks > 0 || previous === null) {
    return;
  }
  const { style } = document.documentElement;
  style.overflow = previous.overflow;
  style.scrollbarGutter = previous.gutter;
  previous = null;
}

/**
 * Open as a modal in the top layer; no-op when not in the document. Opened again while its exit
 * plays, it stays open: dropping `data-closing` turns the transition around, and the pending
 * exit sees that it was superseded.
 */
export function showModal(dialog: HTMLDialogElement): boolean {
  if (dialog.dataset["closing"] !== undefined) {
    delete dialog.dataset["closing"];
    exits.set(dialog, (exits.get(dialog) ?? 0) + 1);
    return false;
  }
  if (dialog.open || !dialog.isConnected) {
    return false;
  }
  dialog.showModal();
  lockPageScroll();
  return true;
}

/** Counts each dialog's exits, so an exit that was overtaken by a reopen doesn't close it. */
const exits = new WeakMap<HTMLDialogElement, number>();

const closing = new WeakSet<HTMLDialogElement>();

/**
 * Whether this `close` event comes from our own `close()`. Browsers fire `close` in a later
 * task, so the mark stays until the event arrives and is consumed here. Anything else is a
 * close the browser forced.
 */
export function consumeOwnClose(dialog: HTMLDialogElement): boolean {
  return closing.delete(dialog);
}

/**
 * Play the exit, then close. `data-closing` switches the stylesheet to the exit state, and the
 * dialog closes once the transitions that started have finished, so their length lives only in
 * CSS (the motion tokens, reduced motion, a shop's override). Nothing transitions: it closes
 * right away. Exit transitions on `display`/`overlay` would do this in CSS alone, but not in
 * every engine yet.
 */
export function closeWithTransition(dialog: HTMLDialogElement): void {
  if (!dialog.open || dialog.dataset["closing"] !== undefined) {
    return;
  }
  dialog.dataset["closing"] = "";
  const exit = (exits.get(dialog) ?? 0) + 1;
  exits.set(dialog, exit);
  void closeAfterExit(dialog, exit);
}

async function closeAfterExit(dialog: HTMLDialogElement, exit: number): Promise<void> {
  // getAnimations() flushes style, so it already sees the transitions `data-closing` started.
  // The box's own only: its exit outlasts the ::backdrop fade, and a subtree would include
  // endless ones such as a loading spinner inside. Absent in some test DOMs.
  const running =
    typeof dialog.getAnimations === "function"
      ? dialog
          .getAnimations()
          .filter((animation) => animation.effect?.getComputedTiming().endTime !== Infinity)
      : [];
  // A reopen cancels them, which rejects `finished`; the exit check below handles that.
  await Promise.allSettled(
    running.map(async (animation) => {
      await animation.finished;
    }),
  );
  if (exits.get(dialog) !== exit || dialog.dataset["closing"] === undefined) {
    return;
  }
  delete dialog.dataset["closing"];
  closing.add(dialog);
  dialog.close();
  unlockPageScroll();
}

/** Close at once, without the exit: the element left the document. */
export function closeNow(dialog: HTMLDialogElement): void {
  if (!dialog.open) {
    return;
  }
  delete dialog.dataset["closing"];
  closing.add(dialog);
  dialog.close();
  unlockPageScroll();
}

/** Whether a click landed outside the dialog's box, which is where its `::backdrop` is. */
export function isBackdropClick(dialog: HTMLDialogElement, event: MouseEvent): boolean {
  if (event.composedPath()[0] !== dialog) {
    return false;
  }
  const box = dialog.getBoundingClientRect();
  return (
    event.clientX < box.left ||
    event.clientX > box.right ||
    event.clientY < box.top ||
    event.clientY > box.bottom
  );
}
