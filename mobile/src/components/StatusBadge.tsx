import { StyleSheet, Text, View } from "react-native";

import { colors, radius, spacing, typography } from "../theme";

interface StatusBadgeProps {
  label: string;
  tone?: "success" | "warning" | "danger" | "neutral";
}

export function StatusBadge({ label, tone = "neutral" }: StatusBadgeProps) {
  return (
    <View style={[styles.badge, styles[`${tone}Badge`]]}>
      <View style={[styles.dot, styles[`${tone}Dot`]]} />
      <Text style={[styles.label, styles[`${tone}Label`]]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    minHeight: 28,
    alignItems: "center",
    alignSelf: "flex-start",
    borderRadius: radius.round,
    flexDirection: "row",
    gap: 6,
    paddingHorizontal: spacing.sm
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: radius.round
  },
  label: {
    fontSize: typography.caption,
    fontWeight: "700"
  },
  successBadge: { backgroundColor: colors.greenSoft },
  warningBadge: { backgroundColor: colors.warningSoft },
  dangerBadge: { backgroundColor: colors.dangerSoft },
  neutralBadge: { backgroundColor: colors.surfaceMuted },
  successDot: { backgroundColor: colors.green },
  warningDot: { backgroundColor: colors.warning },
  dangerDot: { backgroundColor: colors.danger },
  neutralDot: { backgroundColor: colors.textMuted },
  successLabel: { color: colors.green },
  warningLabel: { color: colors.warning },
  dangerLabel: { color: colors.danger },
  neutralLabel: { color: colors.textMuted }
});
