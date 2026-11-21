import type { PluginTheme } from "@getpaseo/plugin";
import {
  useComposer,
  useSettings,
  type PluginComposer,
  type PluginComposerItemProps,
} from "@getpaseo/plugin/client";
import { Icon, Modal as HostModal, ScrollView, useToast } from "@getpaseo/plugin/client/ui";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Modal,
  Pressable,
  Text,
  View,
  useWindowDimensions,
  type LayoutChangeEvent,
} from "react-native";
import {
  SELECTION_KEY,
  defaultSelection,
  effectiveSelection,
  isDefaultSelection,
  library,
  readSelection,
  selectionPatch,
  toggleSelection,
  type PromptItem,
} from "../shared/library";
import { PromptRow } from "./checklist";

const TITLE = "System prompt";
const ICON = "ListChecks";
const NO_ITEMS: readonly PromptItem[] = [];
const SHEET_CLOSE_TIMEOUT_MS = 500;

interface PickerActions {
  /** Opens the screen where the prompt items are edited. */
  openSettings(): void;
}

/**
 * The composer control that picks a new session's prompt items. It renders nothing in a running
 * agent's composer: the choice is made with the first message.
 */
export function createPromptPicker(actions: PickerActions) {
  return function PromptPicker(props: PluginComposerItemProps) {
    const composer = useComposer();
    if (composer.context === "agent") return null;
    return <DraftPromptPicker {...props} composer={composer} actions={actions} />;
  };
}

type Library =
  | { status: "loading" }
  | { status: "ready"; items: readonly PromptItem[] }
  | { status: "failed"; error: string; retry(): void };

function useLibrary(): Library {
  const settings = useSettings(library);
  return useMemo<Library>(() => {
    if (settings.status === "loading") return { status: "loading" };
    if (settings.status === "ready") return { status: "ready", items: settings.values.items };
    return { status: "failed", error: settings.error, retry: () => void settings.reload() };
  }, [settings]);
}

/** The session's selection and the commands that change it. */
function useSelection(composer: PluginComposer, items: readonly PromptItem[]) {
  const toast = useToast();
  const stored = composer.agent.metadata[SELECTION_KEY];
  const selected = useMemo(
    () => effectiveSelection(items, readSelection({ [SELECTION_KEY]: stored })),
    [items, stored],
  );
  // Two quick ticks land before the composer re-renders; each must build on the one before it.
  const latest = useRef(selected);
  latest.current = selected;

  const apply = useCallback(
    (next: string[]) => {
      latest.current = next;
      // Matching the defaults clears the choice, so an untouched draft keeps following them.
      const patch = selectionPatch(isDefaultSelection(items, next) ? null : next);
      composer.setMetadata(patch).catch((error: unknown) => {
        toast.error(error instanceof Error ? error.message : String(error));
      });
    },
    [composer, items, toast],
  );
  const toggle = useCallback(
    (id: string) => apply(toggleSelection(items, latest.current, id)),
    [apply, items],
  );
  const reset = useCallback(() => apply(defaultSelection(items)), [apply, items]);
  const modified = useMemo(() => !isDefaultSelection(items, selected), [items, selected]);
  return { selected, modified, toggle, reset };
}

/**
 * Whether Paseo placed this item in the toolbar or in the overflow sheet. Paseo does not say, but
 * the two lay out differently: the toolbar is a row that hugs its items, the sheet a column that
 * stretches them. A phone only ever uses the sheet.
 */
function useSurface(compact: boolean) {
  const [surface, setSurface] = useState<"toolbar" | "sheet">(compact ? "sheet" : "toolbar");
  const decided = useRef(compact);
  const widths = useRef({ outer: 0, inner: 0 });
  const decide = useCallback(() => {
    const { outer, inner } = widths.current;
    if (decided.current || outer === 0 || inner === 0) return;
    decided.current = true;
    if (outer - inner > 24) setSurface("sheet");
  }, []);
  const onOuterLayout = useCallback(
    (event: LayoutChangeEvent) => {
      widths.current.outer = event.nativeEvent.layout.width;
      decide();
    },
    [decide],
  );
  const onInnerLayout = useCallback(
    (event: LayoutChangeEvent) => {
      widths.current.inner = event.nativeEvent.layout.width;
      decide();
    },
    [decide],
  );
  return { surface, onOuterLayout, onInnerLayout };
}

