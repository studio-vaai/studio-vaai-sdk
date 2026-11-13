import type { FormattedMessage } from "@studio-vaai/core";
import type { TemplateResult } from "lit";

import { html, nothing } from "lit";

type Content = string | TemplateResult;
interface Frame {
  name: string;
  href?: string;
  children: Content[];
}

function safeHref(value: string | undefined): string | undefined {
  if (value === undefined) {
    return;
  }
  try {
    const url = new URL(value, "https://studio-vaai.com");
    return ["https:", "http:", "mailto:"].includes(url.protocol) ? value : undefined;
  } catch {
    return globalThis.undefined;
  }
}

function renderFrame({ name, href, children }: Frame): Content {
  switch (name) {
    case "link": {
      return href === undefined || href === ""
        ? html`${children}`
        : html`<a href=${href}>${children}</a>`;
    }
    case "b":
    case "strong": {
      return html`<strong>${children}</strong>`;
    }
    case "i":
    case "em": {
      return html`<em>${children}</em>`;
    }
    default: {
      return html`${children}`;
    }
  }
}

/** Render MF2 parts as text and an explicit markup vocabulary. No HTML interpretation. */
export function renderMessage(message: FormattedMessage | undefined) {
  if (!message) {
    return nothing;
  }
  const root: Frame = { name: "", children: [] };
  const parents: Frame[] = [];
  let current = root;
  for (const part of message.parts) {
    switch (part.type) {
      case "text":
      case "string":
      case "bidiIsolation": {
        current.children.push(part.value);
        break;
      }
      case "number": {
        current.children.push(part.parts.map((item) => item.value).join(""));
        break;
      }
      case "fallback": {
        current.children.push(`{${part.source}}`);
        break;
      }
      case "markup": {
        if (part.kind === "open") {
          const href = safeHref(part.options.find((option) => option.name === "href")?.value);
          parents.push(current);
          current = { name: part.name, ...(href === undefined ? {} : { href }), children: [] };
        } else if (part.kind === "close" && current.name === part.name) {
          const parent = parents.pop();
          if (parent) {
            parent.children.push(renderFrame(current));
            current = parent;
          }
        } else if (part.kind === "standalone" && part.name === "br") {
          current.children.push(html`<br />`);
        }
        break;
      }
      default: {
        break;
      }
    }
  }
  for (let parent = parents.pop(); parent; parent = parents.pop()) {
    parent.children.push(renderFrame(current));
    current = parent;
  }
  return html`${root.children}`;
}
