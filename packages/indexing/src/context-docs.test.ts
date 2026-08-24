import { describe, expect, it } from "vitest";
import type { FileSystemReader, ProjectFile } from "@paleonyx/shared-types";
import { findContextDocuments } from "./context-docs.js";

class FakeFs implements FileSystemReader {
  constructor(private readonly files: Record<string, string>) {}
  async listFiles(): Promise<ProjectFile[]> {
    return Object.keys(this.files).map((path) => ({ path }));
  }
  async readFile(path: string): Promise<string> {
    const content = this.files[path];
    if (content === undefined) throw new Error(`missing ${path}`);
    return content;
  }
}

describe("findContextDocuments", () => {
  it("finds a project's conventions file", async () => {
    const docs = await findContextDocuments(
      new FakeFs({ "AGENTS.md": "Use tabs.", "src/a.ts": "x" })
    );
    expect(docs.map((d) => d.path)).toEqual(["AGENTS.md"]);
    expect(docs[0]?.content).toBe("Use tabs.");
  });

  it("prefers instruction files over a README", async () => {
    // A README describes the project to people; AGENTS.md is written to
    // instruct an assistant, so it leads.
    const docs = await findContextDocuments(
      new FakeFs({ "README.md": "About.", "AGENTS.md": "Rules." })
    );
    expect(docs[0]?.path).toBe("AGENTS.md");
  });

  it("matches regardless of filename case", async () => {
    const docs = await findContextDocuments(new FakeFs({ "Claude.md": "Rules." }));
    expect(docs.map((d) => d.path)).toEqual(["Claude.md"]);
  });

  it("ignores conventions files nested inside the project", async () => {
    // A CLAUDE.md in a subdirectory governs that subtree, not the whole
    // project; treating it as global guidance would misapply it.
    const docs = await findContextDocuments(
      new FakeFs({ "packages/ui/CLAUDE.md": "UI only." })
    );
    expect(docs).toHaveLength(0);
  });

  it("returns nothing when a project documents no conventions", async () => {
    expect(await findContextDocuments(new FakeFs({ "src/a.ts": "x" }))).toHaveLength(0);
  });

  it("truncates a long document rather than dropping it", async () => {
    // The opening of a conventions file is where the conventions are, so
    // a partial read beats none.
    const docs = await findContextDocuments(new FakeFs({ "AGENTS.md": "x".repeat(50_000) }));
    expect(docs).toHaveLength(1);
    expect(docs[0]?.truncated).toBe(true);
    expect(docs[0]?.content.length).toBeLessThan(7_000);
  });

  it("keeps the whole set within budget", async () => {
    const big = "y".repeat(20_000);
    const docs = await findContextDocuments(
      new FakeFs({ "AGENTS.md": big, "CLAUDE.md": big, "README.md": big })
    );
    const total = docs.reduce((sum, doc) => sum + doc.content.length, 0);
    expect(total).toBeLessThanOrEqual(13_000);
  });

  it("skips a listed file that will not read", async () => {
    const fs: FileSystemReader = {
      async listFiles() {
        return [{ path: "AGENTS.md" }];
      },
      async readFile() {
        throw new Error("permission denied");
      },
    };
    expect(await findContextDocuments(fs)).toHaveLength(0);
  });
});