function DraftPromptPicker({
  theme,
  layout,
  composer,
  actions,
}: PluginComposerItemProps & { composer: PluginComposer; actions: PickerActions }) {
  const state = useLibrary();
  const items = state.status === "ready" ? state.items : NO_ITEMS;
  const selection = useSelection(composer, items);
  const { surface, onOuterLayout, onInnerLayout } = useSurface(layout.compact);
  const [open, setOpen] = useState(false);

  const close = useCallback(() => {
    setOpen(false);
    // Hands the keyboard back to the prompt, as Paseo's own pickers do.
    composer.focus().catch(() => undefined);
  }, [composer]);
  const openSettings = useCallback(() => {
    setOpen(false);
    // Focusing the prompt makes Paseo close the sheet this item may sit in, which would otherwise
    // stay open over the settings screen. A composer that cannot take focus must not block it.
    const settled = composer.focus().catch(() => undefined);
    const timeout = new Promise<void>((resolve) => setTimeout(resolve, SHEET_CLOSE_TIMEOUT_MS));
    void Promise.race([settled, timeout]).then(actions.openSettings);
  }, [actions, composer]);

  if (state.status === "loading") return null;

  const body = (
    <PickerBody
      state={state}
      selection={selection}
      theme={theme}
      touch={surface === "sheet" || layout.platform !== "web"}
      scrolls={surface === "toolbar" && layout.platform === "web"}
      onOpenSettings={openSettings}
    />
  );

  if (surface === "sheet") {
    return (
      <SheetSection theme={theme} summary={summarize(state, selection.selected.length)}>
        {body}
      </SheetSection>
    );
  }

  return (
    <View onLayout={onOuterLayout}>
      <View style={hugContent} onLayout={onInnerLayout}>
        <Dropdown
          theme={theme}
          anchored={layout.platform === "web"}
          open={open}
          onOpen={setOpen}
          onClose={close}
          trigger={{
            label: triggerLabel(state, selection.selected.length),
            description: `${TITLE}: ${summarize(state, selection.selected.length)}`,
            emphasized: selection.modified,
            warning: state.status === "failed",
            touch: layout.platform !== "web",
          }}
        >
          {body}
        </Dropdown>
      </View>
    </View>
  );
}

const hugContent = { alignSelf: "flex-start" } as const;

function triggerLabel(state: Library, selectedCount: number): string | null {
  if (state.status !== "ready" || state.items.length === 0) return null;
  return `${selectedCount}/${state.items.length}`;
}

function summarize(state: Library, selectedCount: number): string {
  if (state.status !== "ready") return "unavailable";
  if (state.items.length === 0) return "no items yet";
  return `${selectedCount} of ${state.items.length} selected`;
}

interface TriggerView {
  /** The count beside the icon; `null` shows the icon alone. */
  label: string | null;
  description: string;
  /** The selection differs from the defaults. */
  emphasized: boolean;
  warning: boolean;
  touch: boolean;
}

const POPOVER_WIDTH = 340;
const POPOVER_GAP = 6;
const SCREEN_MARGIN = 8;
/** Below this much room above the trigger, the list opens downwards instead. */
const MIN_ROOM_ABOVE = 260;

interface Anchor {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The toolbar control: a pill that opens the list beside itself. On web the list is anchored to
 * the pill like Paseo's own pickers; on a tablet it opens in Paseo's dialog.
 */
function Dropdown({
  theme,
  anchored,
  open,
  onOpen,
  onClose,
  trigger,
  children,
}: {
  theme: PluginTheme;
  anchored: boolean;
  open: boolean;
  onOpen(open: boolean): void;
  onClose(): void;
  trigger: TriggerView;
  children: ReactNode;
}) {
  const triggerRef = useRef<View>(null);
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const [hovered, setHovered] = useState(false);
  const viewport = useWindowDimensions();

  const press = useCallback(() => {
    if (open) return onClose();
    if (!anchored) return onOpen(true);
    triggerRef.current?.measureInWindow((x, y, width, height) => {
      setAnchor({ x, y, width, height });
      onOpen(true);
    });
  }, [anchored, onClose, onOpen, open]);
  const hoverIn = useCallback(() => setHovered(true), []);
  const hoverOut = useCallback(() => setHovered(false), []);
  const changeHostModal = useCallback(
    (next: boolean) => (next ? onOpen(true) : onClose()),
    [onClose, onOpen],
  );

  // A resized window moves the trigger out from under an anchored list.
  const openedAt = useRef(viewport);
  useEffect(() => {
    if (!open) {
      openedAt.current = viewport;
    } else if (
      anchored &&
      (openedAt.current.width !== viewport.width || openedAt.current.height !== viewport.height)
    ) {
      onClose();
    }
  }, [anchored, onClose, open, viewport]);

  const tint = trigger.warning
    ? theme.colors.statusWarning
    : trigger.emphasized
      ? theme.colors.foreground
      : theme.colors.foregroundMuted;
  const styles = useMemo(() => {
    const height = trigger.touch ? 36 : 28;
    return {
      trigger: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 4,
        height,
        minWidth: height,
        justifyContent: "center" as const,
        paddingHorizontal: trigger.label ? 8 : 0,
        borderRadius: height / 2,
        backgroundColor: hovered || open ? theme.colors.surface2 : "transparent",
      },
      label: {
        color: tint,
        fontSize: 14,
        fontWeight: trigger.emphasized ? ("500" as const) : ("normal" as const),
        fontVariant: ["tabular-nums" as const],
      },
      backdrop: { position: "absolute" as const, top: 0, right: 0, bottom: 0, left: 0 },
      heading: { color: theme.colors.foreground },
    };
  }, [hovered, open, theme, tint, trigger.emphasized, trigger.label, trigger.touch]);
  const popover = useMemo(
    () => (anchor ? placePopover(anchor, viewport, theme) : null),
    [anchor, theme, viewport],
  );
  const icon = useMemo(
    () => <Icon name={ICON} size={18} color={theme.colors.foreground} />,
    [theme],
  );

