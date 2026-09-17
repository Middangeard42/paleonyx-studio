import { describe, expect, it } from "vitest";
import type { FileSystemReader, ProjectFile } from "@paleonyx/shared-types";
import { SKILL_TASK_TYPES } from "@paleonyx/shared-types";
import {
  BUILTIN_SKILLS,
  MAX_PROJECT_SKILLS,
  formatSkill,
  isProjectSkillPath,
  loadSkills,
  nameFromTitle,
  parseSkill,
  projectSkillPath,
} from "./index.js";

const VALID = `---
name: tidy-imports
title: Tidy the imports
description: Sorts and groups import lines.
task: refactor
---
Sort the import lines and group them by source.`;

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

describe("parseSkill", () => {
  it("reads a well-formed skill", () => {
    const result = parseSkill(VALID, "project", ".paleonyx/skills/tidy.md");
    expect(result).toEqual({
      ok: true,
      skill: {
        id: "project:tidy-imports",
        name: "tidy-imports",
        title: "Tidy the imports",
        description: "Sorts and groups import lines.",
        taskType: "refactor",
        instructions: "Sort the import lines and group them by source.",
        source: "project",
        path: ".paleonyx/skills/tidy.md",
      },
    });
  });

  it("accepts Windows line endings", () => {
    const result = parseSkill(VALID.replace(/\n/g, "\r\n"), "project");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.skill.instructions).not.toContain("\r");
  });

  it("derives a title from the name when none is given", () => {
    const result = parseSkill(VALID.replace("title: Tidy the imports\n", ""), "project");
    expect(result.ok && result.skill.title).toBe("Tidy imports");
  });

  it("strips quotes around a value", () => {
    const result = parseSkill(VALID.replace("Tidy the imports", '"Tidy: the imports"'), "project");
    expect(result.ok && result.skill.title).toBe("Tidy: the imports");
  });

  /**
   * The boundary that matters. A project skill comes from the repository,
   * often someone else's, so it must not be able to change what the agent
   * may do — and an author who tries deserves to be told, not ignored.
   */
  it.each([
    ["permission: can-run-commands"],
    ["allowlist: rm -rf"],
    ["budget: 999"],
    ["files: src/**"],
  ])("refuses a skill that tries to set %s", (line) => {
    const result = parseSkill(VALID.replace("task: refactor", `task: refactor\n${line}`), "project");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/cannot change what the agent is allowed to do/);
      expect(result.error).toContain(line.split(":")[0]!);
    }
  });

  it("refuses the task types a template cannot carry, and says where they live", () => {
    for (const task of ["scaffold", "design-change"]) {
      const result = parseSkill(VALID.replace("task: refactor", `task: ${task}`), "project");
      expect(result.ok, task).toBe(false);
      if (!result.ok) expect(result.error).toMatch(/wizard or the preview/);
    }
  });

  it("names the valid task types when given an unknown one", () => {
    const result = parseSkill(VALID.replace("task: refactor", "task: deploy"), "project");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      for (const type of SKILL_TASK_TYPES) expect(result.error).toContain(type);
    }
  });

  it.each([
    ["no header", "Just some text."],
    ["an unclosed header", "---\nname: x\ntask: explain\nbody"],
    ["a missing name", VALID.replace("name: tidy-imports\n", "")],
    ["an invalid name", VALID.replace("tidy-imports", "Tidy Imports")],
    ["a missing task", VALID.replace("task: refactor\n", "")],
    ["no instructions", VALID.split("---").slice(0, 2).join("---") + "---\n   \n"],
    ["a duplicated field", VALID.replace("task: refactor", "task: refactor\ntask: explain")],
    ["a line that is not key: value", VALID.replace("task: refactor", "task: refactor\njust words")],
  ])("refuses a skill with %s", (_label, text) => {
    expect(parseSkill(text, "project").ok).toBe(false);
  });

  // A stray large file must not be able to fill the prompt.
  it("refuses a file too large to be a template", () => {
    const huge = VALID + "\n" + "x".repeat(20_000);
    const result = parseSkill(huge, "project");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/KB/);
  });

  it("explains every refusal in a sentence about the file", () => {
    const result = parseSkill("nope", "project");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/^This skill file /);
  });
});

describe("formatSkill", () => {
  it("writes a skill that reads back identically", () => {
    const original = {
      name: "explain-errors",
      title: "Explain: error handling",
      description: "How failures travel # through the code",
      taskType: "explain" as const,
      instructions: "Explain how errors are handled.\n\nBe specific.",
    };
    const parsed = parseSkill(formatSkill(original), "project");
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.skill).toMatchObject(original);
    }
  });

  it("omits an empty description", () => {
    const text = formatSkill({
      name: "x",
      title: "X",
      taskType: "explain",
      instructions: "Do it.",
    });
    expect(text).not.toContain("description:");
  });
});

describe("nameFromTitle", () => {
  it.each([
    ["Tidy the imports", "tidy-the-imports"],
    ["  Explain: data flow!  ", "explain-data-flow"],
    ["Résumé parser", "resume-parser"],
    ["???", "skill"],
  ])("turns %j into %j", (title, name) => {
    expect(nameFromTitle(title)).toBe(name);
  });

  it("always produces a name the parser accepts", () => {
    for (const title of ["A".repeat(200), "-leading", "trailing-", "x"]) {
      const name = nameFromTitle(title);
      const parsed = parseSkill(
        formatSkill({ name, title: "T", taskType: "explain", instructions: "go" }),
        "project"
      );
      expect(parsed.ok, `${title} -> ${name}`).toBe(true);
    }
  });
});

