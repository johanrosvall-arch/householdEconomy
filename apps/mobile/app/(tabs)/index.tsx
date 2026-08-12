import { useCallback, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { addMonths, formatMoney, periodProgress } from '@household/shared';
import { api } from '../../src/api/client';
import { useHouseholdId } from '../../src/store/session';
import { Card, ErrorNotice, Loading, Money, Pill, ProgressBar, SectionTitle } from '../../src/components/ui';
import { DonutChart, DonutLegend } from '../../src/components/DonutChart';
import { theme } from '../../src/theme';

/**
 * The overview. One question — "where did our cash go this month, and are we
 * fine?" — answered above the fold, with the detail underneath.
 */
export default function OverviewScreen() {
  const householdId = useHouseholdId();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();

  const [period, setPeriod] = useState<string>(() => new Date().toISOString().slice(0, 7));

  const overview = useQuery({
    queryKey: ['overview', householdId, period],
    queryFn: () => api.overview(householdId, period),
  });

  const sync = useMutation({
    mutationFn: () => api.syncAll(householdId),
    onSuccess: () => queryClient.invalidateQueries(),
  });

  const onRefresh = useCallback(() => {
    sync.mutate();
  }, [sync]);

  if (overview.isPending) return <Loading label="Hämtar din översikt" />;
  if (overview.isError) {
    return (
      <View style={{ padding: theme.space(4), paddingTop: insets.top + theme.space(4) }}>
        <ErrorNotice message={(overview.error as Error).message} onRetry={() => overview.refetch()} />
      </View>
    );
  }

  const data = overview.data;
  const isCurrentMonth = period === new Date().toISOString().slice(0, 7);
  const progress = periodProgress(period);

  const slices = data.byGroup.map((group) => ({
    label: group.groupName,
    amount: group.amount,
    color: group.color,
  }));

  return (
    <ScrollView
      style={{ backgroundColor: theme.color.background }}
      contentContainerStyle={[
        styles.container,
        { paddingTop: insets.top + theme.space(3), paddingBottom: insets.bottom + theme.space(10) },
      ]}
      refreshControl={
        <RefreshControl
          refreshing={sync.isPending}
          onRefresh={onRefresh}
          tintColor={theme.color.accent}
        />
      }
    >
      <PeriodSwitcher period={period} onChange={setPeriod} />

      <Card>
        <Text style={styles.cardLabel}>Kvar denna månad</Text>
        <Money amount={data.net} size="xxl" colorise />

        <View style={styles.summaryRow}>
          <Summary label="Inkomst" amount={data.income} tone="positive" />
          <Summary label="Utgifter" amount={-data.spend} />
          <Summary label="Sparat" amount={data.savedToGoals} tone="accent" />
        </View>

        {isCurrentMonth ? (
          <View style={styles.projection}>
            <ProgressBar value={progress} height={4} color={theme.color.textFaint} />
            <Text style={styles.projectionText}>
              {formatMoney(data.dailyBurnRate)}/dag · beräknat {formatMoney(data.projectedSpend, 'SEK', { compact: true })} vid månadens slut
            </Text>
          </View>
        ) : null}
      </Card>

      {data.staleAccountIds.length > 0 ? (
        <Card style={{ borderColor: theme.color.warning, marginTop: theme.space(3) }}>
          <Text style={styles.warningTitle}>Bankkoppling behöver förnyas</Text>
          <Text style={styles.warningBody}>
            {data.staleAccountIds.length} konto(n) uppdateras inte längre. Enligt PSD2 måste du
            godkänna åtkomsten på nytt var 90:e dag.
          </Text>
        </Card>
      ) : null}

      {data.uncategorisedCount > 0 ? (
        <Card style={{ marginTop: theme.space(3) }}>
          <View style={styles.inlineRow}>
            <Text style={styles.cardLabel}>Okategoriserat</Text>
            <Pill label={`${data.uncategorisedCount} st`} color={theme.color.warning} />
          </View>
          <Text style={styles.warningBody}>
            Kategorisera dem så blir översikten mer träffsäker — appen lär sig av dina val.
          </Text>
        </Card>
      ) : null}

      <SectionTitle>Vart pengarna gick</SectionTitle>
      <Card>
        {slices.length === 0 ? (
          <Text style={styles.emptyText}>Inga utgifter registrerade den här månaden.</Text>
        ) : (
          <>
            <DonutChart slices={slices} currency={data.currency} centerLabel="Utgifter" />
            <DonutLegend slices={slices} currency={data.currency} />
          </>
        )}
      </Card>

      {data.topCategories.length > 0 ? (
        <>
          <SectionTitle>Största kategorier</SectionTitle>
          <Card>
            {data.topCategories.map((category, index) => (
              <View
                key={category.categorySlug}
                style={[styles.categoryRow, index > 0 && styles.divider]}
              >
                <View style={[styles.categoryDot, { backgroundColor: category.color }]} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.categoryName}>{category.categoryName}</Text>
                  <Text style={styles.categoryMeta}>
                    {category.transactionCount} köp
                    {category.changeVsPrevious != null
                      ? ` · ${formatChange(category.changeVsPrevious)} mot förra månaden`
                      : ''}
                  </Text>
                </View>
                <Money amount={-category.amount} size="md" />
              </View>
            ))}
          </Card>
        </>
      ) : null}

      {data.trend.length > 1 ? (
        <>
          <SectionTitle>Senaste månaderna</SectionTitle>
          <Card>
            <TrendBars trend={data.trend} />
          </Card>
        </>
      ) : null}

      <SectionTitle>Nettoförmögenhet</SectionTitle>
      <Card>
        <Money amount={data.netWorth} size="xl" />
        <Text style={styles.cardLabel}>Summa över alla konton</Text>
      </Card>
    </ScrollView>
  );
}

