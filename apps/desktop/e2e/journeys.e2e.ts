import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  CONTEXT_MARKER,
  FIXTURE_BUTTON_CENTRE,
  FIXTURE_SUM,
  NOTES_MARKER,
  by,
  launchApp,
  readRef,
  sleep,
} from "./app.js";
import type { AppUnderTest, Point } from "./app.js";
import { FAKE_MODEL, TOOLS_MODEL, TOOLS_MODEL_CALL } from "./fake-ollama-server.js";

/**
 * Critical journeys against the real desktop shell (CLAUDE.md §8).
 *
 * These cover what the integration tests cannot: the Rust side (file
 * writes, the shadow-history git plumbing, the preview server and its
 * injected script), the sandboxed preview frame, second windows, and
 * real pointer input. The pipeline beneath them is covered faster in
 * agent-core's integration tests.
 *
 * The journeys share one app and run in order, as a user would: open a
 * project, change it, look at it, design on it. Each step says what it
 * relies on from the one before.
 */

const FIX = {
  summary: "Fix the off-by-one in sum.",
  steps: [{ id: "1", description: "Read sum.js", targetFiles: ["sum.js"] }],
  explanation: "The loop ran one past the end of the array.",
  diff: [
    {
      filePath: "sum.js",
      hunks: [
        {
          header: "@@ -2,3 +2,3 @@",
          lines: [
            { type: "context", content: "  let total = 0;" },
            { type: "remove", content: "  for (let i = 0; i <= numbers.length; i++) {" },
            { type: "add", content: "  for (let i = 0; i < numbers.length; i++) {" },
            { type: "context", content: "    total += numbers[i];" },
          ],
        },
      ],
    },
  ],
  confidence: "high",
};

const HISTORY_REF = "refs/paleonyx/history";

const REFACTOR_PLACEHOLDER = "What should be restructured, and what's wrong with it now?";
const EXPLAIN_PLACEHOLDER = "What would you like explained about the selected file(s)?";

/** A change that creates a file two folders deep, neither of which exists. */
const CREATE_HELPERS = {
  summary: "Add a helpers module.",
  steps: [
    { id: "1", description: "Wrote lib/util/helpers.js", targetFiles: ["lib/util/helpers.js"] },
  ],
  explanation: "Adds a small helper.",
  diff: [
    {
      filePath: "lib/util/helpers.js",
      hunks: [
        {
          header: "@@ -0,0 +1,3 @@",
          lines: [
            { type: "add", content: "export function double(n) {" },
            { type: "add", content: "  return n * 2;" },
            { type: "add", content: "}" },
          ],
        },
      ],
    },
  ],
  confidence: "high",
};

async function exists(path: string): Promise<boolean> {
  return access(path).then(
    () => true,
    () => false
  );
}

/** Polls a condition outside the page — the disk, the fake server. */
async function waitForDisk(check: () => Promise<boolean>, what: string): Promise<void> {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await sleep(150);
  }
  throw new Error(`Timed out waiting for ${what}.`);
}

