import { describe, expect, it } from "vitest";
import { parseLimits } from "./BudgetControl.js";

/**
 * The only logic in the control, and the part where a mistake is
 * expensive: limits below what a reply needs produce a task that pauses
 * before it can start, which reads as the app being broken rather than
 * as a limit doing its job.
 */
describe("parseLimits", () => {
  it("accepts sensible whole numbers", () => {
    const parsed = parseLimits("8", "20000");
    expect(parsed).toEqual({
      ok: true,
      limits: { maxToolCalls: 8, maxTokens: 20000 },
    });
  });

  it("rejects limits too low to complete a task", () => {
    expect(parseLimits("0", "20000")).toMatchObject({ ok: false });
    expect(parseLimits("8", "10")).toMatchObject({ ok: false });
  });

  it("names which field is wrong", () => {
    const steps = parseLimits("nope", "20000");
    const words = parseLimits("8", "nope");
    expect(steps).toMatchObject({ ok: false });
    expect(words).toMatchObject({ ok: false });
    if (steps.ok || words.ok) throw new Error("expected both to fail");
    expect(steps.error).toMatch(/steps/i);
    expect(words.error).toMatch(/words/i);
    expect(steps.error).not.toBe(words.error);
  });

  // Number() accepts all of these, and none is what someone typing into
  // a limits field meant. "1e5" as a token cap is a particularly
  // expensive way to find that out.
  it("rejects things Number() would happily accept", () => {
    for (const value of ["1e5", "0x10", "12.5", "-4", " ", ""]) {
      expect(parseLimits(value, "20000"), value).toMatchObject({ ok: false });
    }
  });

  // Surrounding whitespace is accepted on purpose: someone who pastes
  // " 8 " means 8, and refusing it would be pedantry rather than a
  // guard against anything.
  it("ignores whitespace around a real number", () => {
    expect(parseLimits("  8  ", " 20000 ")).toEqual({
      ok: true,
      limits: { maxToolCalls: 8, maxTokens: 20000 },
    });
  });

  it("rejects a number too large to be exact", () => {
    expect(parseLimits("8", "99999999999999999999")).toMatchObject({ ok: false });
  });

  it("accepts large but real limits", () => {
    expect(parseLimits("500", "2000000")).toEqual({
      ok: true,
      limits: { maxToolCalls: 500, maxTokens: 2000000 },
    });
  });
});
