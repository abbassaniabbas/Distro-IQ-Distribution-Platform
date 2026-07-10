import { Ionicons } from "@expo/vector-icons";
import type { BottomTabScreenProps } from "@react-navigation/bottom-tabs";
import { useMemo, useState } from "react";
import {
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { ActionButton } from "../components/ActionButton";
import { Card } from "../components/Card";
import { CustomerPicker } from "../components/CustomerPicker";
import { OfflineBanner } from "../components/OfflineBanner";
import { PaymentMethodSelector } from "../components/PaymentMethodSelector";
import { QuantityStepper } from "../components/QuantityStepper";
import { SectionHeader } from "../components/SectionHeader";
import type { SalesTabsParamList } from "../navigation/types";
import { useSales } from "../state/SalesContext";
import { colors, radius, shadow, spacing, typography } from "../theme";
import type { PaymentMethod, Sale } from "../types/domain";
import { formatMoney } from "../utils/format";
import { type SaleValidationErrors, validateSaleDraft } from "../utils/validation";

type Props = BottomTabScreenProps<SalesTabsParamList, "NewSale">;

export function NewSaleScreen({ navigation }: Props) {
  const {
    assignedStock,
    createSale,
    customers,
    isOnline,
    pendingSyncCount,
    products,
    syncPendingSales
  } = useSales();
  const [customerId, setCustomerId] = useState("");
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("cash");
  const [notes, setNotes] = useState("");
  const [errors, setErrors] = useState<SaleValidationErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [completedSale, setCompletedSale] = useState<Sale | null>(null);

  const selectedCustomer = customers.find((customer) => customer.id === customerId);
  const productRows = useMemo(() => assignedStock.map((assignment) => ({
    assignment,
    product: products.find((product) => product.id === assignment.productId)
  })).filter((row): row is { assignment: typeof assignedStock[number]; product: typeof products[number] } => Boolean(row.product)), [assignedStock, products]);

  const lines = useMemo(() => productRows.flatMap(({ assignment, product }) => {
    const quantity = quantities[product.id] ?? 0;
    if (quantity <= 0) return [];
    return [{
      productId: product.id,
      productName: product.name,
      quantity: Math.min(quantity, assignment.availableQuantity),
      unitPrice: product.unitPrice,
      lineTotal: Math.min(quantity, assignment.availableQuantity) * product.unitPrice
    }];
  }), [productRows, quantities]);

  const total = lines.reduce((sum, line) => sum + line.lineTotal, 0);
  const selectedUnits = lines.reduce((sum, line) => sum + line.quantity, 0);
  const availableCredit = selectedCustomer
    ? Math.max(0, selectedCustomer.creditLimit - selectedCustomer.creditBalance)
    : 0;

  function resetForm() {
    setCustomerId("");
    setQuantities({});
    setPaymentMethod("cash");
    setNotes("");
    setErrors({});
  }

  async function submitSale() {
    Keyboard.dismiss();
    const draft = { customerId, lines, paymentMethod, notes };
    const nextErrors = validateSaleDraft(draft, selectedCustomer);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;

    setSubmitting(true);
    try {
      const sale = await createSale(draft);
      setCompletedSale(sale);
      resetForm();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <SafeAreaView edges={["top"]} style={styles.safeArea}>
      <OfflineBanner isOnline={isOnline} onSync={syncPendingSales} pendingCount={pendingSyncCount} />
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.keyboardArea}>
        <View style={styles.header}>
          <View>
            <Text style={styles.eyebrow}>QUICK ENTRY</Text>
            <Text style={styles.title}>New sale</Text>
          </View>
          <View style={styles.secureBadge}>
            <Ionicons name="shield-checkmark-outline" size={17} color={colors.green} />
            <Text style={styles.secureText}>Saved locally</Text>
          </View>
        </View>

        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.section}>
            <SectionHeader title="1. Customer" />
            <CustomerPicker
              customers={customers}
              error={errors.customer}
              onSelect={(customer) => {
                setCustomerId(customer.id);
                setErrors((current) => ({ ...current, customer: undefined, payment: undefined }));
              }}
              selected={selectedCustomer}
            />
            {paymentMethod === "credit" && selectedCustomer?.type !== "walk_in" ? (
              <View style={styles.creditNote}>
                <Ionicons name="wallet-outline" size={18} color={colors.green} />
                <Text style={styles.creditText}>{formatMoney(availableCredit)} credit available</Text>
              </View>
            ) : null}
          </View>

          <View style={styles.section}>
            <SectionHeader title="2. Products" meta={`${selectedUnits} units selected`} />
            {productRows.map(({ assignment, product }) => {
              const quantity = quantities[product.id] ?? 0;
              return (
                <Card key={product.id} style={[styles.productCard, quantity > 0 && styles.productSelected]}>
                  <View style={styles.productTop}>
                    <View style={styles.productMark}>
                      <Ionicons name="cube-outline" size={22} color={colors.green} />
                    </View>
                    <View style={styles.productMain}>
                      <Text style={styles.productName} numberOfLines={2}>{product.name}</Text>
                      <Text style={styles.productDescription} numberOfLines={1}>{product.description}</Text>
                    </View>
                  </View>
                  <View style={styles.productBottom}>
                    <View>
                      <Text style={styles.productPrice}>{formatMoney(product.unitPrice)}</Text>
                      <Text style={styles.stockLabel}>{assignment.availableQuantity} available</Text>
                    </View>
                    <QuantityStepper
                      maximum={assignment.availableQuantity}
                      onChange={(value) => {
                        setQuantities((current) => ({ ...current, [product.id]: value }));
                        setErrors((current) => ({ ...current, products: undefined }));
                      }}
                      value={quantity}
                    />
                  </View>
                  {quantity > 0 ? (
                    <View style={styles.lineTotal}>
                      <Text style={styles.lineTotalLabel}>{quantity} × {formatMoney(product.unitPrice)}</Text>
                      <Text style={styles.lineTotalValue}>{formatMoney(quantity * product.unitPrice)}</Text>
                    </View>
                  ) : null}
                </Card>
              );
            })}
            {errors.products ? <Text style={styles.error}>{errors.products}</Text> : null}
          </View>

          <View style={styles.section}>
            <SectionHeader title="3. Payment" />
            <PaymentMethodSelector
              error={errors.payment}
              onChange={(value) => {
                setPaymentMethod(value);
                setErrors((current) => ({ ...current, payment: undefined }));
              }}
              value={paymentMethod}
            />
          </View>

          <View style={styles.section}>
            <Text style={styles.notesLabel}>Note <Text style={styles.optional}>(optional)</Text></Text>
            <TextInput
              maxLength={180}
              multiline
              onChangeText={setNotes}
              placeholder="Add a short note"
              placeholderTextColor={colors.textMuted}
              style={styles.notesInput}
              textAlignVertical="top"
              value={notes}
            />
          </View>
        </ScrollView>

        <View style={styles.footer}>
          <View>
            <Text style={styles.totalLabel}>TOTAL</Text>
            <Text style={styles.totalValue}>{formatMoney(total)}</Text>
          </View>
          <ActionButton
            disabled={total === 0}
            icon="checkmark-circle-outline"
            label="Complete sale"
            loading={submitting}
            onPress={submitSale}
            style={styles.completeButton}
          />
        </View>
      </KeyboardAvoidingView>

      <Modal animationType="fade" transparent visible={Boolean(completedSale)}>
        <View style={styles.successBackdrop}>
          <View style={styles.successCard}>
            <View style={styles.successIcon}>
              <Ionicons name="checkmark" size={34} color={colors.white} />
            </View>
            <Text style={styles.successTitle}>Sale recorded</Text>
            <Text style={styles.successText}>
              {completedSale ? `${formatMoney(completedSale.total)} from ${completedSale.customerName}` : ""}
            </Text>
            <View style={styles.receiptRow}>
              <Text style={styles.receiptLabel}>Reference</Text>
              <Text style={styles.receiptValue}>{completedSale?.id}</Text>
            </View>
            <ActionButton
              label="Back to today"
              onPress={() => {
                setCompletedSale(null);
                navigation.navigate("Today");
              }}
              style={styles.successAction}
            />
            <Pressable
              onPress={() => setCompletedSale(null)}
              style={styles.anotherButton}
            >
              <Text style={styles.anotherText}>Record another sale</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: colors.background, flex: 1 },
  keyboardArea: { flex: 1 },
  header: { alignItems: "center", backgroundColor: colors.surface, borderBottomColor: colors.border, borderBottomWidth: 1, flexDirection: "row", justifyContent: "space-between", paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  eyebrow: { color: colors.green, fontSize: 10, fontWeight: "900" },
  title: { color: colors.navy, fontSize: typography.title, fontWeight: "900", marginTop: 2 },
  secureBadge: { alignItems: "center", backgroundColor: colors.greenSoft, borderRadius: radius.round, flexDirection: "row", gap: 5, minHeight: 30, paddingHorizontal: spacing.sm },
  secureText: { color: colors.green, fontSize: 11, fontWeight: "800" },
  content: { gap: spacing.xl, padding: spacing.md, paddingBottom: spacing.xxl },
  section: { gap: spacing.sm },
  creditNote: { alignItems: "center", backgroundColor: colors.greenSoft, borderRadius: radius.md, flexDirection: "row", gap: spacing.xs, minHeight: 42, paddingHorizontal: spacing.sm },
  creditText: { color: colors.green, fontSize: typography.label, fontWeight: "800" },
  productCard: { gap: spacing.sm, padding: spacing.sm },
  productSelected: { borderColor: colors.green, borderWidth: 1.5 },
  productTop: { alignItems: "center", flexDirection: "row", gap: spacing.sm },
  productMark: { width: 42, height: 42, alignItems: "center", backgroundColor: colors.greenSoft, borderRadius: radius.md, justifyContent: "center" },
  productMain: { flex: 1, minWidth: 0 },
  productName: { color: colors.text, fontSize: typography.label, fontWeight: "900" },
  productDescription: { color: colors.textMuted, fontSize: typography.caption, marginTop: 3 },
  productBottom: { alignItems: "center", borderTopColor: colors.border, borderTopWidth: 1, flexDirection: "row", justifyContent: "space-between", paddingTop: spacing.sm },
  productPrice: { color: colors.navy, fontSize: typography.body, fontWeight: "900" },
  stockLabel: { color: colors.textMuted, fontSize: typography.caption, marginTop: 2 },
  lineTotal: { alignItems: "center", backgroundColor: colors.greenSoft, borderRadius: radius.sm, flexDirection: "row", justifyContent: "space-between", minHeight: 34, paddingHorizontal: spacing.sm },
  lineTotalLabel: { color: colors.green, fontSize: typography.caption, fontWeight: "700" },
  lineTotalValue: { color: colors.navy, fontSize: typography.label, fontWeight: "900" },
  error: { color: colors.danger, fontSize: typography.caption },
  notesLabel: { color: colors.text, fontSize: typography.label, fontWeight: "800" },
  optional: { color: colors.textMuted, fontWeight: "500" },
  notesInput: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radius.md, borderWidth: 1, color: colors.text, fontSize: typography.body, minHeight: 78, padding: spacing.sm },
  footer: { alignItems: "center", backgroundColor: colors.surface, borderTopColor: colors.border, borderTopWidth: 1, flexDirection: "row", gap: spacing.md, justifyContent: "space-between", padding: spacing.sm, paddingHorizontal: spacing.md, ...shadow },
  totalLabel: { color: colors.textMuted, fontSize: 10, fontWeight: "900" },
  totalValue: { color: colors.navy, fontSize: typography.title, fontWeight: "900", marginTop: 2 },
  completeButton: { flex: 1, maxWidth: 205 },
  successBackdrop: { alignItems: "center", backgroundColor: "rgba(11, 31, 58, 0.55)", flex: 1, justifyContent: "center", padding: spacing.lg },
  successCard: { alignItems: "center", backgroundColor: colors.surface, borderRadius: radius.md, maxWidth: 380, padding: spacing.xl, width: "100%", ...shadow },
  successIcon: { width: 62, height: 62, alignItems: "center", backgroundColor: colors.green, borderRadius: radius.round, justifyContent: "center" },
  successTitle: { color: colors.navy, fontSize: 24, fontWeight: "900", marginTop: spacing.md },
  successText: { color: colors.textMuted, fontSize: typography.body, marginTop: spacing.xs, textAlign: "center" },
  receiptRow: { alignItems: "center", alignSelf: "stretch", backgroundColor: colors.surfaceMuted, borderRadius: radius.md, flexDirection: "row", justifyContent: "space-between", marginTop: spacing.lg, minHeight: 48, paddingHorizontal: spacing.sm },
  receiptLabel: { color: colors.textMuted, fontSize: typography.caption, fontWeight: "700" },
  receiptValue: { color: colors.text, fontSize: typography.label, fontWeight: "900" },
  successAction: { alignSelf: "stretch", marginTop: spacing.md },
  anotherButton: { minHeight: 46, alignItems: "center", justifyContent: "center", marginTop: spacing.xs },
  anotherText: { color: colors.navy, fontSize: typography.label, fontWeight: "800" }
});
