import { describe, expect, it } from "vitest";
import {
  DEFAULT_COMMAND_ALLOWLIST,
  checkAllowlist,
} from "./command-allowlist.js";

function check(command: string, allowlist: readonly string[] = DEFAULT_COMMAND_ALLOWLIST) {
  const [program, ...args] = command.split(" ");
  return checkAllowlist({ program: program!, args }, allowlist);
}

describe("prefix matching", () => {
  it("allows an exact entry", () => {
    expect(check("cargo test").allowed).toBe(true);
  });

  it("allows extra trailing arguments, which only narrow the same operation", () => {
    // `cargo test --lib some_test` is still running the tests.
    expect(check("cargo test --lib some_test").allowed).toBe(true);
  });

  it("refuses a different subcommand of an allowed program", () => {
    // The whole point of prefix matching: `cargo` being present in the
    // list must not permit every cargo subcommand.
    expect(check("cargo publish").allowed).toBe(false);
    expect(check("cargo install ripgrep").allowed).toBe(false);
  });

  it("refuses the program alone when the entry requires a subcommand", () => {
    expect(check("cargo").allowed).toBe(false);
  });

  it("refuses a program that is not listed at all", () => {
    expect(check("rm -rf /").allowed).toBe(false);
    expect(check("curl https://example.test").allowed).toBe(false);
  });
});

describe("the escape hatches this exists to close", () => {
  it("does not allow arbitrary code through a language runtime", () => {
    // `node` and `python` are in the default list only via specific
    // subcommands. Bare interpreter flags execute anything.
    expect(check('node -e "process.exit(1)"').allowed).toBe(false);
    expect(check('python -c "import os"').allowed).toBe(false);
  });

  it("does not allow arbitrary package scripts", () => {
    // `npm run build` is listed; `npm run <anything>` is not, because a
    // project's scripts can do anything at all.
    expect(check("npm run deploy").allowed).toBe(false);
    expect(check("npm run build").allowed).toBe(true);
  });

  it("does not allow package installation", () => {
    expect(check("npm install left-pad").allowed).toBe(false);
    expect(check("pip install requests").allowed).toBe(false);
  });

  it("ships no git entries, so history is not reachable this way", () => {
    // Agent git operations go through packages/vcs, which only ever
    // appends to a dedicated ref. `git reset --hard` must not be one
    // model suggestion away.
    expect(check("git reset --hard").allowed).toBe(false);
    expect(check("git push --force").allowed).toBe(false);
    expect(DEFAULT_COMMAND_ALLOWLIST.some((e) => e.startsWith("git"))).toBe(false);
  });

  it("is honest that a broad user-added entry grants broad access", () => {
    // Not a defect — a documented consequence. Someone who adds bare
    // `node` has chosen that, and the settings copy says so.
    expect(check('node -e "anything"', ["node"]).allowed).toBe(true);
  });
});

describe("platform differences", () => {
  it("matches Windows executable extensions against one entry", () => {
    expect(checkAllowlist({ program: "npm.cmd", args: ["test"] }, ["npm test"]).allowed).toBe(
      true
    );
    expect(checkAllowlist({ program: "npm.CMD", args: ["test"] }, ["npm test"]).allowed).toBe(
      true
    );
  });

  it("matches an absolute path to an allowed program", () => {
    const decision = checkAllowlist(
      { program: "C:\\Program Files\\nodejs\\npm.cmd", args: ["test"] },
      ["npm test"]
    );
    expect(decision.allowed).toBe(true);
  });

  it("does not let a lookalike directory name pass as the program", () => {
    const decision = checkAllowlist(
      { program: "/tmp/evil/npm-not-really", args: ["test"] },
      ["npm test"]
    );
    expect(decision.allowed).toBe(false);
  });
});

describe("empty and malformed input", () => {
  it("refuses an empty program", () => {
    expect(checkAllowlist({ program: "", args: [] }, DEFAULT_COMMAND_ALLOWLIST).allowed).toBe(
      false
    );
  });

  it("refuses everything when the allowlist is empty", () => {
    expect(check("cargo test", []).allowed).toBe(false);
  });

  it("ignores blank entries rather than treating them as wildcards", () => {
    expect(check("cargo test", ["", "   "]).allowed).toBe(false);
  });

  it("names the rejected command so the user can decide to allow it", () => {
    const decision = check("cargo publish");
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.reason).toContain("cargo publish");
  });
});
