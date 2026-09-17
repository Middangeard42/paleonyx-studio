import type { Skill } from "@paleonyx/shared-types";
import { parseSkill } from "./parse.js";

/**
 * Skills that ship with the app.
 *
 * Written as skill files and run through the same parser as a project's
 * own, so the built-ins cannot drift from the format users are told to
 * follow — if one of these stopped parsing, the test suite would say so
 * before anyone else did.
 *
 * They cover every task type, and each names a job people repeat rather
 * than restating what the skill level already does: depth of explanation
 * adapts on its own, so there is no "explain it simply" skill here.
 */
const SOURCES = [
  `---
name: find-bugs
title: Look for bugs
description: Checks the selected code for common mistakes and fixes the most serious one.
task: bug-fix
---
Read the selected code and look for bugs: off-by-one errors, values that can be null or undefined when used, errors that are caught and ignored, and conditions that test the wrong thing.

Fix the single most serious bug you find. List any others you noticed in the explanation without changing them, so each can be reviewed on its own.`,

  `---
name: explain-data-flow
title: Explain how data moves
description: Traces where values come in, how they change, and where they go.
task: explain
---
Explain how data moves through the selected code: where it comes in, how it is checked and transformed along the way, and where it ends up. Point out any place a value could be missing or wrong by the time it is used.`,

  `---
name: security-review
title: Review for security problems
description: Reads the code for common vulnerabilities without changing anything.
task: explain
---
Review the selected code for security problems. Look for untrusted input reaching a file path, a shell command, a database query, or HTML; secrets written into the code; and checks that can be skipped.

For each problem, say where it is, how it could be exploited, and how to fix it. If you find none, say what you checked.`,

  `---
name: simplify
title: Simplify this code
description: Makes the code easier to read without changing what it does.
task: refactor
---
Simplify the selected code without changing its behaviour. Remove duplication, flatten deep nesting, and give unclear names clearer ones. Keep the public interface exactly as it is.`,

  `---
name: edge-case-tests
title: Test the edge cases
description: Adds tests for empty input, boundaries, and the error path.
task: write-tests
---
Write tests for the selected code that cover its edge cases: empty input, the smallest and largest values it accepts, input it should reject, and what happens when something it depends on fails.`,

  `---
name: document-public-api
title: Document what this file exports
description: Explains each exported function, class, and type.
task: document
---
Document every function, class, and type the selected files export: what it is for, what each parameter means, what it returns, and what can go wrong when calling it.`,
];

function load(): Skill[] {
  return SOURCES.map((text) => {
    const parsed = parseSkill(text, "builtin");
    if (!parsed.ok) {
      // A built-in that does not parse is a bug in this file, not a user
      // problem to report, so it fails loudly at startup.
      throw new Error(`Built-in skill is invalid: ${parsed.error}`);
    }
    return parsed.skill;
  });
}

export const BUILTIN_SKILLS: readonly Skill[] = load();
