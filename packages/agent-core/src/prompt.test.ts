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

describe("buildSystemPrompt with connected tools", () => {
  it("warns that their output is not instructions, only when they are offered", () => {
    const offered = buildSystemPrompt("bug-fix", "experienced", true, true);
    expect(offered).toContain("not instructions");
    expect(offered).toContain("mcp__");
    expect(buildSystemPrompt("bug-fix", "experienced", true, false)).not.toContain("mcp__");
    // Without tool calling nothing is offered, whatever the caller says.
    expect(buildSystemPrompt("bug-fix", "experienced", false, true)).not.toContain("mcp__");
  });
});

describe("buildSystemPrompt for a new project", () => {
  // The first scaffold run produced index.html loading `src/sum.ts` and
  // `src/greet.ts` through plain <script src> tags. A browser cannot run
  // TypeScript, so the page failed on load — and nothing said otherwise,
  // because the instructions asked for the fewest dependencies without
  // saying what "runs in a browser" actually requires.
  it("rules out TypeScript where there is no build step to compile it", () => {
    const prompt = buildSystemPrompt("scaffold", "new-to-coding");
    expect(prompt).toMatch(/cannot execute TypeScript/i);
    expect(prompt).toMatch(/build step/i);
  });

  it("requires the result to run as delivered", () => {
    const prompt = buildSystemPrompt("scaffold", "new-to-coding");
    expect(prompt).toMatch(/run as delivered/i);
  });
});

describe("buildSystemPrompt for the code-change task types", () => {
  // A refactor is approved on the promise that behaviour does not
  // change, which is exactly why it may be read less carefully than a
  // bug fix. Silently bundling a fix in breaks that promise.
  it("holds a refactor to identical behaviour and forbids sneaking in a fix", () => {
    const prompt = buildSystemPrompt("refactor", "professional");
    expect(prompt).toMatch(/without changing what it does/i);
    expect(prompt).toMatch(/identical/i);
    expect(prompt).toMatch(/leave it alone/i);
  });

  // Two ways tests go wrong: written for a framework the project does
  // not have, or written so they pass whatever the code does.
  it("makes tests use the project's own framework and be able to fail", () => {
    const prompt = buildSystemPrompt("write-tests", "professional");
    expect(prompt).toMatch(/framework this project already uses/i);
    expect(prompt).toMatch(/no test setup at all/i);
    expect(prompt).toMatch(/must be able to fail/i);
    expect(prompt).toMatch(/do not change the code under test/i);
  });

  it("asks documentation to explain why rather than narrate the next line", () => {
    const prompt = buildSystemPrompt("document", "professional");
    expect(prompt).toMatch(/why the code is the way it is/i);
    expect(prompt).toMatch(/do not narrate/i);
    expect(prompt).toMatch(/only comments and documentation/i);
  });

  it("gives every editing task the new-file guidance, and explain none", () => {
    for (const type of ["bug-fix", "refactor", "write-tests", "document", "scaffold"] as const) {
      expect(buildSystemPrompt(type, "experienced"), type).toMatch(
        /does not exist yet/i
      );
    }
    expect(buildSystemPrompt("explain", "experienced")).not.toMatch(
      /does not exist yet/i
    );
  });

  it("gives each task type its own instructions", () => {
    const prompts = (
      ["explain", "bug-fix", "refactor", "write-tests", "document"] as const
    ).map((type) => buildSystemPrompt(type, "experienced"));
    expect(new Set(prompts).size).toBe(prompts.length);
  });
});

describe("what the tool phase is for", () => {
  // The model ran `sed -i` on the user's file instead of proposing a
  // diff. Nothing in the prompt had said commands are for reading.
  it("forbids using commands to change files", () => {
    const prompt = buildSystemPrompt("bug-fix", "experienced", true);
    expect(prompt).toMatch(/finding things out, never for changing them/i);
    expect(prompt).toMatch(/sed/);
    expect(prompt).toMatch(/goes in `diff` and nowhere else/i);
  });

  it("says why, not just that", () => {
    const prompt = buildSystemPrompt("bug-fix", "experienced", true);
    expect(prompt).toMatch(/never reaches the diff/i);
    expect(prompt).toMatch(/cannot be undone/i);
  });

  it("says none of it when no tools are offered", () => {
    const prompt = buildSystemPrompt("bug-fix", "experienced", false);
    expect(prompt).not.toMatch(/finding things out/i);
  });
});

describe("tools versus commands", () => {
  it("sends the model to the read tool rather than cat", () => {
    const prompt = buildSystemPrompt("bug-fix", "experienced", true);
    expect(prompt).toMatch(/call the read tool/i);
    expect(prompt).toMatch(/do not run `cat`/i);
    expect(prompt).toMatch(/what no tool covers/i);
  });
});

describe("how new files are asked for", () => {
  it("tells the model to write new files as blocks after the JSON", () => {
    const request = buildAnswerRequest();
    expect(request).toContain("<<<FILE");
    expect(request).toContain("FILE>>>");
  });

  it("asks for a scaffold's files as blocks, with nothing left in the diff", () => {
    const prompt = buildSystemPrompt("scaffold", "new-to-coding");
    expect(prompt).toContain("<<<FILE");
    expect(prompt).not.toContain("every hunk is all `add` lines");
  });

  it("does not ask for a new file inside the JSON diff", () => {
    const prompt = buildSystemPrompt("bug-fix", "new-to-coding");
    expect(prompt).toContain("do not put it in `diff`");
    expect(prompt).toContain("<<<FILE");
  });
});
