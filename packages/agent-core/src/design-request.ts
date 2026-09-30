import type { DesignSelection } from "@paleonyx/shared-types";

/**
 * Turns "I clicked this and want that" into the request a design-change
 * task runs on (PRD.md §3 journey 14).
 *
 * The facts here describe the page *as it is running*, which is the
 * whole difficulty: none of them is a source location. The agent has to
 * get from a rendered button to the line that produced it, and the
 * honest framing is to hand it what we observed and say so, rather than
 * presenting a guess as though it were a lookup.
 *
 * Kept separate from the panel for the same reason `composeProjectBrief`
 * is separate from the wizard: what gets shown and what gets sent are
 * different concerns, and only one of them is testable in isolation.
 */
export function composeDesignRequest(
  selections: readonly DesignSelection[],
  instruction: string
): string {
  const [first] = selections;
  if (!first) throw new Error("composeDesignRequest needs at least one selected element.");
  const many = selections.length > 1;

  const described = selections.map((selection, index) => {
    const facts = elementFacts(selection);
    return many
      ? [`Element ${index + 1} of ${selections.length}:`, ...facts].join("\n")
      : ["What they clicked:", ...facts].join("\n");
  });

  const sections = [
    many
      ? `The user is looking at ${first.page} running in a live preview, and clicked on ${selections.length} parts of the page.`
      : `The user is looking at ${first.page} running in a live preview, and clicked on part of the page.`,
    ...described,
    `What they want changed: ${collapse(instruction)}`,
    ...(many
      ? [
          `Apply it to each of the ${selections.length} elements above, unless what they wrote says otherwise. Work out each element's change from its own measured size, not from the others'.`,
        ]
      : []),
    // A relative request has an answer here, and without saying so the
    // model treats "no width in the CSS" as "the size is unknowable".
    "If what they asked for is relative — bigger, half as wide, a bit taller — work it out from the measured size above. That is what the element is right now, whether or not the stylesheet says so. Do not invent a starting size, and do not refuse because none is written in the code.",
  ];

  // An exact location makes searching pointless and wrong to fall back
  // on, so the instruction changes shape entirely when we have one.
  const located = selections.filter((selection) => selection.source);
  if (located.length === selections.length) {
    sections.push(
      located
        .map(
          (selection) =>
            `${many ? `${describeForLocation(selection)} is` : "This element is"} produced by ${selection.source?.path} line ${selection.source?.line}. Change it there.`
        )
        .join("\n")
    );
  } else {
    sections.push(
      [
        "Those details come from the page as it is running, not from the source, so you have to find where each element is written.",
        "Search the project for the text, id, or class above. Read the file you find before changing it.",
        "If the same text or class appears in more than one place, change the one the position above points to and say which you picked.",
        "If you cannot find where it is written, say so and change nothing. Editing something that merely looks similar is worse than not finding it.",
      ].join(" ")
    );
  }

  return sections.join("\n\n");
}

function elementFacts(selection: DesignSelection): string[] {
  const facts: string[] = [`- It is a <${selection.tag.toLowerCase()}> element`];

  if (selection.id) facts.push(`- Its id is "${selection.id}"`);
  if (selection.classes.length > 0) {
    facts.push(`- Its classes are: ${selection.classes.join(", ")}`);
  }
  const text = collapse(selection.text);
  if (text) facts.push(`- The text inside it reads: "${text}"`);
  if (selection.path.length > 0) {
    facts.push(`- Where it sits on the page: ${selection.path.join(" > ")}`);
  }
  // Phrased as the measured current size, not a bare dimension.
  //
  // Asked to make a button "twice as big", a model that reads the CSS,
  // finds no width or height set, and concludes it cannot know the
  // current size will invent one — observed producing 220x42 for a
  // button that was neither. The rendered size is measured from the
  // running page and is the answer to that question, but only if the
  // prompt says so.
  facts.push(
    `- Its current size on screen, measured from the running page, is ${Math.round(
      selection.rect.width
    )} pixels wide by ${Math.round(selection.rect.height)} pixels tall`
  );
  return facts;
}

function describeForLocation(selection: DesignSelection): string {
  const tag = selection.tag.toLowerCase();
  if (selection.id) return `The ${tag} with id "${selection.id}"`;
  const text = collapse(selection.text);
  return text ? `The ${tag} reading "${text}"` : `A ${tag}`;
}

/**
 * True when every selected element carries enough to act on. A click
 * that landed on an element with no id, no classes, and no text gives the
 * agent nothing to search for, and asking anyway wastes a run. One such
 * element among several is refused too: the user can ctrl+click it off.
 */
export function isSelectionLocatable(selections: readonly DesignSelection[]): boolean {
  return (
    selections.length > 0 &&
    selections.every(
      (selection) =>
        selection.source ||
        selection.id ||
        selection.classes.length > 0 ||
        collapse(selection.text)
    )
  );
}

function collapse(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}
