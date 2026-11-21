import type { PluginTheme } from "@getpaseo/plugin";
import { useSettings, type PluginSurfaceProps, type SettingsState } from "@getpaseo/plugin/client";
import {
  Icon,
  Modal,
  SettingsAction,
  SettingsCard,
  SettingsRow,
  SettingsSection,
  TextInput,
  useToast,
} from "@getpaseo/plugin/client/ui";
import { useCallback, useMemo, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { TITLE_MAX_LENGTH, itemTitle, library, type PromptItem } from "../shared/library";
import { Checkbox } from "./checklist";

type ReadyLibrary = Extract<SettingsState<typeof library.schema>, { status: "ready" }>;

/** The item being edited; `index` is `null` while it is new. */
interface Draft {
  index: number | null;
  item: PromptItem;
}

function newItem(): PromptItem {
  const id = `item-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  return { id, title: "", text: "", enabledByDefault: true };
}

export function LibrarySettings({ theme, layout }: PluginSurfaceProps) {
  const settings = useSettings(library);
  const text = useMemo(() => ({ color: theme.colors.foregroundMuted, fontSize: 14 }), [theme]);
  if (settings.status === "loading") return <Text style={text}>Loading prompt items…</Text>;
  if (settings.status !== "ready") {
    return (
      <SettingsSection title="Prompt items">
        <SettingsCard>
          <SettingsAction
            label="Prompt items could not be loaded"
            hint={settings.error}
            actionLabel="Try again"
            onPress={settings.reload}
          />
          {settings.status === "invalid" ? (
            <SettingsAction
              label="Start over"
              hint="Deletes every saved prompt item."
              actionLabel="Reset"
              onPress={settings.reset}
            />
          ) : null}
        </SettingsCard>
      </SettingsSection>
    );
  }
  return <LibraryEditor settings={settings} theme={theme} compact={layout.compact} />;
}

function LibraryEditor({
  settings,
  theme,
  compact,
}: {
  settings: ReadyLibrary;
  theme: PluginTheme;
  compact: boolean;
}) {
  const toast = useToast();
  const [draft, setDraft] = useState<Draft | null>(null);
  const items = settings.values.items;
  // Commands read the newest saved list, so an edit made on another device is not overwritten.
  const latest = useRef(settings);
  latest.current = settings;

  const save = useCallback(
    async (change: (items: readonly PromptItem[]) => PromptItem[]): Promise<boolean> => {
      const current = latest.current;
      const saved = await current.save(
        { ...current.values, items: change(current.values.items) },
        current.revision,
      );
      if (!saved) toast.error("Could not save the prompt items. Try again.");
      return saved;
    },
    [toast],
  );

  const add = useCallback(() => setDraft({ index: null, item: newItem() }), []);
  const edit = useCallback(
    (id: string) => {
      const index = latest.current.values.items.findIndex((item) => item.id === id);
      const item = latest.current.values.items[index];
      if (item) setDraft({ index, item });
    },
    [],
  );
  const closeEditor = useCallback(() => setDraft(null), []);
  const toggleDefault = useCallback(
    (id: string) =>
      void save((current) =>
        current.map((item) =>
          item.id === id ? { ...item, enabledByDefault: !item.enabledByDefault } : item,
        ),
      ),
    [save],
  );
  const move = useCallback(
    (id: string, offset: -1 | 1) =>
      void save((current) => {
        const from = current.findIndex((item) => item.id === id);
        const to = from + offset;
        const next = [...current];
        const moved = next[from];
        if (!moved || to < 0 || to >= next.length) return next;
        next.splice(from, 1);
        next.splice(to, 0, moved);
        return next;
      }),
    [save],
  );
  const commit = useCallback(
    async (item: PromptItem) => {
      const saved = await save((current) =>
        current.some((candidate) => candidate.id === item.id)
          ? current.map((candidate) => (candidate.id === item.id ? item : candidate))
          : [...current, item],
      );
      if (saved) setDraft(null);
    },
    [save],
  );
  const remove = useCallback(
    async (id: string) => {
      const saved = await save((current) => current.filter((item) => item.id !== id));
      if (saved) setDraft(null);
    },
    [save],
  );

  const styles = useMemo(
    () => ({
      intro: { color: theme.colors.foregroundMuted, fontSize: 14, lineHeight: 20 },
      empty: { padding: 24, gap: 12, alignItems: "center" as const },
      emptyTitle: { color: theme.colors.foreground, fontSize: 14, fontWeight: "500" as const },
      emptyText: {
        color: theme.colors.foregroundMuted,
        fontSize: 13,
        lineHeight: 18,
        textAlign: "center" as const,
        maxWidth: 420,
      },
      error: { color: theme.colors.statusDanger, fontSize: 13 },
    }),
    [theme],
  );
  const addButton = useMemo(
    () => <Button theme={theme} label="Add item" icon="Plus" onPress={add} testID="flexi-prompt-add" />,
    [add, theme],
  );

  return (
    <>
      <SettingsSection title="Prompt items" trailing={items.length > 0 ? addButton : undefined}>
        <Text style={styles.intro}>
          Instructions added to the system prompt of the sessions you start. Tick the ones a session
          should begin with; you can change the choice in the composer before sending the first
          message.
        </Text>
        <SettingsCard>
          {items.length === 0 ? (
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>No prompt items yet</Text>
              <Text style={styles.emptyText}>
                Add one instruction per item, such as “Create or assign a ticket when starting new
                work”, so each can be switched on or off for a session.
              </Text>
              <Button
                theme={theme}
                label="Add item"
                icon="Plus"
                filled
                onPress={add}
                testID="flexi-prompt-add"
              />
            </View>
          ) : (
            items.map((item, index) => (
              <ItemRow
                key={item.id}
                item={item}
                first={index === 0}
                last={index === items.length - 1}
                compact={compact}
                disabled={settings.saving}
                theme={theme}
                onEdit={edit}
                onMove={move}
                onToggleDefault={toggleDefault}
              />
            ))
          )}
        </SettingsCard>
        {settings.saveError ? (
          <Text accessibilityRole="alert" style={styles.error}>
            {settings.saveError}
          </Text>
        ) : null}
      </SettingsSection>
      {draft ? (
        <ItemEditor
          // A new draft gets fresh inputs.
          key={draft.item.id}
          draft={draft}
          saving={settings.saving}
          theme={theme}
          onSave={commit}
          onDelete={remove}
          onClose={closeEditor}
        />
      ) : null}
    </>
  );
}

function ItemRow({
  item,
  first,
  last,
  compact,
  disabled,
  theme,
  onEdit,
  onMove,
  onToggleDefault,
}: {
  item: PromptItem;
  first: boolean;
  last: boolean;
  compact: boolean;
  disabled: boolean;
  theme: PluginTheme;
  onEdit(id: string): void;
  onMove(id: string, offset: -1 | 1): void;
  onToggleDefault(id: string): void;
}) {
  const edit = useCallback(() => onEdit(item.id), [item.id, onEdit]);
  const moveUp = useCallback(() => onMove(item.id, -1), [item.id, onMove]);
  const moveDown = useCallback(() => onMove(item.id, 1), [item.id, onMove]);
  const toggle = useCallback(() => onToggleDefault(item.id), [item.id, onToggleDefault]);
  const styles = useMemo(
    () => ({
      controls: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        flexWrap: "wrap" as const,
        justifyContent: "flex-end" as const,
        gap: compact ? 8 : 4,
      },
      default: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 8,
        height: 32,
        paddingHorizontal: 8,
        borderRadius: 16,
        opacity: disabled ? 0.5 : 1,
      },
      defaultLabel: {
        color: item.enabledByDefault ? theme.colors.foreground : theme.colors.foregroundMuted,
        fontSize: 13,
      },
    }),
    [compact, disabled, item.enabledByDefault, theme],
  );
  const title = itemTitle(item);
  return (
    <SettingsRow
      label={title}
      // An unnamed item is listed by the start of its instruction; show the rest when it was cut.
      hint={item.text === title ? undefined : item.text}
      testID={`flexi-prompt-row-${item.id}`}
    >
      <View style={styles.controls}>
        <Pressable
          accessibilityRole="checkbox"
          aria-checked={item.enabledByDefault}
          aria-disabled={disabled}
          accessibilityLabel={`${title}: on by default`}
          disabled={disabled}
          onPress={toggle}
          style={styles.default}
        >
          <Checkbox checked={item.enabledByDefault} theme={theme} />
          <Text style={styles.defaultLabel}>On by default</Text>
        </Pressable>
        <IconButton
          theme={theme}
          icon="ArrowUp"
          label={`Move ${title} up`}
          disabled={disabled || first}
          onPress={moveUp}
        />
        <IconButton
          theme={theme}
          icon="ArrowDown"
          label={`Move ${title} down`}
          disabled={disabled || last}
          onPress={moveDown}
        />
        <IconButton
          theme={theme}
          icon="Pencil"
          label={`Edit ${title}`}
          disabled={disabled}
          onPress={edit}
        />
      </View>
    </SettingsRow>
  );
}

function ItemEditor({
  draft,
  saving,
  theme,
  onSave,
  onDelete,
  onClose,
}: {
  draft: Draft;
  saving: boolean;
  theme: PluginTheme;
  onSave(item: PromptItem): void;
  onDelete(id: string): void;
  onClose(): void;
}) {
  const [title, setTitle] = useState(draft.item.title);
  const [text, setText] = useState(draft.item.text);
  const [enabledByDefault, setEnabledByDefault] = useState(draft.item.enabledByDefault);
  const isNew = draft.index === null;
  const canSave = text.trim().length > 0 && !saving;

  const changeOpen = useCallback((open: boolean) => (open ? undefined : onClose()), [onClose]);
  const toggleDefault = useCallback(() => setEnabledByDefault((value) => !value), []);
  const save = useCallback(() => {
    if (!canSave) return;
    onSave({ id: draft.item.id, title: title.trim(), text: text.trim(), enabledByDefault });
  }, [canSave, draft.item.id, enabledByDefault, onSave, text, title]);
  // Deleting discards text the user wrote, so it takes a second press.
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const remove = useCallback(() => {
    if (confirmingDelete) onDelete(draft.item.id);
    else setConfirmingDelete(true);
  }, [confirmingDelete, draft.item.id, onDelete]);

  const styles = useMemo(() => {
    const input = {
      color: theme.colors.foreground,
      backgroundColor: theme.colors.surface2,
      borderColor: theme.colors.border,
      borderWidth: 1,
      borderRadius: 8,
      paddingHorizontal: 12,
      paddingVertical: 10,
      fontSize: 14,
    };
    return {
      field: { gap: 6 },
      label: { color: theme.colors.foreground, fontSize: 13, fontWeight: "500" as const },
      hint: { color: theme.colors.foregroundMuted, fontSize: 12, lineHeight: 17 },
      input,
      multiline: { ...input, minHeight: 132, lineHeight: 20, textAlignVertical: "top" as const },
      default: { flexDirection: "row" as const, alignItems: "flex-start" as const, gap: 10 },
      defaultBox: { height: 20, justifyContent: "center" as const },
      defaultText: { flex: 1, minWidth: 0, gap: 2 },
      defaultLabel: { color: theme.colors.foreground, fontSize: 14, lineHeight: 20 },
      actions: { flexDirection: "row" as const, alignItems: "center" as const, gap: 8 },
      spacer: { flex: 1 },
    };
  }, [theme]);
  const icon = useMemo(
    () => <Icon name="ListChecks" size={18} color={theme.colors.foreground} />,
    [theme],
  );

  return (
    <Modal
      title={isNew ? "New prompt item" : "Edit prompt item"}
      icon={icon}
      open
      onOpenChange={changeOpen}
    >
      <Modal.Content>
        <View style={styles.field}>
          <Text style={styles.label}>Instruction</Text>
          <TextInput
            accessibilityLabel="Instruction"
            value={text}
            onChangeText={setText}
            placeholder="Create or assign a ticket when starting new work."
            placeholderTextColor={theme.colors.foregroundMuted}
            multiline
            autoFocus={isNew}
            style={styles.multiline}
            testID="flexi-prompt-editor-text"
          />
          <Text style={styles.hint}>Added to the system prompt exactly as written.</Text>
        </View>
        <View style={styles.field}>
          <Text style={styles.label}>Name</Text>
          <TextInput
            accessibilityLabel="Name"
            value={title}
            onChangeText={setTitle}
            placeholder="Ticket"
            placeholderTextColor={theme.colors.foregroundMuted}
            maxLength={TITLE_MAX_LENGTH}
            style={styles.input}
            testID="flexi-prompt-editor-title"
          />
          <Text style={styles.hint}>
            Optional. A short name to recognise it by in the composer; without one the instruction
            itself is shown.
          </Text>
        </View>
        <Pressable
          accessibilityRole="checkbox"
          aria-checked={enabledByDefault}
          accessibilityLabel="On by default"
          onPress={toggleDefault}
          style={styles.default}
          testID="flexi-prompt-editor-default"
        >
          <View style={styles.defaultBox}>
            <Checkbox checked={enabledByDefault} theme={theme} />
          </View>
          <View style={styles.defaultText}>
            <Text style={styles.defaultLabel}>On by default</Text>
            <Text style={styles.hint}>
              New sessions start with this item ticked. Untick it in the composer for a session
              that should not follow it.
            </Text>
          </View>
        </Pressable>
        <View style={styles.actions}>
          {isNew ? null : (
            <Button
              theme={theme}
              label={confirmingDelete ? "Confirm delete" : "Delete"}
              icon="Trash2"
              danger
              disabled={saving}
              onPress={remove}
              testID="flexi-prompt-editor-delete"
            />
          )}
          <View style={styles.spacer} />
          <Button theme={theme} label="Cancel" onPress={onClose} />
          <Button
            theme={theme}
            label={isNew ? "Add item" : "Save"}
            filled
            disabled={!canSave}
            onPress={save}
            testID="flexi-prompt-editor-save"
          />
        </View>
      </Modal.Content>
    </Modal>
  );
}

function Button({
  theme,
  label,
  icon,
  filled = false,
  danger = false,
  disabled = false,
  onPress,
  testID,
}: {
  theme: PluginTheme;
  label: string;
  icon?: string;
  filled?: boolean;
  danger?: boolean;
  disabled?: boolean;
  onPress(): void;
  testID?: string;
}) {
  const [hovered, setHovered] = useState(false);
  const hoverIn = useCallback(() => setHovered(true), []);
  const hoverOut = useCallback(() => setHovered(false), []);
  const color = danger
    ? theme.colors.statusDanger
    : filled
      ? theme.colors.accentForeground
      : theme.colors.foreground;
  const styles = useMemo(
    () => ({
      button: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 6,
        height: 32,
        paddingHorizontal: 12,
        borderRadius: 16,
        borderWidth: filled ? 0 : 1,
        borderColor: theme.colors.border,
        backgroundColor: filled
          ? theme.colors.accent
          : hovered
            ? theme.colors.surface2
            : "transparent",
        opacity: disabled ? 0.5 : hovered && filled ? 0.9 : 1,
      },
      label: { color, fontSize: 13, fontWeight: "500" as const },
    }),
    [color, disabled, filled, hovered, theme],
  );
  return (
    <Pressable
      accessibilityRole="button"
      aria-disabled={disabled}
      disabled={disabled}
      onPress={onPress}
      onHoverIn={hoverIn}
      onHoverOut={hoverOut}
      style={styles.button}
      testID={testID}
    >
      {icon ? <Icon name={icon} size={14} color={color} /> : null}
      <Text style={styles.label} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

function IconButton({
  theme,
  icon,
  label,
  disabled = false,
  onPress,
}: {
  theme: PluginTheme;
  icon: string;
  label: string;
  disabled?: boolean;
  onPress(): void;
}) {
  const [hovered, setHovered] = useState(false);
  const hoverIn = useCallback(() => setHovered(true), []);
  const hoverOut = useCallback(() => setHovered(false), []);
  const style = useMemo(
    () => ({
      width: 32,
      height: 32,
      borderRadius: 16,
      alignItems: "center" as const,
      justifyContent: "center" as const,
      backgroundColor: hovered && !disabled ? theme.colors.surface2 : "transparent",
      opacity: disabled ? 0.35 : 1,
    }),
    [disabled, hovered, theme],
  );
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      aria-disabled={disabled}
      disabled={disabled}
      onPress={onPress}
      onHoverIn={hoverIn}
      onHoverOut={hoverOut}
      style={style}
    >
      <Icon name={icon} size={16} color={theme.colors.foregroundMuted} />
    </Pressable>
  );
}
