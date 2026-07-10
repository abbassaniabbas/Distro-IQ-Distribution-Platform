import { ActivityIndicator, StyleSheet, Text, View } from "react-native";

import { colors, spacing, typography } from "../theme";

export function LoadingScreen() {
  return (
    <View style={styles.screen}>
      <View style={styles.mark}><Text style={styles.markText}>D</Text></View>
      <ActivityIndicator color={colors.green} size="large" />
      <Text style={styles.text}>Opening your day...</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    alignItems: "center",
    backgroundColor: colors.background,
    flex: 1,
    gap: spacing.md,
    justifyContent: "center"
  },
  mark: {
    width: 64,
    height: 64,
    alignItems: "center",
    backgroundColor: colors.navy,
    borderRadius: 8,
    justifyContent: "center",
    marginBottom: spacing.sm
  },
  markText: { color: colors.white, fontSize: 34, fontWeight: "900" },
  text: { color: colors.textMuted, fontSize: typography.body, fontWeight: "600" }
});
