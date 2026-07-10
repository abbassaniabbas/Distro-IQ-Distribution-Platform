import { Ionicons } from "@expo/vector-icons";
import type { BottomTabScreenProps } from "@react-navigation/bottom-tabs";
import { useMemo } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { ActionButton } from "../components/ActionButton";
import { Card } from "../components/Card";
import { OfflineBanner } from "../components/OfflineBanner";
import { SectionHeader } from "../components/SectionHeader";
import { StatusBadge } from "../components/StatusBadge";
import { useSales } from "../state/SalesContext";
import { colors, radius, spacing, typography } from "../theme";
import { dateKey, formatCompactMoney, formatMoney, formatTime, greetingForNow, todayKey } from "../utils/format";
import type { SalesTabsParamList } from "../navigation/types";

type Props = BottomTabScreenProps<SalesTabsParamList, "Today">;

const DAILY_TARGET = 50000;

export function SalesRepDashboardScreen({ navigation }: Props) {
  const {
    assignedStock,
    isOnline,
    pendingSyncCount,
    products,
    sales,
    syncPendingSales,
    user
  } = useSales();

  const todaySales = useMemo(() => sales.filter((sale) => dateKey(sale.createdAt) === todayKey()), [sales]);
  const todayTotal = todaySales.reduce((sum, sale) => sum + sale.total, 0);
  const cashCollected = todaySales
    .filter((sale) => sale.paymentMethod !== "credit")
    .reduce((sum, sale) => sum + sale.total, 0);
  const targetPercent = Math.min(100, (todayTotal / DAILY_TARGET) * 100);
  const availableUnits = assignedStock.reduce((sum, assignment) => sum + assignment.availableQuantity, 0);

  return (
    <SafeAreaView edges={["top"]} style={styles.safeArea}>
      <OfflineBanner isOnline={isOnline} onSync={syncPendingSales} pendingCount={pendingSyncCount} />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <View style={styles.headerCopy}>
            <Text style={styles.greeting}>{greetingForNow()}</Text>
            <Text style={styles.name} numberOfLines={1}>{user.name}</Text>
            <Text style={styles.role}>Sales Representative</Text>
          </View>
          <Pressable accessibilityLabel="Open profile" style={styles.avatar}>
            <Text style={styles.avatarText}>{user.name.split(" ").map((part) => part.charAt(0)).join("")}</Text>
          </Pressable>
        </View>

        <Card style={styles.heroCard}>
          <View style={styles.heroTop}>
            <View>
              <Text style={styles.heroLabel}>TODAY'S SALES</Text>
              <Text style={styles.heroValue}>{formatMoney(todayTotal)}</Text>
            </View>
            <StatusBadge label={isOnline ? "Online" : "Offline"} tone={isOnline ? "success" : "warning"} />
          </View>
          <View style={styles.heroStats}>
            <View style={styles.heroStat}>
              <Text style={styles.heroStatValue}>{todaySales.length}</Text>
              <Text style={styles.heroStatLabel}>Sales</Text>
            </View>
            <View style={styles.heroDivider} />
            <View style={styles.heroStat}>
              <Text style={styles.heroStatValue}>{formatCompactMoney(cashCollected)}</Text>
              <Text style={styles.heroStatLabel}>Collected</Text>
            </View>
            <View style={styles.heroDivider} />
            <View style={styles.heroStat}>
              <Text style={styles.heroStatValue}>{availableUnits}</Text>
              <Text style={styles.heroStatLabel}>Units left</Text>
            </View>
          </View>
        </Card>

        <ActionButton
          icon="add-circle-outline"
          label="Record a sale"
          onPress={() => navigation.navigate("NewSale")}
          style={styles.saleButton}
        />

        <Card>
          <SectionHeader title="Daily target" meta={`${Math.round(targetPercent)}% reached`} />
          <View style={styles.targetNumbers}>
            <Text style={styles.targetCurrent}>{formatMoney(todayTotal)}</Text>
            <Text style={styles.targetGoal}>of {formatMoney(DAILY_TARGET)}</Text>
          </View>
          <View style={styles.progressTrack}>
            <View style={[styles.progressValue, { width: `${targetPercent}%` }]} />
          </View>
        </Card>

        <View style={styles.sectionHeading}>
          <SectionHeader title="Assigned stock" meta={`${availableUnits} units available`} />
        </View>
        <Card style={styles.listCard}>
          {assignedStock.map((assignment, index) => {
            const product = products.find((item) => item.id === assignment.productId);
            if (!product) return null;
            const sold = assignment.assignedQuantity - assignment.availableQuantity;
            const soldPercent = Math.min(100, (sold / assignment.assignedQuantity) * 100);

            return (
              <View key={assignment.id} style={[styles.stockRow, index > 0 && styles.rowBorder]}>
                <View style={styles.productIcon}>
                  <Ionicons name="cube-outline" size={22} color={colors.green} />
                </View>
                <View style={styles.stockMain}>
                  <Text style={styles.rowTitle} numberOfLines={1}>{product.name}</Text>
                  <Text style={styles.rowMeta}>{formatMoney(product.unitPrice)} per {product.unit}</Text>
                  <View style={styles.smallTrack}>
                    <View style={[styles.smallProgress, { width: `${soldPercent}%` }]} />
                  </View>
                </View>
                <View style={styles.stockCount}>
                  <Text style={styles.stockValue}>{assignment.availableQuantity}</Text>
                  <Text style={styles.stockLabel}>left</Text>
                </View>
              </View>
            );
          })}
        </Card>

        <View style={styles.sectionHeading}>
          <SectionHeader title="Recent sales" meta="Today" />
        </View>
        <Card style={styles.listCard}>
          {todaySales.length ? todaySales.slice(0, 3).map((sale, index) => (
            <View key={sale.id} style={[styles.saleRow, index > 0 && styles.rowBorder]}>
              <View style={[styles.productIcon, styles.saleIcon]}>
                <Ionicons name="receipt-outline" size={21} color={colors.navy} />
              </View>
              <View style={styles.stockMain}>
                <Text style={styles.rowTitle} numberOfLines={1}>{sale.customerName}</Text>
                <Text style={styles.rowMeta}>{sale.lines.reduce((sum, line) => sum + line.quantity, 0)} units · {formatTime(sale.createdAt)}</Text>
              </View>
              <View style={styles.saleValueWrap}>
                <Text style={styles.saleValue}>{formatMoney(sale.total)}</Text>
                <Text style={styles.paymentLabel}>{sale.paymentMethod.toUpperCase()}</Text>
              </View>
            </View>
          )) : (
            <View style={styles.emptyState}>
              <Ionicons name="receipt-outline" size={28} color={colors.textMuted} />
              <Text style={styles.emptyTitle}>No sales yet today</Text>
              <Text style={styles.emptyText}>Your first completed sale will appear here.</Text>
            </View>
          )}
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: colors.background, flex: 1 },
  content: { gap: spacing.md, padding: spacing.md, paddingBottom: spacing.xxl },
  header: { alignItems: "center", flexDirection: "row", gap: spacing.md, justifyContent: "space-between" },
  headerCopy: { flex: 1 },
  greeting: { color: colors.textMuted, fontSize: typography.label, fontWeight: "600" },
  name: { color: colors.navy, fontSize: typography.title, fontWeight: "900", marginTop: 2 },
  role: { color: colors.green, fontSize: typography.caption, fontWeight: "800", marginTop: 3 },
  avatar: { width: 46, height: 46, alignItems: "center", backgroundColor: colors.navy, borderRadius: radius.round, justifyContent: "center" },
  avatarText: { color: colors.white, fontSize: typography.label, fontWeight: "900" },
  heroCard: { backgroundColor: colors.navy, borderColor: colors.navy, padding: spacing.lg },
  heroTop: { alignItems: "flex-start", flexDirection: "row", justifyContent: "space-between" },
  heroLabel: { color: colors.mint, fontSize: 11, fontWeight: "900" },
  heroValue: { color: colors.white, fontSize: 30, fontWeight: "900", marginTop: spacing.xs },
  heroStats: { alignItems: "center", flexDirection: "row", marginTop: spacing.lg },
  heroStat: { flex: 1 },
  heroStatValue: { color: colors.white, fontSize: typography.heading, fontWeight: "900" },
  heroStatLabel: { color: "#B7C4D2", fontSize: typography.caption, marginTop: 3 },
  heroDivider: { backgroundColor: "#35506E", height: 34, marginHorizontal: spacing.sm, width: 1 },
  saleButton: { minHeight: 56 },
  targetNumbers: { alignItems: "baseline", flexDirection: "row", gap: spacing.xs, marginTop: spacing.md },
  targetCurrent: { color: colors.navy, fontSize: typography.title, fontWeight: "900" },
  targetGoal: { color: colors.textMuted, fontSize: typography.label },
  progressTrack: { backgroundColor: colors.surfaceMuted, borderRadius: radius.round, height: 9, marginTop: spacing.sm, overflow: "hidden" },
  progressValue: { backgroundColor: colors.greenBright, borderRadius: radius.round, height: "100%" },
  sectionHeading: { marginTop: spacing.xs },
  listCard: { paddingBottom: 0, paddingTop: 0 },
  stockRow: { alignItems: "center", flexDirection: "row", gap: spacing.sm, minHeight: 82, paddingVertical: spacing.sm },
  rowBorder: { borderTopColor: colors.border, borderTopWidth: 1 },
  productIcon: { width: 42, height: 42, alignItems: "center", backgroundColor: colors.greenSoft, borderRadius: radius.md, justifyContent: "center" },
  stockMain: { flex: 1, minWidth: 0 },
  rowTitle: { color: colors.text, fontSize: typography.label, fontWeight: "800" },
  rowMeta: { color: colors.textMuted, fontSize: typography.caption, marginTop: 4 },
  smallTrack: { backgroundColor: colors.surfaceMuted, borderRadius: radius.round, height: 4, marginTop: spacing.xs, overflow: "hidden" },
  smallProgress: { backgroundColor: colors.greenBright, borderRadius: radius.round, height: "100%" },
  stockCount: { alignItems: "flex-end" },
  stockValue: { color: colors.navy, fontSize: typography.heading, fontWeight: "900" },
  stockLabel: { color: colors.textMuted, fontSize: typography.caption },
  saleRow: { alignItems: "center", flexDirection: "row", gap: spacing.sm, minHeight: 72, paddingVertical: spacing.sm },
  saleIcon: { backgroundColor: colors.surfaceMuted },
  saleValueWrap: { alignItems: "flex-end" },
  saleValue: { color: colors.text, fontSize: typography.label, fontWeight: "900" },
  paymentLabel: { color: colors.green, fontSize: 10, fontWeight: "900", marginTop: 4 },
  emptyState: { alignItems: "center", minHeight: 150, justifyContent: "center", padding: spacing.lg },
  emptyTitle: { color: colors.text, fontSize: typography.body, fontWeight: "800", marginTop: spacing.sm },
  emptyText: { color: colors.textMuted, fontSize: typography.caption, marginTop: spacing.xs, textAlign: "center" }
});
