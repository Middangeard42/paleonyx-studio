import type { Skill, SkillSource, SkillTaskType } from "@paleonyx/shared-types";
import { SKILL_TASK_TYPES } from "@paleonyx/shared-types";

/**
 * Reads a skill file.
 *
 * The format is Markdown with a small frontmatter block — the same shape
 * as the SKILL.md files several open-source agents already use, so a
 * skill written for one of those needs little more than a `task:` line.
 * Borrowed as a convention rather than as a library: the frontmatter
 * here is flat `key: value` pairs, which a few lines parse, and a YAML
 * dependency would bring a whole language to read four strings.
 *
 * It is strict on purpose. A project skill is read from the repository,
 * which is often someone else's, so the parser is where "a skill can only
 * describe a task" is enforced. An unknown field is an error rather than
 * something quietly ignored — a skill author who writes `permission:`
 * expecting it to work deserves to be told it does not, and why.
 */

export type SkillParseResult =
  | { ok: true; skill: Skill }
  | { ok: false; error: string };

/** The only fields a skill may set. */
const ALLOWED_FIELDS = ["name", "title", "description", "task"] as const;

/** Bounds, so a stray large file cannot fill the prompt. */
export const MAX_SKILL_BYTES = 16 * 1024;
export const MAX_INSTRUCTIONS_CHARS = 8_000;
const MAX_DESCRIPTION_CHARS = 280;
const MAX_TITLE_CHARS = 80;

const NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

export function parseSkill(
  text: string,
  source: SkillSource,
  path?: string
): SkillParseResult {
  if (text.length > MAX_SKILL_BYTES) {
    return fail(`is larger than ${MAX_SKILL_BYTES / 1024} KB, which is more than a task template needs.`);
  }

  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  if (lines[0]?.trim() !== "---") {
    return fail("does not start with a `---` line, so it has no name or task type.");
  }
  const close = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
  if (close < 0) {
    return fail("opens its header with `---` but never closes it.");
  }

  const fields = new Map<string, string>();
  for (const [offset, raw] of lines.slice(1, close).entries()) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;

    const colon = line.indexOf(":");
    if (colon <= 0) {
      return fail(`line ${offset + 2} is not a \`key: value\` pair.`);
    }
    const key = line.slice(0, colon).trim().toLowerCase();
    const value = unquote(line.slice(colon + 1).trim());

    if (!(ALLOWED_FIELDS as readonly string[]).includes(key)) {
      return fail(
        `sets \`${key}\`, which a skill cannot. A skill may set only ${ALLOWED_FIELDS.join(", ")} — it describes a task, and cannot change what the agent is allowed to do.`
      );
    }
    if (fields.has(key)) {
      return fail(`sets \`${key}\` twice.`);
    }
    fields.set(key, value);
  }

  const name = fields.get("name") ?? "";
  if (!NAME_PATTERN.test(name)) {
    return fail(
      name
        ? `has the name \`${name}\`; names use lowercase letters, digits, and hyphens.`
        : "has no `name`."
    );
  }

  const task = fields.get("task") ?? "";
  if (!isSkillTaskType(task)) {
    if (task === "scaffold" || task === "design-change") {
      return fail(
        `uses the task \`${task}\`, which needs input a template cannot carry. Use the new-project wizard or the preview for that.`
      );
    }
    return fail(
      task
        ? `uses the task \`${task}\`; choose one of ${SKILL_TASK_TYPES.join(", ")}.`
        : `has no \`task\`; choose one of ${SKILL_TASK_TYPES.join(", ")}.`
    );
  }

  const title = fields.get("title") || titleFromName(name);
  if (title.length > MAX_TITLE_CHARS) {
    return fail(`has a title longer than ${MAX_TITLE_CHARS} characters.`);
  }

  const description = fields.get("description") ?? "";
  if (description.length > MAX_DESCRIPTION_CHARS) {
    return fail(`has a description longer than ${MAX_DESCRIPTION_CHARS} characters.`);
  }

  const instructions = lines.slice(close + 1).join("\n").trim();
  if (!instructions) {
    return fail("has no instructions below its header.");
  }
  if (instructions.length > MAX_INSTRUCTIONS_CHARS) {
    return fail(`has instructions longer than ${MAX_INSTRUCTIONS_CHARS} characters.`);
  }

  return {
    ok: true,
    skill: {
      id: `${source}:${name}`,
      name,
      title,
      description,
      taskType: task,
      instructions,
      source,
      ...(path ? { path } : {}),
    },
  };
}

/**
 * Writes a skill back out in the same format, so one saved from the app
 * reads identically to one written by hand.
 */
export function formatSkill(skill: {
  name: string;
  title: string;
  description?: string;
  taskType: SkillTaskType;
  instructions: string;
}): string {
  const header = [
    "---",
    `name: ${skill.name}`,
    `title: ${quoteIfNeeded(skill.title)}`,
    ...(skill.description ? [`description: ${quoteIfNeeded(skill.description)}`] : []),
    `task: ${skill.taskType}`,
    "---",
  ];
  return `${header.join("\n")}\n${skill.instructions.trim()}\n`;
}

/** A file name derived from a title a person typed. */
export function nameFromTitle(title: string): string {
  const slug = title
    .toLowerCase()
    // Decompose accented letters, then drop the accents, so "Résumé"
    // becomes "resume" rather than having each accent read as a word
    // break.
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)
    .replace(/-+$/, "");
  return slug || "skill";
}

export function isSkillTaskType(value: string): value is SkillTaskType {
  return (SKILL_TASK_TYPES as readonly string[]).includes(value);
}

function titleFromName(name: string): string {
  const words = name.split("-").filter(Boolean).join(" ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function unquote(value: string): string {
  if (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if ((first === '"' || first === "'") && first === last) {
      return value.slice(1, -1);
    }
  }
  return value;
}

/**
 * Quotes a value that would otherwise read back differently: one with a
 * leading quote, a colon-space, a `#`, or surrounding spaces.
 */
function quoteIfNeeded(value: string): string {
  const risky = /^["'\s]|\s$|: |#/.test(value);
  return risky ? `"${value.replace(/"/g, "'")}"` : value;
}

function fail(reason: string): SkillParseResult {
  return { ok: false, error: `This skill file ${reason}` };
}
