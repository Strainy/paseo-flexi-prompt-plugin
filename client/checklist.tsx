import type { PluginTheme } from "@getpaseo/plugin";
import { Icon } from "@getpaseo/plugin/client/ui";
import { memo, useCallback, useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import type { PromptItem } from "../shared/library";

export function Checkbox({ checked, theme }: { checked: boolean; theme: PluginTheme }) {
  const style = useMemo(
    () => ({
      width: 16,
      height: 16,
      borderRadius: 4,
      borderWidth: 1.5,
      alignItems: "center" as const,
      justifyContent: "center" as const,
      borderColor: checked ? theme.colors.accent : theme.colors.foregroundMuted,
      backgroundColor: checked ? theme.colors.accent : "transparent",
    }),
    [checked, theme],
  );
  return (
    <View style={style}>
      {checked ? <Icon name="Check" size={12} color={theme.colors.accentForeground} /> : null}
    </View>
  );
}

interface PromptRowProps {
  item: PromptItem;
  checked: boolean;
  /** Touch rows are taller and inset to line up with the sheet's own rows. */
  touch: boolean;
  theme: PluginTheme;
  onToggle(id: string): void;
}

/** One prompt item as a checkbox row: its name, and the instruction it stands for underneath. */
export const PromptRow = memo(function PromptRow({
  item,
  checked,
  touch,
  theme,
  onToggle,
}: PromptRowProps) {
  const [hovered, setHovered] = useState(false);
  const hoverIn = useCallback(() => setHovered(true), []);
  const hoverOut = useCallback(() => setHovered(false), []);
  const press = useCallback(() => onToggle(item.id), [item.id, onToggle]);
  const styles = useMemo(
    () => ({
      row: {
        flexDirection: "row" as const,
        alignItems: "flex-start" as const,
        gap: touch ? 12 : 10,
        paddingHorizontal: touch ? 16 : 12,
        paddingVertical: touch ? 12 : 8,
        backgroundColor: hovered ? theme.colors.surface2 : "transparent",
      },
      // Centres the box on the first line of text.
      box: { height: 20, justifyContent: "center" as const },
      text: { flex: 1, minWidth: 0, gap: 2 },
      title: { color: theme.colors.foreground, fontSize: 14, lineHeight: 20 },
      detail: { color: theme.colors.foregroundMuted, fontSize: 12, lineHeight: 17 },
    }),
    [hovered, theme, touch],
  );
  return (
    <Pressable
      accessibilityRole="checkbox"
      aria-checked={checked}
      accessibilityLabel={item.title || item.text}
      onPress={press}
      onHoverIn={hoverIn}
      onHoverOut={hoverOut}
      style={styles.row}
      testID={`flexi-prompt-item-${item.id}`}
    >
      <View style={styles.box}>
        <Checkbox checked={checked} theme={theme} />
      </View>
      <View style={styles.text}>
        {item.title ? (
          <>
            <Text style={styles.title} numberOfLines={1}>
              {item.title}
            </Text>
            <Text style={styles.detail} numberOfLines={2}>
              {item.text}
            </Text>
          </>
        ) : (
          <Text style={styles.title} numberOfLines={3}>
            {item.text}
          </Text>
        )}
      </View>
    </Pressable>
  );
});
