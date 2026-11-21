import type { PluginClientContext } from "@getpaseo/plugin/client";
import { createPromptPicker } from "./client/picker";
import { LibrarySettings } from "./client/settings";

const SETTINGS_ID = "library";

export default function contribute(client: PluginClientContext) {
  client.addSettingsScreen({
    id: SETTINGS_ID,
    title: "Prompt items",
    icon: "ListChecks",
    Component: LibrarySettings,
  });
  client.addComposerItem({
    id: "picker",
    Component: createPromptPicker({ openSettings: () => client.openSettings(SETTINGS_ID) }),
  });
  client.addCommandCenterItem({
    id: "edit-items",
    title: "Flexi Prompt: edit prompt items",
    icon: "ListChecks",
    keywords: ["system prompt", "instructions"],
    context: "global",
    onSelect({ openSettings }) {
      openSettings(SETTINGS_ID);
    },
  });
  return () => {};
}
