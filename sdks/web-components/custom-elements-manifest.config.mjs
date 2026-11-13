/**
 * Custom Elements Manifest (`dist/custom-elements.json`): every `sv-*` element's properties,
 * attributes, events, slots and CSS parts, read from the source and its JSDoc. Editors and the
 * docs read it; `cem analyze` writes it during the build.
 *
 * The analyzer's Lit support finds the properties, `@fires`, `@slot` and `@csspart`. The plugins
 * below fill in what our way of writing elements hides from it:
 * - tags: elements use `defineElement("sv-x", SvX)` at their registration entry point;
 * - descriptions: a property's docs live on the element's `Sv*Props` interface (which the class
 *   implements), not on its `declare` field;
 * - types: `SvButtonVariant` and friends are spelled out as their values (`"primary" |
 *   "secondary"`), and the `| undefined` of optional properties is dropped;
 * - events: typed from our `HTMLElementEventMap` entries, their detail spelled out;
 * - API only: private (`#x`), internal (`_x`) and static members are left out.
 */

import { create, ts } from "@custom-elements-manifest/analyzer";
import { litPlugin } from "@custom-elements-manifest/analyzer/src/features/framework-plugins/lit/lit.js";
import { globSync, readFileSync } from "node:fs";
import path from "node:path";

/** @typedef {import("@custom-elements-manifest/analyzer").Plugin} Plugin */

const GLOBS = [
  "src/components/**/*.ts",
  "src/experience/index.ts",
  "src/experience/sv-try-on-experience.ts",
  "src/screens/**/*.ts",
  "src/media/**/*.ts",
  "src/events.ts",
  "src/register.ts",
];
const ROOT = import.meta.dirname;

/** The JSDoc text of a node, with soft line breaks joined; list items keep their own lines. */
function jsDocText(ts, node) {
  const docs = node.jsDoc ?? [];
  const text = docs
    .map((doc) => ts.getTextOfJSDocComment(doc.comment) ?? "")
    .join("\n\n")
    .trim();
  return text.replaceAll(/\n(?!\n|\s*- )/gu, " ").replaceAll(/ {2,}/gu, " ");
}

/** `["a", "b"] as const` → `"a" | "b"`; `{ a: …, "b-c": … }` → `"a" | "b-c"`. */
function literalUnion(ts, initializer) {
  let expression = initializer;
  while (ts.isAsExpression(expression) || ts.isSatisfiesExpression(expression)) {
    ({ expression } = expression);
  }
  if (ts.isArrayLiteralExpression(expression)) {
    const values = expression.elements.filter((element) => ts.isStringLiteral(element));
    return values.map((value) => JSON.stringify(value.text)).join(" | ");
  }
  if (ts.isObjectLiteralExpression(expression)) {
    return expression.properties
      .map((property) => property.name)
      .filter((name) => name && (ts.isIdentifier(name) || ts.isStringLiteral(name)))
      .map((name) => JSON.stringify(name.text))
      .join(" | ");
  }
  return "";
}

/** The element's public API: no private (`#x`), protected, internal (`_x`) or static members. */
function isApi(member) {
  return (
    member.privacy !== "private" &&
    member.privacy !== "protected" &&
    !member.static &&
    !member.name.startsWith("_") &&
    !member.name.startsWith("#")
  );
}

