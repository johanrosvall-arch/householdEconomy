import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatMoney, toMinorUnits, toMajorUnits } from '@household/shared';
import { api } from '../../src/api/client';
import { useHouseholdId } from '../../src/store/session';
import {
  Button,
  Card,
  EmptyState,
  ErrorNotice,
  Loading,
  Money,
  ProgressBar,
  SectionTitle,
} from '../../src/components/ui';
import { theme } from '../../src/theme';

/**
 * The budget screen.
 *
 * Read mode shows how each envelope is doing against the calendar. Edit mode
 * turns the same list into inputs — a household that has no budget yet is
 * offered limits derived from its own history, which is far more likely to be
 * kept than numbers invented from scratch.
 */
export default function BudgetScreen() {
  const householdId = useHouseholdId();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();

  const period = new Date().toISOString().slice(0, 7);
  const [editing, setEditing] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const budget = useQuery({
    queryKey: ['budget', householdId, period],
    queryFn: () => api.budget(householdId, period),
  });

  const suggestion = useQuery({
    queryKey: ['budget-suggestion', householdId, period],
    queryFn: () => api.budgetSuggestion(householdId, period),
    enabled: editing,
  });

  const save = useMutation({
    mutationFn: (lines: { categorySlug: string; limit: number; rollover: boolean }[]) =>
      api.saveBudget(householdId, { period, lines }),
    onSuccess: () => {
      setEditing(false);
      void queryClient.invalidateQueries({ queryKey: ['budget', householdId] });
      void queryClient.invalidateQueries({ queryKey: ['overview', householdId] });
    },
  });

  // Seed the edit form from the saved budget when entering edit mode.
  useEffect(() => {
    if (!editing || !budget.data) return;
    setDrafts(
      Object.fromEntries(
        budget.data.lines.map((line) => [line.categorySlug, String(toMajorUnits(line.limit))]),
      ),
    );
  }, [editing, budget.data]);

  if (budget.isPending) return <Loading label="Hämtar budget" />;
  if (budget.isError) {
    return (
      <View style={{ padding: theme.space(4), paddingTop: insets.top + theme.space(6) }}>
        <ErrorNotice message={(budget.error as Error).message} onRetry={() => budget.refetch()} />
      </View>
    );
  }

  const data = budget.data;
  const hasBudget = data.lines.length > 0;

  const applySuggestion = () => {
    const lines = suggestion.data?.lines ?? [];
    setDrafts(Object.fromEntries(lines.map((l) => [l.categorySlug, String(toMajorUnits(l.limit))])));
  };

  const commit = () => {
    const lines = Object.entries(drafts)
      .map(([categorySlug, value]) => ({
        categorySlug,
        limit: toMinorUnits(Number(value.replace(',', '.')) || 0),
        // Preserve the existing rollover choice; a limit edit should not
        // silently turn someone's envelope carry-over off.
        rollover: data.lines.find((l) => l.categorySlug === categorySlug)?.rollover ?? false,
      }))
      .filter((line) => line.limit > 0);

    save.mutate(lines);
  };

  return (
    <ScrollView
      style={{ backgroundColor: theme.color.background }}
      contentContainerStyle={{
        paddingHorizontal: theme.space(4),
        paddingTop: insets.top + theme.space(3),
        paddingBottom: insets.bottom + theme.space(10),
      }}
    >
      <Text style={styles.screenTitle}>Budget</Text>

      {!hasBudget && !editing ? (
        <EmptyState
          title="Ingen budget än"
          message="Sätt en gräns per kategori så ser du direkt om ni ligger rätt i månaden. Appen kan föreslå gränser utifrån hur ni faktiskt handlat."
          action={<Button label="Skapa budget" onPress={() => setEditing(true)} />}
        />
      ) : null}

      {hasBudget && !editing ? (
        <>
          <Card>
            <Text style={styles.cardLabel}>Kvar att spendera</Text>
            <Money amount={data.totalRemaining} size="xxl" />
            <View style={{ marginTop: theme.space(4), gap: theme.space(2) }}>
              <ProgressBar
                value={data.totalLimit > 0 ? data.totalSpent / data.totalLimit : 0}
                pace={data.periodProgress}
                height={10}
              />
              <Text style={styles.meta}>
                {formatMoney(data.totalSpent)} av {formatMoney(data.totalLimit)} ·{' '}
                {Math.round(data.periodProgress * 100)}% av månaden gått
              </Text>
            </View>
          </Card>

          {data.unbudgetedSpend > 0 ? (
            <Card style={{ marginTop: theme.space(3) }}>
              <Text style={styles.cardLabel}>Utanför budget</Text>
              <Money amount={-data.unbudgetedSpend} size="lg" />
              <Text style={styles.meta}>
                Spenderat i kategorier som saknar budgetrad.
              </Text>
            </Card>
          ) : null}

          <SectionTitle
            action={<Text style={styles.link} onPress={() => setEditing(true)}>Ändra</Text>}
          >
            Kategorier
          </SectionTitle>

          <Card>
            {data.lines
              .slice()
              .sort((a, b) => b.utilisation - a.utilisation)
              .map((line, index) => (
                <View key={line.categorySlug} style={[styles.line, index > 0 && styles.divider]}>
                  <View style={styles.lineHeader}>
                    <Text style={styles.lineName}>{line.categoryName}</Text>
                    <Text
                      style={[
                        styles.lineRemaining,
                        theme.font.numeric,
                        line.remaining < 0 && { color: theme.color.danger },
                      ]}
                    >
                      {line.remaining < 0
                        ? `${formatMoney(-line.remaining)} över`
                        : `${formatMoney(line.remaining)} kvar`}
                    </Text>
                  </View>

                  <ProgressBar
                    value={line.utilisation}
                    pace={data.periodProgress}
                    color={line.offPace ? undefined : line.color}
                  />

                  <View style={styles.lineFooter}>
                    <Text style={styles.meta}>
                      {formatMoney(line.spent)} av {formatMoney(line.limit + line.rolloverIn)}
                      {line.rolloverIn !== 0
                        ? ` (varav ${formatMoney(line.rolloverIn)} överfört)`
                        : ''}
                    </Text>
                    {line.offPace ? <Text style={styles.offPace}>Ligger före takten</Text> : null}
                  </View>
                </View>
              ))}
          </Card>
        </>
      ) : null}

      {editing ? (
        <>
          <Card>
            <Text style={styles.cardLabel}>Månadsgräns per kategori, i kronor</Text>
            {suggestion.data && suggestion.data.lines.length > 0 ? (
              <Button
                label="Föreslå utifrån historik"
                variant="secondary"
                onPress={applySuggestion}
                style={{ marginTop: theme.space(3) }}
              />
            ) : null}
          </Card>

          <Card style={{ marginTop: theme.space(3) }}>
            {(suggestion.data?.lines ?? data.lines).map((line, index) => {
              const slug = line.categorySlug;
              const name =
                data.lines.find((l) => l.categorySlug === slug)?.categoryName ?? slug;
              return (
                <View key={slug} style={[styles.editRow, index > 0 && styles.divider]}>
                  <Text style={styles.lineName}>{name}</Text>
                  <TextInput
                    value={drafts[slug] ?? ''}
                    onChangeText={(value) => setDrafts((d) => ({ ...d, [slug]: value }))}
                    keyboardType="numeric"
                    placeholder="0"
                    placeholderTextColor={theme.color.textFaint}
                    style={styles.editInput}
                  />
                </View>
              );
            })}
          </Card>

          <View style={{ gap: theme.space(2), marginTop: theme.space(4) }}>
            <Button label="Spara budget" onPress={commit} loading={save.isPending} />
            <Button label="Avbryt" variant="ghost" onPress={() => setEditing(false)} />
          </View>
        </>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screenTitle: {
    color: theme.color.text,
    fontSize: theme.font.size.xxl,
    fontWeight: '800',
    marginBottom: theme.space(4),
  },
  cardLabel: {
    color: theme.color.textMuted,
    fontSize: theme.font.size.sm,
    marginBottom: theme.space(1),
  },
  meta: {
    color: theme.color.textFaint,
    fontSize: theme.font.size.xs,
  },
  link: {
    color: theme.color.accent,
    fontSize: theme.font.size.sm,
    fontWeight: '600',
  },
  line: {
    paddingVertical: theme.space(3.5),
    gap: theme.space(2),
  },
  divider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.color.border,
  },
  lineHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  lineName: {
    color: theme.color.text,
    fontSize: theme.font.size.md,
    fontWeight: '600',
    flex: 1,
  },
  lineRemaining: {
    color: theme.color.textMuted,
    fontSize: theme.font.size.sm,
    fontWeight: '600',
  },
  lineFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  offPace: {
    color: theme.color.warning,
    fontSize: theme.font.size.xs,
    fontWeight: '600',
  },
  editRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: theme.space(3),
    gap: theme.space(3),
  },
  editInput: {
    backgroundColor: theme.color.surfaceRaised,
    borderRadius: theme.radius.sm,
    paddingHorizontal: theme.space(3),
    paddingVertical: theme.space(2),
    color: theme.color.text,
    fontSize: theme.font.size.md,
    minWidth: 100,
    textAlign: 'right',
  },
});
