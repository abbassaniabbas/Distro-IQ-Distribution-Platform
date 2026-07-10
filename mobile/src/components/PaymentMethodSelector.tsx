import { Ionicons } from "@expo/vector-icons";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { colors, radius, spacing, typography } from "../theme";
import type { PaymentMethod } from "../types/domain";

const methods: Array<{ id: PaymentMethod; label: string; icon: keyof typeof Ionicons.glyphMap }> = [
  { id: "cash", label: "Cash", icon: "cash-outline" },
  { id: "transfer", label: "Transfer", icon: "swap-horizontal-outline" },
  { id: "pos", label: "POS", icon: "card-outline" },
  { id: "credit", label: "Credit", icon: "time-outline" }
];

interface PaymentMethodSelectorProps {
  value: PaymentMethod;
  error?: string;
  onChange(value: PaymentMethod): void;
}

export function PaymentMethodSelector({ value, error, onChange }: PaymentMethodSelectorProps) {
  return (
    <>
      <View style={styles.grid}>
        {methods.map((method) => {
          const selected = value === method.id;
          return (
            <Pressable
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              key={method.id}
              onPress={() => onChange(method.id)}
              style={({ pressed }) => [
                styles.option,
                selected && styles.selected,
                pressed && styles.pressed
              ]}
            >
              <Ionicons name={method.icon} size={20} color={selected ? colors.green : colors.textMuted} />
              <Text style={[styles.label, selected && styles.selectedLabel]}>{method.label}</Text>
            </Pressable>
          );
        })}
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </>
  );
}

const styles = StyleSheet.create({
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs
  },
  option: {
    minHeight: 48,
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    flexBasis: "48%",
    flexDirection: "row",
    flexGrow: 1,
    gap: spacing.xs,
    justifyContent: "center",
    paddingHorizontal: spacing.sm
  },
  selected: { backgroundColor: colors.greenSoft, borderColor: colors.green },
  label: { color: colors.textMuted, fontSize: typography.label, fontWeight: "700" },
  selectedLabel: { color: colors.navy },
  error: { color: colors.danger, fontSize: typography.caption, marginTop: 6 },
  pressed: { opacity: 0.72 }
});
