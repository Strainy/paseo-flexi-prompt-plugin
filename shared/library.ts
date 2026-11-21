import { defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

/** Agent metadata key holding the prompt items a session runs with. */
export const SELECTION_KEY = "flexi-prompt.selection";

/** Label Paseo puts on an agent that another agent created. */
export const PARENT_AGENT_ID_LABEL = "paseo.parent-agent-id";

export const TITLE_MAX_LENGTH = 60;

const promptItemSchema = z.object({
  id: z.string().min(1),
  /** Short name shown in the composer. Empty falls back to the first line of `text`. */
  title: z.string().trim().max(TITLE_MAX_LENGTH).default(""),
  /** The instruction appended to the system prompt, verbatim. */
  text: z.string().trim().min(1, "Enter the instruction"),
  /** Ticked when a new session starts. */
  enabledByDefault: z.boolean().default(true),
});

export type PromptItem = z.infer<typeof promptItemSchema>;

/** The prompt items to pick from, in the order they are listed and appended. */
export const library = defineSettings({
  id: "library",
  scope: "host",
  version: 1,
  schema: z.object({ items: z.array(promptItemSchema).default([]) }),
});

export type Library = z.infer<typeof library.schema>;

const selectionSchema = z.object({ selected: z.array(z.string()) });

/** What a selection is read from: agent metadata, as plugins and hooks receive it. */
type Metadata = Readonly<Record<string, unknown>> | null | undefined;

/** The ids a session explicitly chose, or `null` when it never chose. */
export function readSelection(metadata: Metadata): string[] | null {
  const parsed = selectionSchema.safeParse(metadata?.[SELECTION_KEY]);
  return parsed.success ? parsed.data.selected : null;
}

/** The metadata patch that stores a selection; `null` clears it so the defaults apply. */
export function selectionPatch(selected: readonly string[] | null) {
  return { [SELECTION_KEY]: selected === null ? null : { selected: [...selected] } };
}

export function defaultSelection(items: readonly PromptItem[]): string[] {
  return items.filter((item) => item.enabledByDefault).map((item) => item.id);
}

/**
 * The ids in effect, in library order. A stored selection wins over the defaults; ids of items
 * that no longer exist are dropped.
 */
export function effectiveSelection(
  items: readonly PromptItem[],
  stored: readonly string[] | null,
): string[] {
  if (stored === null) return defaultSelection(items);
  const chosen = new Set(stored);
  return items.filter((item) => chosen.has(item.id)).map((item) => item.id);
}

export function isDefaultSelection(
  items: readonly PromptItem[],
  selected: readonly string[],
): boolean {
  const defaults = defaultSelection(items);
  const chosen = new Set(selected);
  return defaults.length === chosen.size && defaults.every((id) => chosen.has(id));
}

/** `selected` with `id` flipped, in library order. */
export function toggleSelection(
  items: readonly PromptItem[],
  selected: readonly string[],
  id: string,
): string[] {
  const chosen = new Set(selected);
  if (!chosen.delete(id)) chosen.add(id);
  return items.filter((item) => chosen.has(item.id)).map((item) => item.id);
}

/** The instructions to append: one entry per selected item, in library order. */
export function composePrompt(items: readonly PromptItem[], selected: readonly string[]): string[] {
  const chosen = new Set(selected);
  return items.filter((item) => chosen.has(item.id)).map((item) => item.text);
}

/** What to call an item in a list: its title, or the start of its instruction. */
export function itemTitle(item: Pick<PromptItem, "title" | "text">): string {
  if (item.title) return item.title;
  const firstLine = item.text.split("\n", 1)[0]?.trim() ?? "";
  return firstLine.length > TITLE_MAX_LENGTH
    ? `${firstLine.slice(0, TITLE_MAX_LENGTH - 1).trimEnd()}…`
    : firstLine;
}
