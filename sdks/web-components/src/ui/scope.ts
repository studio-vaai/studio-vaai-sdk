import type { SvUiContext } from "./context.js";

const scopes = new WeakMap<Node, SvUiContext>();
const scopeListeners = new Set<() => void>();

/** Scope metadata belongs to the registry, including when the root is itself an SDK element. */
export function isUiScopeRoot(node: Node): boolean {
  return scopes.has(node);
}

/** Find the nearest scope, including ancestors outside a component's shadow root. */
export function resolveUiScope(node: Node, fallback: SvUiContext): SvUiContext {
  let ancestor: Node | null = node;
  while (ancestor) {
    const scope = scopes.get(ancestor);
    if (scope) {
      return scope;
    }
    ancestor = ancestor.parentNode ?? (isShadowRoot(ancestor) ? ancestor.host : null);
  }
  return fallback;
}

/** Internal: reconnect consumers when a scope is attached or removed. */
export function observeUiScopes(listener: () => void): () => void {
  scopeListeners.add(listener);
  return () => {
    scopeListeners.delete(listener);
  };
}

/** Attach a context to an existing root, restoring the outer scope on cleanup. */
export function attachUiScope(root: Node, context: SvUiContext): () => void {
  if (scopes.has(root)) {
    throw new Error("A UI context is already attached to this root.");
  }
  scopes.set(root, context);
  const element = isElement(root) ? root : undefined;
  const previous = new Map(
    ["lang", "data-sv-appearance"].map((name) => [name, element?.getAttribute(name)]),
  );
  const applied = new Map<string, string>();
  const updateRoot = () => {
    applied.set("lang", context.snapshot.resolvedLocale ?? context.snapshot.locale);
    applied.set("data-sv-appearance", context.snapshot.appearance);
    for (const [name, value] of applied) {
      element?.setAttribute(name, value);
    }
  };
  const unsubscribe = context.subscribe(updateRoot);
  updateRoot();
  for (const listener of scopeListeners) {
    listener();
  }
  return () => {
    if (scopes.get(root) !== context) {
      return;
    }
    scopes.delete(root);
    unsubscribe();
    for (const [name, value] of applied) {
      if (element?.getAttribute(name) === value) {
        const original = previous.get(name);
        if (original === null || original === undefined) {
          element.removeAttribute(name);
        } else {
          element.setAttribute(name, original);
        }
      }
    }
    for (const listener of scopeListeners) {
      listener();
    }
  };
}

function isElement(node: Node): node is Element {
  return node.nodeType === 1;
}
function isShadowRoot(node: Node): node is ShadowRoot {
  return node.nodeType === 11 && "host" in node;
}
