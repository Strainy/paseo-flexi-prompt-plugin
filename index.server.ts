import type { PluginServerContext } from "@getpaseo/plugin/server";
import { registerPromptHooks } from "./server/prompt";

export default function contribute(server: PluginServerContext) {
  registerPromptHooks(server);
  return () => {};
}