  return (
    <>
      <Pressable
        ref={triggerRef}
        accessibilityRole="button"
        accessibilityLabel={trigger.description}
        aria-expanded={open}
        onPress={press}
        onHoverIn={hoverIn}
        onHoverOut={hoverOut}
        style={styles.trigger}
        testID="flexi-prompt-trigger"
      >
        <Icon name={ICON} size={trigger.touch ? 20 : 16} color={tint} />
        {trigger.label ? (
          <>
            <Text style={styles.label} numberOfLines={1}>
              {trigger.label}
            </Text>
            <Icon name="ChevronDown" size={14} color={theme.colors.foregroundMuted} />
          </>
        ) : null}
      </Pressable>
      {anchored ? (
        <Modal visible={open && popover !== null} transparent onRequestClose={onClose}>
          {popover ? (
            <View style={popover} testID="flexi-prompt-popover">
              {children}
            </View>
          ) : null}
          {/* After the list, so opening puts keyboard focus on the first item, not on this. */}
          <Pressable
            aria-hidden
            focusable={false}
            onPress={onClose}
            style={styles.backdrop}
            testID="flexi-prompt-backdrop"
          />
        </Modal>
      ) : (
        <HostModal title={TITLE} icon={icon} open={open} onOpenChange={changeHostModal}>
          <HostModal.Content contentContainerStyle={edgeToEdge}>{children}</HostModal.Content>
        </HostModal>
      )}
    </>
  );
}

const edgeToEdge = { padding: 0, gap: 0 } as const;

/** Above the trigger when there is room, as the composer sits at the bottom; otherwise below. */
function placePopover(
  anchor: Anchor,
  window: { width: number; height: number },
  theme: PluginTheme,
) {
  const width = Math.min(POPOVER_WIDTH, window.width - SCREEN_MARGIN * 2);
  const left = Math.max(
    SCREEN_MARGIN,
    Math.min(anchor.x, window.width - width - SCREEN_MARGIN),
  );
  const roomAbove = anchor.y - POPOVER_GAP - SCREEN_MARGIN;
  const roomBelow = window.height - (anchor.y + anchor.height) - POPOVER_GAP - SCREEN_MARGIN;
  const above = roomAbove >= MIN_ROOM_ABOVE || roomAbove >= roomBelow;
  return {
    position: "absolute" as const,
    // Above the backdrop, which follows it in the tree.
    zIndex: 1,
    left,
    width,
    ...(above
      ? { bottom: window.height - anchor.y + POPOVER_GAP, maxHeight: roomAbove }
      : { top: anchor.y + anchor.height + POPOVER_GAP, maxHeight: roomBelow }),
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface1,
    overflow: "hidden" as const,
    shadowColor: "#000",
    shadowOpacity: 0.25,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 8 },
    elevation: 12,
  };
}

/** The picker laid out in the composer's overflow sheet, where it is a section of the sheet. */
function SheetSection({
  theme,
  summary,
  children,
}: {
  theme: PluginTheme;
  summary: string;
  children: ReactNode;
}) {
  const styles = useMemo(
    () => ({
      card: {
        marginHorizontal: -4,
        borderRadius: 16,
        backgroundColor: theme.colors.surface1,
        overflow: "hidden" as const,
      },
      header: {
        minHeight: 44,
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 8,
        paddingHorizontal: 16,
      },
      icon: { width: 20, alignItems: "center" as const },
      title: { flex: 1, color: theme.colors.foreground, fontSize: 14 },
      summary: { color: theme.colors.foregroundMuted, fontSize: 14 },
    }),
    [theme],
  );
  return (
    <View style={styles.card} testID="flexi-prompt-sheet-section">
      <View style={styles.header}>
        <View style={styles.icon}>
          <Icon name={ICON} size={16} color={theme.colors.foregroundMuted} />
        </View>
        <Text style={styles.title} numberOfLines={1}>
          {TITLE}
        </Text>
        <Text style={styles.summary} numberOfLines={1}>
          {summary}
        </Text>
      </View>
      {children}
    </View>
  );
}

