import { describe, expect, it } from "vitest";
import {
  SELECTION_KEY,
  TITLE_MAX_LENGTH,
  effectiveSelection,
  isDefaultSelection,
  itemTitle,
  library,
  readSelection,
  selectionPatch,
  toggleSelection,
  type PromptItem,
} from "./library";

const items: PromptItem[] = [
  { id: "ticket", title: "Ticket", text: "Create a ticket.", enabledByDefault: true },
  { id: "commits", title: "Commits", text: "Use conventional commits.", enabledByDefault: true },
  { id: "tests", title: "", text: "Avoid useless tests.", enabledByDefault: false },
];

describe("effectiveSelection", () => {
  it("uses the defaults for a session that never chose", () => {
    expect(effectiveSelection(items, null)).toEqual(["ticket", "commits"]);
  });

  it("lets a stored choice override the defaults, including an empty one", () => {
    expect(effectiveSelection(items, ["tests"])).toEqual(["tests"]);
    expect(effectiveSelection(items, [])).toEqual([]);
  });

  it("drops deleted items and follows library order", () => {
    expect(effectiveSelection(items, ["tests", "deleted", "ticket"])).toEqual(["ticket", "tests"]);
  });
});

describe("readSelection", () => {
  it("round-trips what selectionPatch stores", () => {
    expect(readSelection(selectionPatch(["tests"]))).toEqual(["tests"]);
  });

  it("treats missing, cleared, and malformed metadata as never chosen", () => {
    expect(readSelection(undefined)).toBeNull();
    expect(readSelection({ "other.plugin": { selected: ["x"] } })).toBeNull();
    expect(readSelection(selectionPatch(null))).toBeNull();
    expect(readSelection({ [SELECTION_KEY]: { selected: "ticket" } })).toBeNull();
    expect(readSelection({ [SELECTION_KEY]: ["ticket"] })).toBeNull();
  });
});

describe("toggleSelection", () => {
  it("adds and removes an item, keeping library order", () => {
    expect(toggleSelection(items, ["tests"], "ticket")).toEqual(["ticket", "tests"]);
    expect(toggleSelection(items, ["ticket", "tests"], "ticket")).toEqual(["tests"]);
  });
});

describe("isDefaultSelection", () => {
  it("compares as sets", () => {
    expect(isDefaultSelection(items, ["commits", "ticket"])).toBe(true);
    expect(isDefaultSelection(items, ["ticket"])).toBe(false);
    expect(isDefaultSelection(items, ["ticket", "commits", "tests"])).toBe(false);
  });
});

describe("itemTitle", () => {
  it("falls back to the first line of the instruction, cut to title length", () => {
    expect(itemTitle({ title: "", text: "Short one.\nMore detail." })).toBe("Short one.");
    const long = itemTitle({ title: "", text: "x".repeat(TITLE_MAX_LENGTH + 20) });
    expect(long).toHaveLength(TITLE_MAX_LENGTH);
    expect(long.endsWith("…")).toBe(true);
  });
});

describe("library schema", () => {
  it("reads a missing document as an empty library", () => {
    expect(library.schema.parse({})).toEqual({ items: [] });
  });

  it("trims what was typed and rejects an item without an instruction", () => {
    const parsed = library.schema.parse({ items: [{ id: "a", title: " Name ", text: " Do it. " }] });
    expect(parsed.items[0]).toEqual({ id: "a", title: "Name", text: "Do it.", enabledByDefault: true });
    expect(library.schema.safeParse({ items: [{ id: "a", text: "   " }] }).success).toBe(false);
  });
});
