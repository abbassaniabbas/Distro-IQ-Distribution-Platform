import { Ionicons } from "@expo/vector-icons";
import { ActivityIndicator, Pressable, StyleSheet, Text, type ViewStyle } from "react-native";

import { colors, radius, spacing, typography } from "../theme";

interface ActionButtonProps {
  label: string;
  onPress(): void;
  icon?: keyof typeof Ionicons.glyphMap;
  variant?: "primary" | "secondary" | "quiet";
  disabled?: boolean;
  loading?: boolean;
  style?: ViewStyle;
}

export function ActionButton({
  label,
  onPress,
  icon,
  variant = "primary",
  disabled = false,
  loading = false,
  style
}: ActionButtonProps) {
  const isDisabled = disabled || loading;

  return (
    <Pressable
      accessibilityRole="button"
      disabled={isDisabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        styles[variant],
        isDisabled && styles.disabled,
        pressed && !isDisabled && styles.pressed,
        style
      ]}
    >
      {loading ? (
        <ActivityIndicator color={variant === "primary" ? colors.white : colors.navy} />
      ) : (
        <>
          {icon ? <Ionicons name={icon} size={20} color={variant === "primary" ? colors.white : colors.navy} /> : null}
          <Text style={[styles.label, variant !== "primary" && styles.darkLabel]}>{label}</Text>
        </>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: 50,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: spacing.xs,
    paddingHorizontal: spacing.lg
  },
  primary: {
    backgroundColor: colors.navy
  },
  secondary: {
    backgroundColor: colors.greenSoft,
    borderColor: colors.greenBright,
    borderWidth: 1
  },
  quiet: {
    backgroundColor: colors.surfaceMuted
  },
  label: {
    color: colors.white,
    fontSize: typography.body,
    fontWeight: "700"
  },
  darkLabel: {
    color: colors.navy
  },
  disabled: {
    opacity: 0.5
  },
  pressed: {
    opacity: 0.82
  }
});
