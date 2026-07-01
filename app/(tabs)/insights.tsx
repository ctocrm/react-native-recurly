import { icons } from "@/constants/icons";
import { formatCurrency } from "@/lib/utils";
import { useSubscriptions } from "@/src/context/SubscriptionContext";
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
  Design: "#f5c542",
  "Developer Tools": "#e8def8",
  "AI Tools": "#b8d4e3",
};

const Insights = () => {
  const posthog = usePostHog();
  const { subscriptions } = useSubscriptions();
  const [selectedPeriod, setSelectedPeriod] = useState<Period>("This Month");

  useEffect(() => {
    posthog.capture("insights_viewed");
  }, [posthog]);

  // Calculate total monthly spend and category breakdown
  const { totalMonthlySpend, categoryBreakdown, monthlyChartData } =
    useMemo(() => {
      // Filter active subscriptions — exclude cancelled and paused
      const activeSubs = subscriptions.filter(
        (s) => s.status !== "cancelled" && s.status !== "paused",
      );

      let total = 0;
      const categoryTotals: Record<
        string,
        { total: number; count: number; subscriptions: Subscription[] }
      > = {};

      activeSubs.forEach((sub) => {
        let monthlyAmount = sub.price;
        // Normalize to monthly
        if (sub.billing === "Yearly" || sub.frequency === "Yearly") {
          monthlyAmount = sub.price / 12;
        } else if (sub.billing === "Weekly" || sub.frequency === "Weekly") {
          monthlyAmount = sub.price * 4.33;
        }

        total += monthlyAmount;

        const category = sub.category || "Other";
        if (!categoryTotals[category]) {
          categoryTotals[category] = {
            total: 0,
            count: 0,
            subscriptions: [],
          };
        }
        categoryTotals[category].total += monthlyAmount;
        categoryTotals[category].count += 1;
        categoryTotals[category].subscriptions.push(sub);
      });

      // Sort categories by total spend descending
      const sortedCategories = Object.entries(categoryTotals)
        .map(([name, data]) => ({
          name,
          total: data.total,
          count: data.count,
          subscriptions: data.subscriptions,
        }))
        .sort((a, b) => b.total - a.total);

      // Generate estimated monthly chart data as a run-rate projection
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
          amount: total,
          estimated: i > 0, // past months are estimated, current month is actual run-rate
        });
      }

      return {
        totalMonthlySpend: total,
        categoryBreakdown: sortedCategories,
        monthlyChartData: chartData,
      };
    }, [subscriptions, selectedPeriod]);

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

  const topCategory =
    categoryBreakdown.length > 0 ? categoryBreakdown[0] : null;

  return (
    <SafeAreaView className="flex-1 bg-background">
      <FlatList
        contentContainerClassName="px-5 pb-25"
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
                Total Monthly Spend
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
                    {topCategory ? formatCurrency(topCategory.total) : "$0"}
                  </Text>
                  <Text className="insights-summary-item-label">
                    Most Spent
                  </Text>
                </View>
                <View className="insights-summary-item">
                  <Text className="insights-summary-item-value">
                    {topCategory ? topCategory.name : "-"}
                  </Text>
                  <Text className="insights-summary-item-label">
                    Top Category
                  </Text>
                </View>
              </View>
            </View>

            {/* Category Breakdown */}
            <View className="insights-section-head">
              <Text className="insights-section-title">
                Spending by Category
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

            {/* Estimated Monthly Spending Chart */}
            <View className="insights-section-head mt-5">
              <Text className="insights-section-title">
                Estimated Monthly Spend
              </Text>
            </View>

            <View className="rounded-2xl border border-border bg-muted p-5">
              <View className="insights-chart-scroll flex-row items-end justify-between">
                {monthlyChartData.map((data) => {
                  const barHeight =
                    maxChartAmount > 0
                      ? (data.amount / maxChartAmount) * 120
                      : 0;

                  return (
                    <View
                      key={data.label}
                      className="insights-chart-bar-container"
                    >
                      <Text className="insights-chart-value">
                        {formatCurrency(data.amount)}
                      </Text>
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
              </View>
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
