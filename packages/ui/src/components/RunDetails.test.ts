import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ModelReply } from "@paleonyx/shared-types";
import { RunDetails } from "./RunDetails.js";

function render(replies: ModelReply[]): string {
  return renderToStaticMarkup(createElement(RunDetails, { replies }));
}

const reply: ModelReply = {
  label: "Answer",
  content: '{"summary": "the secret marker"}',
  finishReason: "stop",
  promptTokens: 1200,
  completionTokens: 340,
};

describe("RunDetails", () => {
  it("shows nothing when the model sent no reply", () => {
    expect(render([])).toBe("");
  });

  it("is collapsed by default: the header shows, the reply does not", () => {
    const html = render([reply]);
    expect(html).toContain("Details");
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain("the secret marker");
  });

  it("says how many replies it holds, so a retry is visible before opening", () => {
    const html = render([reply, { ...reply, label: "Second try" }]);
    expect(html).toContain("2 replies");
  });
});