/** What the picker shows wherever it opens: the items to tick, or how to get some. */
function PickerBody({
  state,
  selection,
  theme,
  touch,
  scrolls,
  onOpenSettings,
}: {
  state: Exclude<Library, { status: "loading" }>;
  selection: ReturnType<typeof useSelection>;
  theme: PluginTheme;
  touch: boolean;
  /** The list scrolls on its own. False where the surrounding sheet or dialog already scrolls. */
  scrolls: boolean;
  onOpenSettings(): void;
}) {
  const inset = touch ? 16 : 12;
  const styles = useMemo(
    () => ({
      list: { flexShrink: 1 },
      listContent: { paddingVertical: 4 },
      divider: { height: 1, backgroundColor: theme.colors.border },
      footer: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 8,
        minHeight: touch ? 44 : 36,
        paddingHorizontal: inset,
      },
      hint: { flex: 1, minWidth: 0, color: theme.colors.foregroundMuted, fontSize: 12 },
      message: { padding: inset, gap: 12, alignItems: "flex-start" as const },
      messageTitle: { color: theme.colors.foreground, fontSize: 14, fontWeight: "500" as const },
      messageText: { color: theme.colors.foregroundMuted, fontSize: 13, lineHeight: 18 },
      messageHead: { gap: 4 },
      buttons: { flexDirection: "row" as const, gap: 8 },
    }),
    [inset, theme, touch],
  );

  if (state.status === "failed") {
    return (
      <View style={styles.message}>
        <View style={styles.messageHead}>
          <Text style={styles.messageTitle}>Prompt items could not be loaded</Text>
          <Text style={styles.messageText}>
            {state.error} This session starts without them until that is fixed.
          </Text>
        </View>
        <View style={styles.buttons}>
          <TextButton theme={theme} label="Try again" onPress={state.retry} filled />
          <TextButton theme={theme} label="Open settings" onPress={onOpenSettings} />
        </View>
      </View>
    );
  }

  if (state.items.length === 0) {
    return (
      <View style={styles.message}>
        <View style={styles.messageHead}>
          <Text style={styles.messageTitle}>No prompt items yet</Text>
          <Text style={styles.messageText}>
            Add the instructions you want to choose from, such as “Create a ticket before starting
            work”. Tick or untick them here whenever you start a session.
          </Text>
        </View>
        <TextButton theme={theme} label="Add prompt items" onPress={onOpenSettings} filled />
      </View>
    );
  }

  const chosen = new Set(selection.selected);
  const rows = state.items.map((item) => (
    <PromptRow
      key={item.id}
      item={item}
      checked={chosen.has(item.id)}
      touch={touch}
      theme={theme}
      onToggle={selection.toggle}
    />
  ));
  return (
    <>
      {scrolls ? (
        <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
          {rows}
        </ScrollView>
      ) : (
        <View style={styles.listContent}>{rows}</View>
      )}
      <View style={styles.divider} />
      <View style={styles.footer}>
        <Text style={styles.hint} numberOfLines={1}>
          {selection.modified ? "Changed for this session" : "Your defaults"}
        </Text>
        {selection.modified ? (
          <TextButton theme={theme} label="Reset" onPress={selection.reset} />
        ) : null}
        <TextButton theme={theme} label="Edit items" onPress={onOpenSettings} />
      </View>
    </>
  );
}

function TextButton({
  theme,
  label,
  filled = false,
  onPress,
}: {
  theme: PluginTheme;
  label: string;
  filled?: boolean;
  onPress(): void;
}) {
  const [hovered, setHovered] = useState(false);
  const hoverIn = useCallback(() => setHovered(true), []);
  const hoverOut = useCallback(() => setHovered(false), []);
  const styles = useMemo(() => {
    const rest = filled ? theme.colors.accent : "transparent";
    return {
      button: {
        height: 28,
        paddingHorizontal: filled ? 12 : 8,
        borderRadius: 14,
        justifyContent: "center" as const,
        backgroundColor: hovered && !filled ? theme.colors.surface2 : rest,
        opacity: hovered && filled ? 0.9 : 1,
      },
      label: {
        color: filled ? theme.colors.accentForeground : theme.colors.foreground,
        fontSize: 13,
        fontWeight: "500" as const,
      },
    };
  }, [filled, hovered, theme]);
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      onHoverIn={hoverIn}
      onHoverOut={hoverOut}
      style={styles.button}
    >
      <Text style={styles.label} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}
