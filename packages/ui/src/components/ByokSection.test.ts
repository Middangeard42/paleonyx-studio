import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ProviderRowView } from "./ByokSection.js";
import type { ProviderRowViewProps } from "./ByokSection.js";
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
