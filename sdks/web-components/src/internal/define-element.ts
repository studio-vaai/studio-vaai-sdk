/**
 * Register a custom element once. A shop can load the SDK twice (a theme script plus an app);
 * a second `customElements.define()` for the same tag would throw, so the first one wins.
 */
export function defineElement(tag: string, element: CustomElementConstructor): void {
  if (customElements.get(tag) === undefined) {
    customElements.define(tag, element);
  }
}