function PeriodSwitcher({
  period,
  onChange,
}: {
  period: string;
  onChange: (period: string) => void;
}) {
  const current = new Date().toISOString().slice(0, 7);
  const label = new Date(`${period}-01T00:00:00Z`).toLocaleDateString('sv-SE', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });

  return (
    <View style={styles.periodRow}>
      <Text style={styles.periodArrow} onPress={() => onChange(addMonths(period, -1))}>
        ‹
      </Text>
      <Text style={styles.periodLabel}>{label}</Text>
      <Text
        style={[styles.periodArrow, period >= current && styles.periodArrowDisabled]}
        onPress={() => period < current && onChange(addMonths(period, 1))}
      >
        ›
      </Text>
    </View>
  );
}

function Summary({
  label,
  amount,
  tone,
}: {
  label: string;
  amount: number;
  tone?: 'positive' | 'accent';
}) {
  const color =
    tone === 'positive'
      ? theme.color.positive
      : tone === 'accent'
        ? theme.color.accent
        : theme.color.text;

  return (
    <View style={{ flex: 1 }}>
      <Text style={styles.summaryLabel}>{label}</Text>
      <Text style={[styles.summaryValue, theme.font.numeric, { color }]}>
        {formatMoney(Math.abs(amount), 'SEK', { compact: true })}
      </Text>
    </View>
  );
}

/** Simple income-vs-spend bars. Enough to see a trend without a chart library. */
function TrendBars({ trend }: { trend: { period: string; income: number; spend: number }[] }) {
  const max = Math.max(...trend.flatMap((t) => [t.income, t.spend]), 1);

  return (
    <View style={styles.trendRow}>
      {trend.map((month) => (
        <View key={month.period} style={styles.trendColumn}>
          <View style={styles.trendBars}>
            <View
              style={[
                styles.trendBar,
                { height: `${(month.income / max) * 100}%`, backgroundColor: theme.color.positive },
              ]}
            />
            <View
              style={[
                styles.trendBar,
                { height: `${(month.spend / max) * 100}%`, backgroundColor: theme.color.accent },
              ]}
            />
          </View>
          <Text style={styles.trendLabel}>{month.period.slice(5)}</Text>
        </View>
      ))}
    </View>
  );
}

function formatChange(change: number): string {
  const percent = Math.round(change * 100);
  if (percent === 0) return 'oförändrat';
  return percent > 0 ? `+${percent}%` : `${percent}%`;
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: theme.space(4),
  },
  periodRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.space(6),
    marginBottom: theme.space(4),
  },
  periodLabel: {
    color: theme.color.text,
    fontSize: theme.font.size.lg,
    fontWeight: '700',
    textTransform: 'capitalize',
    minWidth: 150,
    textAlign: 'center',
  },
  periodArrow: {
    color: theme.color.accent,
    fontSize: 30,
    paddingHorizontal: theme.space(3),
  },
  periodArrowDisabled: {
    color: theme.color.textFaint,
  },
  cardLabel: {
    color: theme.color.textMuted,
    fontSize: theme.font.size.sm,
    marginBottom: theme.space(1),
  },
  summaryRow: {
    flexDirection: 'row',
    marginTop: theme.space(5),
    gap: theme.space(3),
  },
  summaryLabel: {
    color: theme.color.textFaint,
    fontSize: theme.font.size.xs,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: theme.space(1),
  },
  summaryValue: {
    fontSize: theme.font.size.lg,
    fontWeight: '700',
  },
  projection: {
    marginTop: theme.space(5),
    gap: theme.space(2),
  },
  projectionText: {
    color: theme.color.textFaint,
    fontSize: theme.font.size.xs,
  },
  warningTitle: {
    color: theme.color.warning,
    fontWeight: '700',
    fontSize: theme.font.size.md,
    marginBottom: theme.space(1),
  },
  warningBody: {
    color: theme.color.textMuted,
    fontSize: theme.font.size.sm,
    lineHeight: 20,
  },
  inlineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  emptyText: {
    color: theme.color.textMuted,
    fontSize: theme.font.size.md,
    textAlign: 'center',
    paddingVertical: theme.space(6),
  },
  categoryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.space(3),
    paddingVertical: theme.space(3),
  },
  divider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.color.border,
  },
  categoryDot: {
    width: 8,
    height: 32,
    borderRadius: 4,
  },
  categoryName: {
    color: theme.color.text,
    fontSize: theme.font.size.md,
    fontWeight: '600',
  },
  categoryMeta: {
    color: theme.color.textFaint,
    fontSize: theme.font.size.xs,
    marginTop: 2,
  },
  trendRow: {
    flexDirection: 'row',
    height: 140,
    gap: theme.space(2),
  },
  trendColumn: {
    flex: 1,
    alignItems: 'center',
  },
  trendBars: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 3,
  },
  trendBar: {
    width: 9,
    borderRadius: 2,
    minHeight: 2,
  },
  trendLabel: {
    color: theme.color.textFaint,
    fontSize: theme.font.size.xs,
    marginTop: theme.space(1.5),
  },
});
