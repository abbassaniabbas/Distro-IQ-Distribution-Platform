import { Ionicons } from "@expo/vector-icons";
import { Pressable, StyleSheet, TextInput, View } from "react-native";

import { colors, radius, spacing, typography } from "../theme";

interface QuantityStepperProps {
  value: number;
  maximum: number;
  onChange(value: number): void;
}

export function QuantityStepper({ value, maximum, onChange }: QuantityStepperProps) {
  return (
    <View style={styles.wrap}>
      <Pressable
        accessibilityLabel="Reduce quantity"
        accessibilityRole="button"
        disabled={value === 0}
        onPress={() => onChange(Math.max(0, value - 1))}
        style={({ pressed }) => [styles.button, value === 0 && styles.disabled, pressed && styles.pressed]}
      >
        <Ionicons name="remove" size={20} color={colors.navy} />
      </Pressable>
      <TextInput
        accessibilityLabel="Quantity"
        keyboardType="number-pad"
        maxLength={4}
        onChangeText={(text) => {
          const next = Number.parseInt(text.replace(/\D/g, ""), 10);
          onChange(Math.min(maximum, Number.isFinite(next) ? next : 0));
        }}
        selectTextOnFocus
        style={styles.value}
        value={String(value)}
      />
      <Pressable
        accessibilityLabel="Increase quantity"
        accessibilityRole="button"
        disabled={value >= maximum}
        onPress={() => onChange(Math.min(maximum, value + 1))}
        style={({ pressed }) => [styles.button, value >= maximum && styles.disabled, pressed && styles.pressed]}
      >
        <Ionicons name="add" size={20} color={colors.navy} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.xs
  },
  button: {
    width: 44,
    height: 44,
    alignItems: "center",
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.md,
    justifyContent: "center"
  },
  value: {
    color: colors.text,
    fontSize: typography.heading,
    fontVariant: ["tabular-nums"],
    fontWeight: "800",
    minWidth: 42,
    paddingHorizontal: 2,
    paddingVertical: 0,
    textAlign: "center"
  },
  disabled: { opacity: 0.35 },
  pressed: { opacity: 0.7 }
});
