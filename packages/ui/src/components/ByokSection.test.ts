import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ByokSection, ProviderRowView } from "./ByokSection.js";
import type { ByokSectionProps, ProviderRowViewProps } from "./ByokSection.js";
import { BYOK_PROVIDERS } from "./byok-providers.js";

function render(overrides: Partial<ProviderRowViewProps>): string {
  const props: ProviderRowViewProps = {
    provider: BYOK_PROVIDERS[0]!,
    hasKey: false,
    entering: false,
    draftKey: "",
    busy: false,
    error: null,
    onDraftKeyChange: () => {},
    onStartEntering: () => {},
    onCancel: () => {},
    onSubmit: () => {},
    onRemove: () => {},
    ...overrides,
  };
  return renderToStaticMarkup(createElement(ProviderRowView, props));
}

describe("ProviderRowView", () => {
  it("offers to add a key when there is none, with no message", () => {
    const html = render({});
    expect(html).toContain("Add key");
    expect(html).not.toContain('role="alert"');
  });

  // The regression: the message was drawn inside the add-key form, which is
  // not shown once a key exists, so a failed removal said nothing.
  it("shows why removing a key failed", () => {
    const html = render({ hasKey: true, error: "Could not remove the key: the store is locked" });
    expect(html).toContain("Remove key");
    expect(html).toContain('role="alert"');
    expect(html).toContain("the store is locked");
  });

  it("shows why saving a key failed, next to the form", () => {
    const html = render({ entering: true, error: "Could not save the key: no store" });
    expect(html).toContain("Save key");
    expect(html).toContain("no store");
    expect(html.match(/role="alert"/g)).toHaveLength(1);
  });
});

function renderSection(overrides: Partial<ByokSectionProps>): string {
  const props: ByokSectionProps = {
    keyedProviderIds: [],
    onAddKey: async () => {},
    onRemoveKey: async () => {},
    ...overrides,
  };
  return renderToStaticMarkup(createElement(ByokSection, props));
}

describe("ByokSection", () => {
  it("has no warning when the credential store works", () => {
    expect(renderSection({})).not.toContain('role="alert"');
  });

  // The regression: an unusable store read as "no keys yet", and nothing said
  // otherwise until someone tried to add one.
  it("says the credential store could not be checked, and why", () => {
    const html = renderSection({ storeProblem: "the credential store could not be used" });
    expect(html).toContain('role="alert"');
    expect(html).toContain("can&#x27;t be checked right now");
    expect(html).toContain("the credential store could not be used");
    // The providers are still listed, so local models and adding a key
    // once the store is fixed are not blocked.
    expect(html).toContain("Add key");
  });

  it("does not show it where there is no credential store to check", () => {
    const html = renderSection({ available: false, storeProblem: "irrelevant" });
    expect(html).not.toContain("irrelevant");
    expect(html).toContain("needs the desktop app");
  });
});