describe("BUILTIN_SKILLS", () => {
  it("covers every task type a skill may use", () => {
    const types = new Set(BUILTIN_SKILLS.map((skill) => skill.taskType));
    for (const type of SKILL_TASK_TYPES) expect(types.has(type), type).toBe(true);
  });

  it("are labelled as built in and uniquely named", () => {
    const ids = BUILTIN_SKILLS.map((skill) => skill.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const skill of BUILTIN_SKILLS) {
      expect(skill.source).toBe("builtin");
      expect(skill.id).toBe(`builtin:${skill.name}`);
    }
  });
});

describe("loadSkills", () => {
  it("returns the built-ins for a project with no skills of its own", async () => {
    const loaded = await loadSkills(new FakeFs({ "src/a.ts": "" }));
    expect(loaded.skills).toEqual(BUILTIN_SKILLS);
    expect(loaded.problems).toEqual([]);
  });

  it("adds the project's skills after the built-ins", async () => {
    const loaded = await loadSkills(
      new FakeFs({ ".paleonyx/skills/tidy.md": VALID, "src/a.ts": "" })
    );
    expect(loaded.skills.slice(0, BUILTIN_SKILLS.length)).toEqual(BUILTIN_SKILLS);
    expect(loaded.skills.at(-1)?.id).toBe("project:tidy-imports");
    expect(loaded.skills.at(-1)?.path).toBe(".paleonyx/skills/tidy.md");
  });

  // A repository quietly redefining a built-in is a substitution nobody
  // would think to check, so both stay visible, labelled.
  it("never lets a project skill replace a built-in of the same name", async () => {
    const shadow = VALID.replace("tidy-imports", "find-bugs").replace("task: refactor", "task: explain");
    const loaded = await loadSkills(new FakeFs({ ".paleonyx/skills/find-bugs.md": shadow }));
    const named = loaded.skills.filter((skill) => skill.name === "find-bugs");
    expect(named.map((skill) => skill.id).sort()).toEqual(["builtin:find-bugs", "project:find-bugs"]);
    const builtin = named.find((skill) => skill.source === "builtin");
    expect(builtin?.taskType).toBe("bug-fix");
  });

  it("reports a broken skill instead of dropping it silently", async () => {
    const loaded = await loadSkills(
      new FakeFs({
        ".paleonyx/skills/good.md": VALID,
        ".paleonyx/skills/bad.md": "---\nname: bad\npermission: all\n---\nhi",
      })
    );
    expect(loaded.skills.some((skill) => skill.name === "tidy-imports")).toBe(true);
    expect(loaded.problems).toHaveLength(1);
    expect(loaded.problems[0]?.path).toBe(".paleonyx/skills/bad.md");
  });

  it("reports the second of two skills with the same name", async () => {
    const loaded = await loadSkills(
      new FakeFs({
        ".paleonyx/skills/a.md": VALID,
        ".paleonyx/skills/b.md": VALID,
      })
    );
    expect(loaded.skills.filter((skill) => skill.name === "tidy-imports")).toHaveLength(1);
    expect(loaded.problems[0]?.error).toMatch(/already uses/);
    expect(loaded.problems[0]?.error).toContain(".paleonyx/skills/a.md");
  });

  it("reports a file that will not read", async () => {
    const fs = new FakeFs({ ".paleonyx/skills/gone.md": VALID });
    fs.readFile = async () => {
      throw new Error("permission denied");
    };
    const loaded = await loadSkills(fs);
    expect(loaded.problems[0]?.error).toMatch(/permission denied/);
  });

  it("keeps the built-ins when the project cannot be listed", async () => {
    const fs = new FakeFs({});
    fs.listFiles = async () => {
      throw new Error("no project open");
    };
    const loaded = await loadSkills(fs);
    expect(loaded.skills).toEqual(BUILTIN_SKILLS);
    expect(loaded.problems).toHaveLength(1);
  });

  it("stops at a sensible number of project skills and says so", async () => {
    const files: Record<string, string> = {};
    for (let i = 0; i < MAX_PROJECT_SKILLS + 5; i += 1) {
      const name = `skill-${String(i).padStart(3, "0")}`;
      files[`.paleonyx/skills/${name}.md`] = VALID.replace("tidy-imports", name);
    }
    const loaded = await loadSkills(new FakeFs(files));
    expect(loaded.skills).toHaveLength(BUILTIN_SKILLS.length + MAX_PROJECT_SKILLS);
    expect(loaded.problems[0]?.error).toMatch(/only the first/);
  });
});

describe("isProjectSkillPath", () => {
  it.each([
    [".paleonyx/skills/tidy.md", true],
    [".paleonyx/skills/Tidy.MD", true],
    [".paleonyx/skills/nested/tidy.md", false],
    [".paleonyx/skills/tidy.txt", false],
    [".paleonyx/skills/.md", false],
    ["skills/tidy.md", false],
    [".paleonyx/context.md", false],
  ])("%s -> %s", (path, expected) => {
    expect(isProjectSkillPath(path)).toBe(expected);
  });

  it("agrees with where new skills are saved", () => {
    expect(isProjectSkillPath(projectSkillPath("tidy-imports"))).toBe(true);
  });
});
