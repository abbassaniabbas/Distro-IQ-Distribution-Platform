import { Ionicons } from "@expo/vector-icons";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { colors, spacing, typography } from "../theme";

interface OfflineBannerProps {
  isOnline: boolean;
  pendingCount: number;
  onSync(): void;
}

export function OfflineBanner({ isOnline, pendingCount, onSync }: OfflineBannerProps) {
  if (isOnline && pendingCount === 0) return null;

  const title = isOnline ? `${pendingCount} sale${pendingCount === 1 ? "" : "s"} waiting to sync` : "Working offline";

  return (
    <View style={[styles.banner, isOnline ? styles.onlineBanner : styles.offlineBanner]}>
      <Ionicons
        name={isOnline ? "cloud-upload-outline" : "cloud-offline-outline"}
        size={19}
        color={isOnline ? colors.green : colors.warning}
      />
      <Text style={styles.text}>{title}</Text>
      {isOnline ? (
        <Pressable accessibilityRole="button" hitSlop={10} onPress={onSync}>
          <Text style={styles.action}>Sync now</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    minHeight: 42,
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.xs,
    paddingHorizontal: spacing.md
  },
  onlineBanner: { backgroundColor: colors.greenSoft },
  offlineBanner: { backgroundColor: colors.warningSoft },
  text: {
    color: colors.text,
    flex: 1,
    fontSize: typography.label,
    fontWeight: "600"
  },
  action: {
    color: colors.navy,
    fontSize: typography.label,
    fontWeight: "800"
  }
});
