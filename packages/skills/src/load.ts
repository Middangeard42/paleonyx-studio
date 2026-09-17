import type { FileSystemReader, Skill, SkillProblem } from "@paleonyx/shared-types";
import { BUILTIN_SKILLS } from "./builtin.js";
import { parseSkill } from "./parse.js";

/**
 * Where a project keeps its own skills.
 *
 * Inside the repository, so a team shares them the way it shares
 * anything else — by committing them — without a marketplace, which v1
 * leaves out (PRD.md §5).
 */
export const PROJECT_SKILLS_DIR = ".paleonyx/skills/";

/** More than anyone would curate by hand; enough to stop a runaway folder. */
export const MAX_PROJECT_SKILLS = 100;

export interface LoadedSkills {
  skills: Skill[];
  /** Files that exist but could not be used, so an author can fix them. */
  problems: SkillProblem[];
}

/**
 * Every skill available in a project: the built-ins, then the project's.
 *
 * A project skill never replaces a built-in, even with the same name.
 * Both are listed, labelled by where they came from, because a
 * repository quietly redefining "Look for bugs" is exactly the kind of
 * substitution a user would not think to check.
 *
 * Files that fail to parse are reported rather than skipped silently:
 * someone wrote them expecting them to appear.
 */
export async function loadSkills(fs: FileSystemReader): Promise<LoadedSkills> {
  const problems: SkillProblem[] = [];
  const project: Skill[] = [];

  let files: string[];
  try {
    files = (await fs.listFiles())
      .map((file) => file.path.replace(/\\/g, "/"))
      .filter(isProjectSkillPath)
      .sort();
  } catch (error) {
    // A project that cannot be listed still has the built-ins.
    return {
      skills: [...BUILTIN_SKILLS],
      problems: [{ path: PROJECT_SKILLS_DIR, error: `Could not list project skills: ${(error as Error).message}` }],
    };
  }

  if (files.length > MAX_PROJECT_SKILLS) {
    problems.push({
      path: PROJECT_SKILLS_DIR,
      error: `There are ${files.length} skill files; only the first ${MAX_PROJECT_SKILLS} are loaded.`,
    });
    files = files.slice(0, MAX_PROJECT_SKILLS);
  }

  const seen = new Map<string, string>();
  for (const path of files) {
    let text: string;
    try {
      text = await fs.readFile(path);
    } catch (error) {
      problems.push({ path, error: `Could not be read: ${(error as Error).message}` });
      continue;
    }

    const parsed = parseSkill(text, "project", path);
    if (!parsed.ok) {
      problems.push({ path, error: parsed.error });
      continue;
    }

    const earlier = seen.get(parsed.skill.name);
    if (earlier) {
      problems.push({
        path,
        error: `Uses the name \`${parsed.skill.name}\`, which ${earlier} already uses.`,
      });
      continue;
    }
    seen.set(parsed.skill.name, path);
    project.push(parsed.skill);
  }

  project.sort((a, b) => a.title.localeCompare(b.title));
  return { skills: [...BUILTIN_SKILLS, ...project], problems };
}

/** Direct children of the skills folder only, and Markdown only. */
export function isProjectSkillPath(path: string): boolean {
  if (!path.startsWith(PROJECT_SKILLS_DIR)) return false;
  const rest = path.slice(PROJECT_SKILLS_DIR.length);
  return rest.length > 3 && !rest.includes("/") && rest.toLowerCase().endsWith(".md");
}

/** Where a new project skill with this name would be saved. */
export function projectSkillPath(name: string): string {
  return `${PROJECT_SKILLS_DIR}${name}.md`;
}
