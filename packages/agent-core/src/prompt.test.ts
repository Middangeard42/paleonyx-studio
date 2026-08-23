import { describe, expect, it } from "vitest";
import { buildAnswerRequest, buildSystemPrompt, buildUserPrompt } from "./prompt.js";

describe("buildUserPrompt", () => {
  it("lists the project's files so absence is distinguishable from not having looked", () => {
    const prompt = buildUserPrompt("why do tests fail", {}, [
      "src/sum.ts",
      "README.md",
    ]);
    expect(prompt).toContain("README.md");
    expect(prompt).toContain("src/sum.ts");
    expect(prompt).toContain("does not exist here");
  });

  it("omits the listing section entirely when there is nothing to list", () => {
    expect(buildUserPrompt("go", {})).not.toContain("Every file in this project");
  });

  it("caps a large listing and says how many were omitted", () => {
    const many = Array.from({ length: 250 }, (_, i) => `src/file-${i}.ts`);
    const prompt = buildUserPrompt("go", {}, many);
    expect(prompt).toContain("Every file in this project (250)");
    expect(prompt).toContain("50 more not shown");
  });

  it("still includes selected file contents", () => {
    const prompt = buildUserPrompt("go", { "a.ts": "const x = 1;" }, ["a.ts"]);
    expect(prompt).toContain("--- a.ts ---");
    expect(prompt).toContain("const x = 1;");
  });
});

describe("buildSystemPrompt", () => {
  it("keeps the answer schema out, so it cannot crowd out investigating", () => {
    // The schema is long, concrete, and was previously last, which made
    // it the most salient instruction in the prompt.
    const prompt = buildSystemPrompt("bug-fix", "experienced", true);
    expect(prompt).not.toContain('"confidence": "high"');
    expect(buildAnswerRequest()).toContain('"confidence": "high"');
  });

  it("describes tool use only when tools will be offered", () => {
    expect(buildSystemPrompt("bug-fix", "experienced", true)).toContain("call the provided tools");
    expect(buildSystemPrompt("bug-fix", "experienced", false)).not.toContain(
      "call the provided tools"
    );
  });

  it("asks for steps actually taken, not steps that might be taken", () => {
    // "or would take" invited describing intent instead of acting, which
    // is exactly what the model did.
    expect(buildAnswerRequest()).toContain("actually took");
    expect(buildAnswerRequest()).not.toContain("would take");
  });

  it("does not invite the model to discuss the reader", () => {
    const prompt = buildSystemPrompt("explain", "new-to-coding", false);
    expect(prompt).toContain("Never mention the developer");
  });
});
