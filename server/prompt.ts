import type { PluginHookContext, PluginServerContext } from "@getpaseo/plugin/server";
import {
  PARENT_AGENT_ID_LABEL,
  composePrompt,
  effectiveSelection,
  library,
  readSelection,
  selectionPatch,
  type PromptItem,
} from "../shared/library";

type Paseo = PluginHookContext["paseo"];

const PARENT_LOOKUP_TIMEOUT_MS = 5_000;

interface AgentFacts {
  metadata: Readonly<Record<string, unknown>>;
  parentAgentId: string | null;
}

/** A parent's stored selection, or `null` when it has none or cannot be read in time. */
async function readParentSelection(paseo: Paseo, parentAgentId: string): Promise<string[] | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), PARENT_LOOKUP_TIMEOUT_MS);
    });
    const parent = await Promise.race([paseo.agents.ref(parentAgentId).refresh(), timeout]);
    return readSelection(parent?.agent.metadata);
  } catch (error) {
    console.error(`Could not read the selection of parent agent ${parentAgentId}`, error);
    return null;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * The items an agent runs with: its own selection, else the selection of the agent that created
 * it, else the defaults. An agent spawned by a session follows that session's choices.
 */
async function resolveSelection(
  paseo: Paseo,
  agent: AgentFacts,
  items: readonly PromptItem[],
): Promise<string[]> {
  const own = readSelection(agent.metadata);
  if (own) return effectiveSelection(items, own);
  const inherited = agent.parentAgentId
    ? await readParentSelection(paseo, agent.parentAgentId)
    : null;
  return effectiveSelection(items, inherited);
}

export function registerPromptHooks(server: PluginServerContext): void {
  const settings = server.registerSettings(library);

  async function readItems(): Promise<readonly PromptItem[]> {
    const state = await settings.read();
    if (state.status === "ready") return state.values.items;
    console.error(`Prompt items are unreadable, so none were applied: ${state.error}`);
    return [];
  }

  // Runs on every session open, so edits to an item's wording reach existing sessions the next
  // time they are opened. Never throws: a failure here would stop the agent from opening.
  server.addHook("agent.open.before", async ({ request }, { paseo }) => {
    if (request.purpose === "history") return;
    try {
      const items = await readItems();
      if (items.length === 0) return;
      const selected = await resolveSelection(
        paseo,
        {
          metadata: request.metadata,
          parentAgentId: request.labels[PARENT_AGENT_ID_LABEL] ?? null,
        },
        items,
      );
      const instructions = composePrompt(items, selected);
      if (instructions.length === 0) return;
      return {
        ...request,
        appendSystemPrompt: [...(request.appendSystemPrompt ?? []), ...instructions],
      };
    } catch (error) {
      console.error(`Could not apply prompt items to agent ${request.agentId}`, error);
      return;
    }
  });

  // Records what a new session started with, so changing the defaults later leaves it alone.
  server.addHook("agent.create.after", async ({ agent }, { paseo }) => {
    if (readSelection(agent.metadata)) return;
    const items = await readItems();
    if (items.length === 0) return;
    const selected = await resolveSelection(paseo, agent, items);
    await paseo.agents.ref(agent.id).setMetadata(selectionPatch(selected));
  });
}
