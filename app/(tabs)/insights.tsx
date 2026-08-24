import { icons } from "@/constants/icons";
import { useSubscriptions } from "@/context/SubscriptionContext";
import { useBottomClearance } from "@/hooks/useBottomClearance";
import { useChargeDisplay } from "@/hooks/useChargeDisplay";
import { formatCurrency } from "@/lib/utils";
import { thisMonthInsights } from "@/services/emailscan";
import { styled } from "nativewind";
import { usePostHog } from "posthog-react-native";
import React, { useEffect, useMemo, useState } from "react";
import {
  FlatList,
  Image,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { SafeAreaView as RNSafeAreaView } from "react-native-safe-area-context";

const SafeAreaView = styled(RNSafeAreaView);

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

const PERIODS = [
  "This Month",
  "Last 3 Months",
  "Last 6 Months",
  "Year",
] as const;
type Period = (typeof PERIODS)[number];

const categoryIcons: Record<string, any> = {
  Design: icons.adobe,
  "Developer Tools": icons.github,
  "AI Tools": icons.claude,
};

const categoryColors: Record<string, string> = {
  Design: "#ff8c42",
  "Developer Tools": "#e8def8",
  "AI Tools": "#b8d4e3",
  Entertainment: "#f5c542",
  Productivity: "#8fd1bd",
  Cloud: "#b8e8d0",
  Music: "#d4a8e8",
  Other: "#c4c4c4",
};

const Insights = () => {
  const { tabListPadding, pagePadding } = useBottomClearance();
  const posthog = usePostHog();
  const { subscriptions } = useSubscriptions();
  const { messages } = useChargeDisplay(subscriptions);
  const [selectedPeriod, setSelectedPeriod] = useState<Period>("This Month");

  useEffect(() => {
    posthog.capture("insights_viewed");
  }, [posthog]);

  // Calculate total monthly spend and category breakdown
  const { totalMonthlySpend, categoryBreakdown, monthlyChartData, merchants } =
    useMemo(() => {
      const insights = thisMonthInsights(subscriptions, messages);
      const categoryTotals = [
        { name: "recurring", total: insights.kinds.recurring },
        { name: "sparse", total: insights.kinds.sparse },
        { name: "free", total: insights.kinds.free },
      ].filter((row) => row.total > 0 || row.name !== "free");

      const currentMonth = new Date().getMonth();
      const monthsToShow =
        selectedPeriod === "This Month"
          ? 1
          : selectedPeriod === "Last 3 Months"
            ? 3
            : selectedPeriod === "Last 6 Months"
              ? 6
              : 12;

      const chartData: { label: string; amount: number; estimated: boolean }[] =
        [];
      for (let i = monthsToShow - 1; i >= 0; i--) {
        const monthIndex = (((currentMonth - i) % 12) + 12) % 12;
        chartData.push({
          label: MONTHS[monthIndex],
          amount: insights.total,
          estimated: i > 0,
        });
      }

      return {
        totalMonthlySpend: insights.total,
        categoryBreakdown: categoryTotals,
        monthlyChartData: chartData,
        merchants: insights.merchants,
      };
    }, [messages, selectedPeriod, subscriptions]);

  const maxCategorySpend =
    categoryBreakdown.length > 0
      ? Math.max(...categoryBreakdown.map((c) => c.total))
      : 1;

  const maxChartAmount =
    monthlyChartData.length > 0
      ? Math.max(...monthlyChartData.map((d) => d.amount))
      : 1;

  const totalSubs = subscriptions.filter(
    (s) => s.status !== "cancelled" && s.status !== "paused",
  ).length;

  return (
    <SafeAreaView
      edges={["top", "left", "right"]}
      className="flex-1 bg-background"
      style={{ paddingBottom: pagePadding }}
    >
      <FlatList
        contentContainerClassName="px-5"
        contentContainerStyle={{ paddingBottom: tabListPadding }}
        ListHeaderComponent={
          <>
            {/* Header */}
            <View className="insights-header">
              <Text className="insights-title">Insights</Text>
              <Pressable
                className="insights-period"
                onPress={() => {
                  const idx = PERIODS.indexOf(selectedPeriod);
                  setSelectedPeriod(PERIODS[(idx + 1) % PERIODS.length]);
                  posthog.capture("insights_period_changed", {
                    period: PERIODS[(idx + 1) % PERIODS.length],
                  });
                }}
              >
                <Text className="insights-period-text">{selectedPeriod}</Text>
                <Image
                  source={icons.back}
                  className="insights-period-icon -rotate-90"
                />
              </Pressable>
            </View>

            {/* Summary Card */}
            <View className="insights-summary-card">
              <Text className="insights-summary-label">
                This month actuals
              </Text>
              <Text className="insights-summary-amount">
                {formatCurrency(totalMonthlySpend)}
              </Text>
              <View className="insights-summary-row">
                <View className="insights-summary-item">
                  <Text className="insights-summary-item-value">
                    {totalSubs}
                  </Text>
                  <Text className="insights-summary-item-label">
                    Total Subs
                  </Text>
                </View>
                <View className="insights-summary-item">
                  <Text className="insights-summary-item-value">
                    {merchants[0] ? formatCurrency(merchants[0].amount) : "$0"}
                  </Text>
                  <Text className="insights-summary-item-label">
                    Top merchant
                  </Text>
                </View>
                <View className="insights-summary-item">
                  <Text className="insights-summary-item-value">
                    {merchants[0] ? merchants[0].name : "-"}
                  </Text>
                  <Text className="insights-summary-item-label">
                    Top merchant
                  </Text>
                </View>
              </View>
            </View>

            {/* Category Breakdown */}
            <View className="insights-section-head">
              <Text className="insights-section-title">
                This month by kind
              </Text>
            </View>

            {categoryBreakdown.map((category) => {
              const barWidth =
                maxCategorySpend > 0
                  ? (category.total / maxCategorySpend) * 100
                  : 0;
              const icon = categoryIcons[category.name] || icons.activity;
              const color = categoryColors[category.name] || "#ea7a53";

              return (
                <Pressable
                  key={category.name}
                  className={`insights-category-row mb-4 rounded-2xl border border-border bg-card p-4`}
                >
                  <View
                    className="size-10 items-center justify-center rounded-lg"
                    style={{ backgroundColor: color }}
                  >
                    <Image source={icon} className="size-6" />
                  </View>
                  <View className="insights-category-info ml-3">
                    <View className="flex-row items-center justify-between">
                      <Text className="insights-category-name">
                        {category.name}
                      </Text>
                      <Text className="insights-category-spend">
                        {formatCurrency(category.total)}
                      </Text>
                    </View>
                    <View className="insights-category-bar-bg">
                      <View
                        className="insights-category-bar"
                        style={{ width: `${barWidth}%` }}
                      />
                    </View>
                  </View>
                </Pressable>
              );
            })}

            <View className="insights-section-head mt-2">
              <Text className="insights-section-title">Top merchants</Text>
            </View>
            {merchants.slice(0, 5).map((row) => (
              <View
                key={row.name}
                className="mb-3 flex-row items-center justify-between rounded-2xl border border-border bg-card p-4"
              >
                <View>
                  <Text className="insights-category-name">{row.name}</Text>
                  <Text className="sub-meta">{row.kind}</Text>
                </View>
                <Text className="insights-category-spend">
                  {formatCurrency(row.amount)}
                </Text>
              </View>
            ))}

            {/* Estimated Monthly Spending Chart */}
            <View className="insights-section-head mt-5">
              <Text className="insights-section-title">
                Estimated Monthly Spend
              </Text>
            </View>

            <View className="overflow-hidden rounded-2xl border border-border bg-muted p-5">
              <ScrollView
                horizontal
                nestedScrollEnabled
                showsHorizontalScrollIndicator={monthlyChartData.length > 3}
                className="insights-chart-scroll w-full"
                contentContainerStyle={{
                  flexDirection: "row",
                  alignItems: "flex-end",
                  paddingRight: 8,
                }}
              >
                {monthlyChartData.map((data) => {
                  const barHeight =
                    maxChartAmount > 0
                      ? (data.amount / maxChartAmount) * 120
                      : 0;
                  const showValue = monthlyChartData.length <= 3;

                  return (
                    <View
                      key={data.label}
                      className="insights-chart-bar-container"
                      style={{ width: 56 }}
                    >
                      {showValue ? (
                        <Text className="insights-chart-value">
                          {formatCurrency(data.amount)}
                        </Text>
                      ) : null}
                      <View
                        className="insights-chart-bar-bg"
                        style={{ height: 120 }}
                      >
                        <View
                          className="insights-chart-bar"
                          style={{
                            height: barHeight as any,
                            backgroundColor:
                              data.label ===
                              monthlyChartData[monthlyChartData.length - 1]
                                ?.label
                                ? "#ea7a53"
                                : data.estimated
                                  ? "#f7d44c"
                                  : "#ea7a53",
                          }}
                        />
                      </View>
                      <Text className="insights-chart-label">{data.label}</Text>
                    </View>
                  );
                })}
              </ScrollView>
            </View>

            {/* Period selector chips */}
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              className="mt-5"
            >
              <View className="insights-month-scroll flex-row gap-2">
                {PERIODS.map((period) => (
                  <Pressable
                    key={period}
                    className={`insights-month-chip ${
                      period === selectedPeriod
                        ? "insights-month-chip-active"
                        : ""
                    }`}
                    onPress={() => {
                      setSelectedPeriod(period);
                      posthog.capture("insights_period_changed", { period });
                    }}
                  >
                    <Text
                      className={`insights-month-chip-text ${
                        period === selectedPeriod
                          ? "insights-month-chip-text-active"
                          : ""
                      }`}
                    >
                      {period}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </ScrollView>

            {/* Bottom spacing */}
            <View className="h-4" />
          </>
        }
        data={[]}
        renderItem={() => null}
        showsVerticalScrollIndicator={false}
      />
    </SafeAreaView>
  );
};

export default Insights;
