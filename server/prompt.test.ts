import type {
  PluginHookAgent,
  PluginHookContext,
  PluginServerContext,
  PluginSessionOpenRequest,
} from "@getpaseo/plugin/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PARENT_AGENT_ID_LABEL,
  selectionPatch,
  type Library,
  type PromptItem,
} from "../shared/library";
import { registerPromptHooks } from "./prompt";

const items: PromptItem[] = [
  { id: "ticket", title: "Ticket", text: "Create a ticket.", enabledByDefault: true },
  { id: "commits", title: "Commits", text: "Use conventional commits.", enabledByDefault: true },
  { id: "tests", title: "", text: "Avoid useless tests.", enabledByDefault: false },
];

type Metadata = Record<string, unknown>;
type SettingsState =
  | { status: "ready"; revision: string; values: Library }
  | { status: "invalid"; revision: string; error: string };

/** The plugin's hooks, registered against a daemon that holds `agents` and the given library. */
function plugin(options: {
  library?: SettingsState;
  agents?: Record<string, Metadata>;
  refresh?: (id: string) => Promise<{ agent: { metadata: Metadata } } | null>;
}) {
  const settings = options.library ?? { status: "ready", revision: "1", values: { items } };
  const agents = options.agents ?? {};
  const writes: { agentId: string; patch: Metadata }[] = [];
  const hooks = new Map<string, (payload: never, context: PluginHookContext) => Promise<unknown>>();
  const server = {
    registerSettings: () => ({ read: async () => settings, subscribe: () => () => {} }),
    addHook: (name: string, handler: never) => {
      hooks.set(name, handler);
      return () => {};
    },
  } as unknown as PluginServerContext;
  const context = {
    signal: new AbortController().signal,
    paseo: {
      agents: {
        ref: (agentId: string) => ({
          refresh:
            options.refresh?.bind(null, agentId) ??
            (async () => (agents[agentId] ? { agent: { metadata: agents[agentId] } } : null)),
          setMetadata: async (patch: Metadata) => void writes.push({ agentId, patch }),
        }),
      },
    },
  } as unknown as PluginHookContext;
  registerPromptHooks(server);

  return {
    writes,
    open(request: Partial<PluginSessionOpenRequest>) {
      const handler = hooks.get("agent.open.before")!;
      return handler({ request: { ...openRequest, ...request } } as never, context) as Promise<
        PluginSessionOpenRequest | undefined
      >;
    },
    async created(agent: Partial<PluginHookAgent>) {
      await hooks.get("agent.create.after")!({ agent: { ...createdAgent, ...agent } } as never, context);
    },
  };
}

const openRequest: PluginSessionOpenRequest = {
  agentId: "agent",
  workspaceId: "workspace",
  provider: "claude",
  cwd: "/project",
  reason: "create",
  purpose: "interactive",
  title: null,
  background: false,
  labels: {},
  metadata: {},
  tools: [],
  env: {},
  mcpServers: {},
};

const createdAgent: PluginHookAgent = {
  id: "agent",
  workspaceId: "workspace",
  parentAgentId: null,
  provider: "claude",
  cwd: "/project",
  title: null,
  background: false,
  metadata: {},
};

afterEach(() => vi.restoreAllMocks());

describe("agent.open.before", () => {
  it("appends the session's own selection after instructions already present", async () => {
    const result = await plugin({}).open({
      metadata: selectionPatch(["tests", "commits"]),
      appendSystemPrompt: ["From another hook."],
    });
    expect(result?.appendSystemPrompt).toEqual([
      "From another hook.",
      "Use conventional commits.",
      "Avoid useless tests.",
    ]);
  });

  it("applies the defaults to a session that never chose", async () => {
    const result = await plugin({}).open({});
    expect(result?.appendSystemPrompt).toEqual(["Create a ticket.", "Use conventional commits."]);
  });

  it("gives an agent spawned by a session that session's selection, not the defaults", async () => {
    const result = await plugin({ agents: { parent: selectionPatch(["tests"]) } }).open({
      labels: { [PARENT_AGENT_ID_LABEL]: "parent" },
    });
    expect(result?.appendSystemPrompt).toEqual(["Avoid useless tests."]);
  });

  it("leaves the request alone when there is nothing to add", async () => {
    const empty: SettingsState = { status: "ready", revision: "1", values: { items: [] } };
    expect(await plugin({ library: empty }).open({})).toBeUndefined();
    expect(await plugin({}).open({ metadata: selectionPatch([]) })).toBeUndefined();
    expect(await plugin({}).open({ purpose: "history" })).toBeUndefined();
  });

  it("still lets the agent open when the library or the parent cannot be read", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const invalid: SettingsState = { status: "invalid", revision: "1", error: "Bad JSON" };
    expect(await plugin({ library: invalid }).open({})).toBeUndefined();

    const unreachable = plugin({
      refresh: async () => {
        throw new Error("Agent not found");
      },
    });
    const result = await unreachable.open({ labels: { [PARENT_AGENT_ID_LABEL]: "gone" } });
    expect(result?.appendSystemPrompt).toEqual(["Create a ticket.", "Use conventional commits."]);
  });
});

describe("agent.create.after", () => {
  it("records the defaults a session started with", async () => {
    const daemon = plugin({});
    await daemon.created({});
    expect(daemon.writes).toEqual([
      { agentId: "agent", patch: selectionPatch(["ticket", "commits"]) },
    ]);
  });

  it("records the selection inherited from the parent", async () => {
    const daemon = plugin({ agents: { parent: selectionPatch(["tests"]) } });
    await daemon.created({ parentAgentId: "parent" });
    expect(daemon.writes).toEqual([{ agentId: "agent", patch: selectionPatch(["tests"]) }]);
  });

  it("writes nothing over an explicit choice or for an empty library", async () => {
    const chosen = plugin({});
    await chosen.created({ metadata: selectionPatch([]) });
    expect(chosen.writes).toEqual([]);

    const empty = plugin({ library: { status: "ready", revision: "1", values: { items: [] } } });
    await empty.created({});
    expect(empty.writes).toEqual([]);
  });
});
