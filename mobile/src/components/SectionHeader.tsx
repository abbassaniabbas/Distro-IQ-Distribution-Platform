import { StyleSheet, Text, View } from "react-native";

import { colors, spacing, typography } from "../theme";

interface SectionHeaderProps {
  title: string;
  meta?: string;
}

export function SectionHeader({ title, meta }: SectionHeaderProps) {
  return (
    <View style={styles.row}>
      <Text style={styles.title}>{title}</Text>
      {meta ? <Text style={styles.meta}>{meta}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm,
    justifyContent: "space-between"
  },
  title: {
    color: colors.text,
    flex: 1,
    fontSize: typography.heading,
    fontWeight: "800"
  },
  meta: {
    color: colors.textMuted,
    fontSize: typography.caption,
    fontWeight: "600"
  }
});
