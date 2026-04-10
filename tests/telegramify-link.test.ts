import { describe, expect, it } from "vitest";
import { parseMarkdown } from "chat";
import { renderTelegramRichText } from "telegramify";

describe("telegramify local link", () => {
  it("renders markdown tables as preformatted text in shellRaining", () => {
    const ast = parseMarkdown("| # | Title |\n|---|---|\n| 1 | alpha |\n");
    const result = renderTelegramRichText(ast);

    expect(result.entities).toEqual([
      {
        type: "pre",
        offset: 0,
        length: result.text.length,
        language: undefined,
      },
    ]);
    expect(result.text).toContain("Title");
    expect(result.text).toContain("alpha");
  });
});