describe.skipIf(process.platform !== "win32")("desktop journeys", () => {
  let app: AppUnderTest;

  beforeAll(async () => {
    app = await launchApp({ answer: FIX });
  });

  afterAll(async () => {
    await app?.close();
  });

  it("opens a project and lists its files", async () => {
    await app.openProject();
    const text = await app.page.text();
    expect(text).toContain("index.html");
    expect(text).toContain("sum.js");
  });

  it("uses the configured local model, not the offline stand-in", async () => {
    // Relies on: the project being open, so the status bar is showing.
    // Without this the rest could pass against canned demo answers.
    await app.page.waitFor<boolean>(
      `document.body.innerText.includes("Ollama: ${FAKE_MODEL}")`,
      "the fake model to become the active provider"
    );
  });

  /**
   * Propose, apply, undo — the journey the product's trust promise rests
   * on, through the real shell: files written by Rust, the change
   * recorded under refs/paleonyx/history by git plumbing, and undone
   * without touching the user's own history.
   */
  it("proposes a fix, applies it to disk, records it, and undoes it", async () => {
    const { page, project } = app;
    const onDisk = () => readFile(join(project, "sum.js"), "utf8");

    await page.click(by.text("button", "sum.js"), "sum.js in the file tree");
    await page.click(
      by.text("button", "+ Add file"),
      "the add-to-context button",
      `document.body.innerText.includes("1 file in context")`
    );
    await page.click(
      by.text("button", "Bug Fix"),
      "the Bug Fix task",
      `(${by.text("button", "Bug Fix")})?.getAttribute("aria-checked") === "true"`
    );
    await page.type(
      by.placeholder("Describe the bug you're seeing…"),
      "sum returns NaN",
      "the task description"
    );
    await page.click(by.text("button", "Run"), "the Run button");

    // Suggest-only is the default, so nothing is written yet.
    await page.centreOf(by.text("button", "Apply change"), "the proposed change");
    expect(await onDisk()).toBe(FIXTURE_SUM);
    expect(readRef(project, HISTORY_REF)).toBeNull();
    expect(app.ollama.chats.length).toBeGreaterThan(0);

    await page.click(by.text("button", "Apply change"), "Apply change");
    await page.waitFor<boolean>(
      `document.body.innerText.includes("Applied and recorded")`,
      "the change to be applied"
    );
    expect(await onDisk()).toContain("i < numbers.length");
    const recorded = readRef(project, HISTORY_REF);
    expect(recorded, "no shadow-history commit was made").not.toBeNull();
    // The user's own branch is untouched: there is still no HEAD commit.
    expect(readRef(project, "HEAD")).toBeNull();

    await page.click(by.text("button", "Undo"), "Undo in History");
    await page.waitFor<boolean>(
      `document.body.innerText.includes("Undone")`,
      "the change to be undone"
    );
    expect(await onDisk()).toBe(FIXTURE_SUM);
    // Undo is recorded as a new entry rather than erasing the old one.
    expect(readRef(project, HISTORY_REF)).not.toBe(recorded);
  });

  /**
   * The regression: the file lister skipped every dot-folder, so
   * `.paleonyx/context.md` never loaded in the desktop app — its unit test
   * used a fake that listed it.
   */
  it("gives the agent the project's own context document", async () => {
    // Relies on: the fix proposed above, whose request the fake recorded.
    const sent = JSON.stringify(app.ollama.chats[0]?.messages ?? []);
    expect(sent).toContain(CONTEXT_MARKER);
    expect(await app.page.text()).toContain(".paleonyx/context.md");
  });

  /**
   * The regression: a new file inside a folder that did not exist was
   * refused, which is every scaffold into an empty folder.
   */
  it("creates a file inside folders that do not exist yet, and undoes it", async () => {
    const { page, project } = app;
    const created = join(project, "lib", "util", "helpers.js");
    const chatsBefore = app.ollama.chats.length;
    app.ollama.setAnswer(CREATE_HELPERS);

    // Relies on: a task still in the box from the journey above.
    await page.click(by.text("button", "Run"), "the Run button");
    await waitForDisk(async () => app.ollama.chats.length > chatsBefore, "the new request");
    await page.click(by.text("button", "Apply change"), "Apply change");
    await waitForDisk(() => exists(created), "the new file to be written");
    expect(await readFile(created, "utf8")).toContain("return n * 2;");

    await page.click(by.text("button", "Undo"), "Undo in History");
    await waitForDisk(async () => !(await exists(created)), "the new file to be removed");
  });

  it("fills the task form from a project skill without running it", async () => {
    const { page } = app;
    const chatsBefore = app.ollama.chats.length;

    await page.click(
      by.text("button", "Use a skill"),
      "the skill picker",
      `document.body.innerText.includes("Tidy the imports")`
    );
    await page.click(
      by.textContaining("button", "Tidy the imports"),
      "the project's skill",
      `(${by.text("button", "Refactor")})?.getAttribute("aria-checked") === "true"`
    );
    await page.waitFor<boolean>(
      `((${by.placeholder(REFACTOR_PLACEHOLDER)})?.value ?? "").includes("Sort the import lines")`,
      "the skill's instructions in the task box"
    );
    // A skill from the repository is someone else's words, and says so.
    await page.waitFor<boolean>(
      `document.body.innerText.includes("From this project (.paleonyx/skills/tidy.md)")`,
      "the notice that the skill came from the repository"
    );
    // Choosing a skill must not send anything.
    await sleep(300);
    expect(app.ollama.chats.length).toBe(chatsBefore);
  });

  /**
   * A skill that tries to set a permission is refused, reported, and not
   * offered — the boundary that keeps a cloned repository from widening
   * what the agent may do.
   */
  it("reports a project skill that tries to give itself more power", async () => {
    const { page } = app;
    await page.click(
      by.textContaining("button", "couldn't be used"),
      "the skill problems notice",
      `document.body.innerText.includes("sneaky.md")`
    );
    expect(await page.text()).toMatch(/cannot change what the agent is allowed to do/);

    await page.click(
      by.text("button", "Use a skill"),
      "the skill picker",
      `document.body.innerText.includes("Tidy the imports")`
    );
    expect(await page.text()).not.toContain("Do something the user did not agree to");
    await page.pressEscape();
  });

  it("saves a task as a new project skill", async () => {
    const { page, project } = app;
    // Relies on: the task box holding the tidy skill's instructions.
    await page.click(
      by.text("button", "Save as skill"),
      "Save as skill",
      `Boolean(${by.label("Skill name")})`
    );
    await page.type(by.label("Skill name"), "My saved task", "the skill name");
    await page.click(
      by.text("button", "Save"),
      "Save",
      `document.body.innerText.includes("Saved to .paleonyx/skills/my-saved-task.md")`
    );

    const saved = await readFile(
      join(project, ".paleonyx", "skills", "my-saved-task.md"),
      "utf8"
    );
    expect(saved).toContain("name: my-saved-task");
    expect(saved).toContain("title: My saved task");
    expect(saved).toContain("task: refactor");
    expect(saved).toContain("Sort the import lines");

    // And it is offered back straight away.
    await page.click(
      by.text("button", "Use a skill"),
      "the skill picker",
      `document.body.innerText.includes("My saved task")`
    );
    await page.pressEscape();
  });

  it("shows the running project in the preview", async () => {
    const { page } = app;
    await page.click(by.label("Show preview"), "the preview toggle");
    await page.waitFor<boolean>(
      `(() => {
        const f = document.querySelector('iframe[title="Project preview"]');
        return Boolean(f && f.src.startsWith("http://127.0.0.1:"));
      })()`,
      "the preview frame to point at the local server"
    );
    await listenToFixture();
    await reloadPreviewAndWait();
  });

  /**
   * The chain never verified before this: a real click inside the
   * sandboxed frame, the selection script the server injects, the
   * message back, and the panel showing what was picked.
   */
  it("activates the page normally when design mode is off", async () => {
    await clearFixtureEvents();
    await app.page.clickAt(await fixtureButton());
    await app.page.waitFor<boolean>(
      `window.__fixture.includes("clicked")`,
      "the page's own button to respond"
    );
  });

  it("selects instead of activating when design mode is on", async () => {
    const { page } = app;
    await clearFixtureEvents();
    await page.click(by.label("Select something to change"), "the design-mode toggle");
    // Design mode reloads the frame so the server can add its script.
    await page.waitFor<boolean>(
      `window.__fixture.includes("loaded")`,
      "the preview to reload with the selection script"
    );

    await clearFixtureEvents();
    await page.clickAt(await fixtureButton());
    await page.waitFor<boolean>(
      `document.body.innerText.includes("Selected #go")`,
      "the panel to show the selected element"
    );
    // Selecting must not also press the button.
    await sleep(300);
    expect(await page.evaluate<string[]>("window.__fixture")).not.toContain("clicked");
  });

  /**
   * The pop-out renders the user's project, often code nobody has read,
   * so it must not be able to invoke a single app command.
   *
   * What protects it is the page's origin: Tauri applies a capability to
   * a remote origin only if the capability lists it. An earlier comment
   * credited the window's label; granting that label the main
   * capability left this test passing, which is how that was shown to be
   * wrong.
   */
  it("opens the preview in a window that cannot call the app", async () => {
    await app.page.click(by.label("Open in its own window"), "the pop-out button");
    const popout = await app.attach("http://127.0.0.1:");
    try {
      await waitIn(popout, `document.getElementById("go") !== null`, "the pop-out to load");
      const outcome = await popout.evaluate<string>(`(async () => {
        const ipc = window.__TAURI_INTERNALS__;
        if (!ipc) return "no-ipc";
        try {
          await ipc.invoke("read_project_file", { path: "sum.js" });
          return "invoked";
        } catch (error) {
          return "refused: " + String(error);
        }
      })()`);
      expect(outcome, "the pop-out could read project files").not.toBe("invoked");
      expect(outcome).toMatch(/^(no-ipc|refused: .*not allowed)/);
    } finally {
      popout.close();
    }
  });

  /**
   * The fixture's `.paleonyx/mcp.json` lists a server. A repository is
   * often someone else's, so listing a program must not be enough to
   * run it: it waits for the user's OK, and then for a mode in which the
   * agent may use it.
   */
  it("starts a project's MCP server only once allowed, and in a mode that can use it", async () => {
    const { page } = app;
    await page.click(
      by.label("Connected tools"),
      "the Connected tools panel",
      `document.body.innerText.includes("Needs your OK")`
    );
    expect(await page.text()).toContain("node notes-server.mjs");

    // A mode that could use it is not enough on its own.
    await switchMode("Can run commands", true);
    await sleep(1000);
    expect(await notesEvents()).toEqual([]);
    expect(await page.text()).toContain("Needs your OK");

    await page.click(
      by.text("button", "Allow"),
      "Allow",
      `document.body.innerText.includes("Running · 1 of 1 tool on")`
    );
    expect(await notesEvents()).toEqual([{ event: "started" }]);
    expect(await page.text()).toContain("Looks up the team's notes on a topic.");
  });

  /**
   * Switching models, and the whole path an MCP tool call takes: a model
   * that calls tools asks for it, the shell's server runs it, and its
   * answer goes back to the model — with what was sent shown to the user.
   */
  it("hands an allowed tool to a model that can call it, and shows what was sent", async () => {
    const { page } = app;
    await page.click(by.label("Models"), "the Models panel", `document.body.innerText.includes("${TOOLS_MODEL}")`);
    await page.click(
      modelButton(TOOLS_MODEL),
      "the tool-calling model",
      `document.body.innerText.includes("Ollama: ${TOOLS_MODEL}")`
    );
    await page.click(by.label("Files"), "the Files panel", `Boolean(${by.text("button", "Explain")})`);
    await page.click(
      by.text("button", "Explain"),
      "the Explain task",
      `(${by.text("button", "Explain")})?.getAttribute("aria-checked") === "true"`
    );
    await page.type(by.placeholder(EXPLAIN_PLACEHOLDER), "What do the team's notes say about sum?", "the task box");

    const chatsBefore = app.ollama.chats.length;
    await page.click(
      by.text("button", "Run"),
      "the Run button",
      `document.body.innerText.includes("Used lookup (notes)")`
    );

    const calls = (await notesEvents()).filter((entry) => entry.event === "call");
    expect(calls).toEqual([{ event: "call", name: "lookup", arguments: { topic: "sum" } }]);

    const sent = app.ollama.chats.slice(chatsBefore);
    const offered = (sent[0]?.tools ?? []).map((tool) => tool.function.name);
    expect(offered).toContain(TOOLS_MODEL_CALL.name);
    const answer = sent.flatMap((chat) => chat.messages).find((message) => message.role === "tool");
    expect(answer?.content).toContain(NOTES_MARKER);
    expect(answer?.tool_name).toBe(TOOLS_MODEL_CALL.name);

    await page.click(
      by.textContaining("button", "Used lookup (notes)"),
      "the tool step",
      `document.body.innerText.includes('"topic": "sum"')`
    );
  });

  it("stops the server when the mode no longer allows it", async () => {
    const { page } = app;
    await switchMode("Suggest-only", false);
    await waitForDisk(
      async () => (await notesEvents()).some((entry) => entry.event === "stopped"),
      "the server to stop"
    );
    await page.click(
      by.label("Connected tools"),
      "the Connected tools panel",
      `document.body.innerText.includes("Allowed — not running")`
    );

    // Back to the model the remaining journeys were written against.
    await page.click(by.label("Models"), "the Models panel", `document.body.innerText.includes("${FAKE_MODEL}")`);
    await page.click(
      modelButton(FAKE_MODEL),
      "the completion-only model",
      `document.body.innerText.includes("Ollama: ${FAKE_MODEL}")`
    );
    await page.click(by.label("Files"), "the Files panel", `document.body.innerText.includes("sum.js")`);
  });

  it("keeps a dragged panel width after reopening the project", async () => {
    const { page } = app;
    const handle = by.label("Resize the file panel");
    const before = Number(
      await page.waitFor<string>(`(${handle})?.getAttribute("aria-valuenow")`, "the file panel handle")
    );

    const start = await page.stableCentreOf(handle, "the file panel handle");
    await page.drag(start, { x: start.x + 120, y: start.y });
    // Read once the last move has rendered. Reading straight away caught
    // the width mid-drag — seven steps of eight — and made a correctly
    // saved width look like a persistence bug.
    const after = await settledNumber(`(${handle}).getAttribute("aria-valuenow")`);
    expect(after).toBeGreaterThanOrEqual(before + 118);
    expect(after).toBeLessThanOrEqual(before + 122);

    await page.reload();
    await app.openProject();
    const reopened = Number(
      await page.waitFor<string>(`(${handle})?.getAttribute("aria-valuenow")`, "the handle after reopening")
    );
    expect(reopened).toBe(after);
  });

  // --- helpers ---------------------------------------------------------

  /** A model's row in the Models panel; both fakes are installed. */
  function modelButton(name: string): string {
    return `[...document.querySelectorAll("button")].find((e) => e.textContent.startsWith(${JSON.stringify(`${name}Installed`)}))`;
  }

  /** What the fixture's MCP server has recorded, oldest first. */
  async function notesEvents(): Promise<Record<string, unknown>[]> {
    const text = await readFile(app.notesLog, "utf8").catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return "";
      throw error;
    });
    return text
      .split("\n")
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line) as Record<string, unknown>);
  }

  /** Changes the permission mode from the status bar, confirming a raise. */
  async function switchMode(label: string, raising: boolean): Promise<void> {
    const { page } = app;
    await page.click(
      `[...document.querySelectorAll("[aria-label]")].find((e) => e.getAttribute("aria-label").startsWith("Permission mode:"))`,
      "the permission mode indicator",
      `Boolean(${by.css('[role="radiogroup"][aria-label="Permission mode"]')})`
    );
    const option = `[...document.querySelectorAll('[role="radio"]')].find((e) => e.textContent.startsWith(${JSON.stringify(label)}))`;
    if (raising) {
      await page.click(option, `the ${label} option`, `Boolean(${by.text("button", "Switch")})`);
      await page.click(
        by.text("button", "Switch"),
        "Switch",
        `(document.querySelector('[aria-label^="Permission mode:"]')?.getAttribute("aria-label") ?? "").includes(${JSON.stringify(label)})`
      );
    } else {
      await page.click(
        option,
        `the ${label} option`,
        `(document.querySelector('[aria-label^="Permission mode:"]')?.getAttribute("aria-label") ?? "").includes(${JSON.stringify(label)})`
      );
    }
  }

  /** A numeric reading taken once it holds still across two looks. */
  async function settledNumber(expression: string): Promise<number> {
    let previous = Number.NaN;
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const current = Number(await app.page.evaluate<string>(expression));
      if (current === previous) return current;
      previous = current;
      await sleep(100);
    }
    throw new Error(`${expression} never settled`);
  }

  /** Records messages the fixture page posts to its parent. */
  async function listenToFixture(): Promise<void> {
    await app.page.evaluate(`(() => {
      window.__fixture = [];
      window.addEventListener("message", (event) => {
        if (event.data && event.data.fixture) window.__fixture.push(event.data.fixture);
      });
    })()`);
  }

  async function clearFixtureEvents(): Promise<void> {
    await app.page.evaluate(`window.__fixture.length = 0`);
  }

  async function reloadPreviewAndWait(): Promise<void> {
    await clearFixtureEvents();
    await app.page.click(by.label("Reload"), "the preview reload button");
    await app.page.waitFor<boolean>(
      `window.__fixture.includes("loaded")`,
      "the fixture page to load"
    );
  }

  /** Where the fixture's button is on screen, from the frame's position. */
  function fixtureButton(): Promise<Point> {
    return app.page.waitFor<Point>(
      `(() => {
        const f = document.querySelector('iframe[title="Project preview"]');
        if (!f) return null;
        const r = f.getBoundingClientRect();
        return {
          x: r.left + f.clientLeft + ${FIXTURE_BUTTON_CENTRE.x},
          y: r.top + f.clientTop + ${FIXTURE_BUTTON_CENTRE.y},
        };
      })()`,
      "the preview frame's position"
    );
  }
});

async function waitIn(
  session: { evaluate<T>(expression: string): Promise<T> },
  expression: string,
  what: string
): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (await session.evaluate<boolean>(expression).catch(() => false)) return;
    await sleep(200);
  }
  throw new Error(`Timed out waiting for ${what}.`);
}
