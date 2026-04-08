import { describe, expect, it } from "vitest";
import { buildServiceProfileContext } from "../src/runtime/service-profile.js";

describe("service-profile", () => {
  it("renders a prompt block with known service endpoints", () => {
    const result = buildServiceProfileContext({
      apiBaseUrl: "https://api.shellraining.xyz",
      crawlUrl: "https://crawl.shellraining.xyz",
      vikunjaUrl: "https://todo.shellraining.xyz",
    });

    expect(result).toContain("api.shellraining.xyz");
    expect(result).toContain("crawl.shellraining.xyz");
    expect(result).toContain("todo.shellraining.xyz");
  });
});
