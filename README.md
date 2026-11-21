# Flexi Prompt

A [Paseo](https://paseo.sh) plugin that lets you choose which system prompt instructions apply
each time you start a session.

Keep instructions such as "Create or assign a ticket when starting new work" as separate prompt
items, mark the ones you usually want as on by default, and tick or untick them in the composer
before you send a session's first message.

## Use it

1. Open **Settings → Plugins → Flexi Prompt** (the cog on its row), or run **Flexi Prompt: edit
   prompt items** from the Command Center, and add your prompt items. Each one has:
   - **Instruction**: the text added to the system prompt, exactly as written.
   - **Name**: optional short label for the composer. Without one the instruction itself is shown.
   - **On by default**: whether new sessions start with it ticked.
2. Start a session. The composer shows a checklist control with a count such as `3/4`, in both
   the New workspace composer and a new agent tab. Open it, tick or untick items, and send.

The control only appears until the first message is sent. Items are appended in the order they
are listed in settings; use the arrows there to reorder them.

In a narrow composer, and always on a phone, Paseo moves composer controls into its controls
sheet. The picker appears there as a **System prompt** section.

## How a session gets its instructions

- A session keeps the selection it started with. Changing your defaults later does not change
  sessions that already exist.
- Editing an item's wording does reach existing sessions, the next time each one is opened.
  Deleting an item removes it from them the same way.
- An agent created by another agent follows the selection of the session that created it, so
  unticking an item for a session also keeps it away from that session's subagents.
- Sessions started without the composer, such as `paseo run` or a schedule, get your defaults.
- Sessions that existed before the plugin was installed get your defaults.

The plugin's instructions are added after Paseo's own **Append system prompt** setting
(`daemon.appendSystemPrompt`), which still applies to every session. Move an instruction out of
that setting and into a prompt item to make it optional; otherwise it is sent twice.

## Install

Plugins must be enabled on the daemon (**Settings → Plugins → Enable plugins**). A plugin is
trusted code that runs with the daemon's access, so read the source before installing one.

```bash
paseo plugin add git:Strainy/paseo-flexi-prompt-plugin
paseo plugin ls   # flexi-prompt should be "running"
```

Or paste `git:Strainy/paseo-flexi-prompt-plugin` into **Settings → Plugins → Plugin source**.
Pick up later changes with `paseo plugin update flexi-prompt`.

Requires Paseo 0.17.0-beta.1 or later on both the daemon and the app.

## Where things are stored

| What                    | Where                                                               |
| ----------------------- | ------------------------------------------------------------------- |
| Prompt items            | `~/.paseo/plugin-settings/flexi-prompt/library.json`, shared by every client of the daemon |
| A session's selection   | The agent's metadata, under `flexi-prompt.selection`                |

Removing the plugin deletes the prompt items. Sessions simply stop receiving them.

If the prompt items cannot be read, sessions still start, without the plugin's instructions, and
the reason is logged: `paseo plugin logs flexi-prompt`.

## Develop

Install a checkout instead of the Git source, so edits can be reloaded:

```bash
npm install
paseo plugin install /absolute/path/to/paseo-flexi-prompt-plugin
npm run typecheck
npm test
paseo plugin reload flexi-prompt   # apply source changes
```

| Path                 | What it holds                                                              |
| -------------------- | -------------------------------------------------------------------------- |
| `shared/library.ts`  | The prompt item settings and the selection rules, used by both sides.      |
| `server/prompt.ts`   | Daemon hooks: append the instructions on open, record the selection on create. |
| `client/picker.tsx`  | The composer control.                                                      |
| `client/settings.tsx`| The prompt items screen.                                                   |
