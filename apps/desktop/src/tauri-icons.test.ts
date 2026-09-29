/// <reference types="node" />
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const shell = fileURLToPath(new URL("../src-tauri/", import.meta.url));
const config = JSON.parse(readFileSync(`${shell}tauri.conf.json`, "utf8")) as {
  bundle: { icon: string[] };
};
const icons = config.bundle.icon;

describe("bundle icons", () => {
  // `targets` is "all", and a macOS bundle needs an .icns, a Windows one an
  // .ico. Nothing here builds either, so a missing one shows up only when
  // someone first tries that platform.
  it("lists an icon for macOS and one for Windows", () => {
    expect(icons.some((icon) => icon.endsWith(".icns"))).toBe(true);
    expect(icons.some((icon) => icon.endsWith(".ico"))).toBe(true);
  });

  it("only lists files that exist", () => {
    const missing = icons.filter((icon) => !existsSync(`${shell}${icon}`));
    expect(missing).toEqual([]);
  });
});
