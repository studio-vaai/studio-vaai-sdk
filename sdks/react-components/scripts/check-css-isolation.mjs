/* oxlint-disable typescript/no-unsafe-member-access, typescript/no-unsafe-argument -- postcss node types are not resolvable for an out-of-tsconfig build script */
// CSS isolation gate for `pnpm build` — fails the build if the shipped
// stylesheet could override anything on a consumer's page.
//
// The SDK stylesheet is loaded globally by consumers, so every rule it ships
// must be incapable of touching host markup. This enforces three invariants
// on the built CSS:
//
//   1. Every style rule is scoped under `#studio-vaai-root` — the wrapper
//      `StudioVaaiUiProvider` mounts. The only exception is a `:root` block,
//      allowed solely to publish `--sv-*` design tokens (a global custom
//      property in the SDK's own namespace cannot collide with host styles).
//   2. Every `@property` registration is `--sv-*` namespaced. `@property`
//      cannot be selector-scoped, so an un-namespaced one (e.g. Tailwind's
//      `--tw-*`) would override the host's own registration.
//   3. Every `@keyframes` is `sv-*` named — animation names are global
//      identifiers and would otherwise shadow a host's keyframes.
//
// Run after the CSS is built (see the `build` script). Exits non-zero with a
// report on any violation.
import { readFileSync } from "node:fs";
import { parse } from "postcss";

const CSS_FILE = "dist/studio-vaai-components.css";
const SCOPE = "#studio-vaai-root";
const VAR_NAMESPACE = "--sv-";
const KEYFRAMES_NAMESPACE = "sv-";

const root = parse(readFileSync(CSS_FILE, "utf8"), { from: CSS_FILE });
const violations = [];
const at = (node) => `${CSS_FILE}:${node.source?.start?.line ?? "?"}`;

const isKeyframeStep = (rule) =>
  rule.parent?.type === "atrule" && /keyframes$/i.test(rule.parent.name);

root.walkRules((rule) => {
  // `from` / `to` / `0%` inside `@keyframes` are steps, not page selectors.
  if (isKeyframeStep(rule)) {
    return;
  }
  for (const selector of rule.selectors) {
    const sel = selector.trim();
    if (sel.startsWith(SCOPE)) {
      continue;
    }
    if (sel === ":root") {
      // A global `:root` block is allowed only to publish `--sv-*` tokens.
      rule.walkDecls((decl) => {
        if (!decl.prop.startsWith(VAR_NAMESPACE)) {
          violations.push(
            `${at(decl)}  :root declares \`${decl.prop}\` — only ${VAR_NAMESPACE}* design tokens may be global`,
          );
        }
      });
      continue;
    }
    violations.push(
      `${at(rule)}  unscoped selector \`${sel}\` — every rule must be under ${SCOPE}`,
    );
  }
});

root.walkAtRules((atRule) => {
  if (atRule.name === "property" && !atRule.params.startsWith(VAR_NAMESPACE)) {
    violations.push(
      `${at(atRule)}  global @property \`${atRule.params}\` — must be ${VAR_NAMESPACE}* namespaced (cannot be scoped)`,
    );
  }
  if (/keyframes$/i.test(atRule.name) && !atRule.params.trim().startsWith(KEYFRAMES_NAMESPACE)) {
    violations.push(
      `${at(atRule)}  global @keyframes \`${atRule.params}\` — name must be ${KEYFRAMES_NAMESPACE}* prefixed`,
    );
  }
});

if (violations.length > 0) {
  const report = violations.map((v) => `  ${v}`).join("\n");
  process.stderr.write(
    `check-css-isolation: ${violations.length} rule(s) could override host styles:\n${report}\n\nThe SDK stylesheet must not touch markup outside ${SCOPE}.\n`,
  );
  process.exitCode = 1;
} else {
  process.stderr.write(`check-css-isolation: ${CSS_FILE} is fully isolated.\n`);
}
