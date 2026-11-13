// @vitest-environment node

import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ImageView } from "../src/ui/image-view.js";
import { VStack } from "../src/ui/v-stack.js";

describe("primitives SSR", () => {
  it("VStack renders static HTML", () => {
    const html = renderToString(
      <VStack gap="sm">
        <span>a</span>
        <span>b</span>
      </VStack>,
    );
    expect(html).toContain("sv:flex");
    expect(html).toContain("a");
  });

  it("ImageView renders img", () => {
    const html = renderToString(<ImageView src="https://example.com/x.png" alt="x" />);
    expect(html).toContain('src="https://example.com/x.png"');
  });
});
