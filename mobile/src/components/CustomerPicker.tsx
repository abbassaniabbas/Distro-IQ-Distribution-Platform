import { Ionicons } from "@expo/vector-icons";
import { useMemo, useState } from "react";
import {
  FlatList,
  Modal,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  View
} from "react-native";

import { colors, radius, spacing, typography } from "../theme";
import type { Customer } from "../types/domain";
import { formatMoney } from "../utils/format";

interface CustomerPickerProps {
  customers: Customer[];
  selected?: Customer;
  error?: string;
  onSelect(customer: Customer): void;
}

function customerTypeLabel(type: Customer["type"]): string {
  if (type === "walk_in") return "Walk-in";
  return type.charAt(0).toUpperCase() + type.slice(1);
}

export function CustomerPicker({ customers, selected, error, onSelect }: CustomerPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return customers;
    return customers.filter((customer) => (
      `${customer.name} ${customer.address ?? ""}`.toLowerCase().includes(normalized)
    ));
  }, [customers, query]);

  return (
    <>
      <Pressable
        accessibilityRole="button"
        onPress={() => setOpen(true)}
        style={({ pressed }) => [styles.trigger, error && styles.triggerError, pressed && styles.pressed]}
      >
        <View style={styles.triggerIcon}>
          <Ionicons name="storefront-outline" size={21} color={colors.navy} />
        </View>
        <View style={styles.triggerText}>
          <Text style={selected ? styles.selectedName : styles.placeholder} numberOfLines={1}>
            {selected?.name ?? "Choose customer"}
          </Text>
          <Text style={styles.helper} numberOfLines={1}>
            {selected ? customerTypeLabel(selected.type) : "Supermarket, retailer, or walk-in"}
          </Text>
        </View>
        <Ionicons name="chevron-down" size={20} color={colors.textMuted} />
      </Pressable>
      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Modal animationType="slide" onRequestClose={() => setOpen(false)} visible={open}>
        <SafeAreaView style={styles.modal}>
          <View style={styles.modalHeader}>
            <View>
              <Text style={styles.modalEyebrow}>NEW SALE</Text>
              <Text style={styles.modalTitle}>Choose customer</Text>
            </View>
            <Pressable accessibilityLabel="Close customer list" hitSlop={10} onPress={() => setOpen(false)} style={styles.closeButton}>
              <Ionicons name="close" size={24} color={colors.navy} />
            </Pressable>
          </View>
          <View style={styles.searchWrap}>
            <Ionicons name="search" size={20} color={colors.textMuted} />
            <TextInput
              autoFocus
              autoCapitalize="none"
              onChangeText={setQuery}
              placeholder="Search name or area"
              placeholderTextColor={colors.textMuted}
              style={styles.search}
              value={query}
            />
          </View>
          <FlatList
            contentContainerStyle={styles.list}
            data={filtered}
            keyExtractor={(item) => item.id}
            keyboardShouldPersistTaps="handled"
            ListEmptyComponent={<Text style={styles.empty}>No customer matches this search.</Text>}
            renderItem={({ item }) => (
              <Pressable
                onPress={() => {
                  onSelect(item);
                  setQuery("");
                  setOpen(false);
                }}
                style={({ pressed }) => [styles.customerRow, pressed && styles.pressed]}
              >
                <View style={styles.avatar}>
                  <Text style={styles.avatarText}>{item.name.charAt(0)}</Text>
                </View>
                <View style={styles.customerMain}>
                  <Text style={styles.customerName}>{item.name}</Text>
                  <Text style={styles.customerMeta} numberOfLines={1}>
                    {customerTypeLabel(item.type)}{item.address ? ` · ${item.address}` : ""}
                  </Text>
                </View>
                {item.type !== "walk_in" ? (
                  <View style={styles.creditMeta}>
                    <Text style={styles.creditLabel}>Owes</Text>
                    <Text style={styles.creditValue}>{formatMoney(item.creditBalance)}</Text>
                  </View>
                ) : null}
              </Pressable>
            )}
          />
        </SafeAreaView>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  trigger: {
    minHeight: 68,
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.sm,
    padding: spacing.sm
  },
  triggerError: { borderColor: colors.danger },
  triggerIcon: {
    width: 42,
    height: 42,
    alignItems: "center",
    backgroundColor: colors.greenSoft,
    borderRadius: radius.md,
    justifyContent: "center"
  },
  triggerText: { flex: 1 },
  selectedName: { color: colors.text, fontSize: typography.body, fontWeight: "800" },
  placeholder: { color: colors.text, fontSize: typography.body, fontWeight: "700" },
  helper: { color: colors.textMuted, fontSize: typography.caption, marginTop: 3 },
  error: { color: colors.danger, fontSize: typography.caption, marginTop: 6 },
  pressed: { opacity: 0.72 },
  modal: { backgroundColor: colors.background, flex: 1 },
  modalHeader: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    padding: spacing.md
  },
  modalEyebrow: { color: colors.green, fontSize: 11, fontWeight: "900" },
  modalTitle: { color: colors.navy, fontSize: typography.title, fontWeight: "900", marginTop: 2 },
  closeButton: {
    width: 44,
    height: 44,
    alignItems: "center",
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.md,
    justifyContent: "center"
  },
  searchWrap: {
    minHeight: 50,
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    flexDirection: "row",
    margin: spacing.md,
    paddingHorizontal: spacing.sm
  },
  search: { color: colors.text, flex: 1, fontSize: typography.body, paddingHorizontal: spacing.xs },
  list: { paddingBottom: spacing.xxl, paddingHorizontal: spacing.md },
  customerRow: {
    minHeight: 70,
    alignItems: "center",
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    flexDirection: "row",
    gap: spacing.sm,
    paddingVertical: spacing.sm
  },
  avatar: {
    width: 42,
    height: 42,
    alignItems: "center",
    backgroundColor: colors.navy,
    borderRadius: radius.round,
    justifyContent: "center"
  },
  avatarText: { color: colors.white, fontSize: typography.heading, fontWeight: "900" },
  customerMain: { flex: 1 },
  customerName: { color: colors.text, fontSize: typography.body, fontWeight: "800" },
  customerMeta: { color: colors.textMuted, fontSize: typography.caption, marginTop: 3 },
  creditMeta: { alignItems: "flex-end" },
  creditLabel: { color: colors.textMuted, fontSize: 10, fontWeight: "700" },
  creditValue: { color: colors.text, fontSize: typography.label, fontWeight: "800", marginTop: 2 },
  empty: { color: colors.textMuted, fontSize: typography.body, paddingVertical: spacing.xxl, textAlign: "center" }
});