/** @returns {Plugin} */
function svElementsPlugin() {
  /** `SvButton` → `sv-button`, from its registration entry point. */
  const tags = new Map();
  /** `SvButtonProps` → { variant: "…" }. */
  const interfaceDocs = new Map();
  /** `SvButton` → ["SvButtonProps"]. */
  const implemented = new Map();
  /** `SV_BUTTON_VARIANTS` → `"primary" | "secondary"`. */
  const constants = new Map();
  /** `SvButtonVariant` → its type's source text, resolved in the link phase. */
  const aliases = new Map();
  /** `SvToggleDetail` → `{ open: boolean }`. */
  const shapes = new Map();
  /** `sv-toggle` → `CustomEvent<SvToggleDetail>`, from `HTMLElementEventMap`. */
  const eventTypes = new Map();

  return {
    name: "sv-elements",
    analyzePhase({ ts, node }) {
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === "defineElement"
      ) {
        const [tag, element] = node.arguments;
        if (tag && element && ts.isStringLiteral(tag) && ts.isIdentifier(element)) {
          tags.set(element.text, tag.text);
        }
      }
      if (ts.isInterfaceDeclaration(node) && node.name.text === "HTMLElementEventMap") {
        for (const member of node.members) {
          if (member.name && ts.isStringLiteral(member.name) && member.type) {
            eventTypes.set(member.name.text, member.type.getText());
          }
        }
      } else if (ts.isInterfaceDeclaration(node)) {
        const docs = {};
        const fields = [];
        for (const member of node.members) {
          if (member.name && ts.isIdentifier(member.name)) {
            docs[member.name.text] = jsDocText(ts, member);
            if (ts.isPropertySignature(member) && member.type) {
              const optional = member.questionToken ? "?" : "";
              const type = member.type.getText().replaceAll(/\s+/gu, " ");
              fields.push(`${member.name.text}${optional}: ${type}`);
            }
          }
        }
        interfaceDocs.set(node.name.text, docs);
        shapes.set(node.name.text, `{ ${fields.join("; ")} }`);
      }
      if (ts.isClassDeclaration(node) && node.name) {
        const names = (node.heritageClauses ?? [])
          .filter((clause) => clause.token === ts.SyntaxKind.ImplementsKeyword)
          .flatMap((clause) => clause.types.map((type) => type.expression.getText()));
        implemented.set(node.name.text, names);
      }
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
        const union = literalUnion(ts, node.initializer);
        if (union) {
          constants.set(node.name.text, union);
        }
      }
      if (ts.isTypeAliasDeclaration(node)) {
        aliases.set(node.name.text, node.type.getText());
      }
    },
    packageLinkPhase({ customElementsManifest }) {
      const resolveAlias = (text) => {
        const indexed = /^\(typeof (\w+)\)\[number\]$/u.exec(text);
        if (indexed) {
          return constants.get(indexed[1]) ?? text;
        }
        const keys = /^keyof typeof (\w+)$/u.exec(text);
        if (keys) {
          return constants.get(keys[1]) ?? text;
        }
        return text;
      };
      const expandType = (text, includeUndefined = false) =>
        text
          .split("|")
          .map((part) => part.trim())
          .filter((part) => (includeUndefined || part !== "undefined") && part !== "")
          .map((part) => (aliases.has(part) ? resolveAlias(aliases.get(part)) : part))
          .join(" | ");
      /** `CustomEvent<SvToggleDetail>` → `CustomEvent<{ open: boolean }>`. */
      const expandEvent = (text) =>
        text.replace(/<(\w+)>$/u, (whole, name) => {
          const shape = shapes.get(name) ?? aliases.get(name);
          if (!shape) {
            return whole;
          }
          const inline = shape
            .replaceAll(/\s+/gu, " ")
            .trim()
            .replace(/^\|\s*/u, "");
          return `<${inline.replaceAll(/: (.+?)(?=; | \})/gu, (_, type) => `: ${expandType(type, true)}`)}>`;
        });
      for (const module of customElementsManifest.modules) {
        for (const declaration of module.declarations ?? []) {
          const tag = tags.get(declaration.name);
          if (declaration.kind !== "class" || !tag) {
            continue;
          }
          declaration.tagName = tag;
          declaration.customElement = true;
          declaration.members = (declaration.members ?? []).filter((member) => isApi(member));
          declaration.attributes = (declaration.attributes ?? []).filter(
            (attribute) => !attribute.fieldName?.startsWith("_"),
          );
          for (const event of declaration.events ?? []) {
            const type = eventTypes.get(event.name);
            if (type) {
              event.type = { text: expandEvent(type) };
            }
          }
          const docs = Object.assign(
            {},
            ...(implemented.get(declaration.name) ?? []).map((name) => interfaceDocs.get(name)),
          );
          for (const item of [...(declaration.members ?? []), ...(declaration.attributes ?? [])]) {
            const name = item.fieldName ?? item.name;
            // A field's "Unset renders `md`." is the value it behaves as: the default.
            const unset = /^Unset renders `([^`]+)`\.$/u.exec(item.description ?? "");
            if (unset) {
              item.default = JSON.stringify(unset[1]);
              delete item.description;
            }
            const fromInterface = docs[name];
            if (fromInterface) {
              item.description = item.description
                ? `${fromInterface}\n\n${item.description}`
                : fromInterface;
            }
            if (item.type?.text) {
              item.type.text = expandType(item.type.text);
            }
            if (item.default === "undefined") {
              delete item.default;
            }
          }
        }
      }
    },
  };
}

const config = {
  globs: GLOBS,
  outdir: "dist",
  litelement: true,
  packagejson: false,
  plugins: [svElementsPlugin()],
};

export default config;

/**
 * The same manifest in memory, for the docs: they render it live from the source. Returns the
 * manifest and the files it read, so a dev server can watch them.
 */
function analyzeSvElements() {
  const files = GLOBS.flatMap((glob) => globSync(glob, { cwd: ROOT })).toSorted((left, right) =>
    left.localeCompare(right),
  );
  const modules = files.map((file) =>
    ts.createSourceFile(
      file,
      readFileSync(path.join(ROOT, file), "utf8"),
      ts.ScriptTarget.ES2015,
      true,
    ),
  );
  const manifest = create({ modules, plugins: [...litPlugin(), svElementsPlugin()] });
  return { manifest, files: files.map((file) => path.join(ROOT, file)) };
}

export { analyzeSvElements };
