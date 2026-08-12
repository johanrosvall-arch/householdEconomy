import { useMemo, useState } from 'react';
import {
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { TransactionDTO } from '@household/shared';
import { api } from '../../src/api/client';
import { useHouseholdId } from '../../src/store/session';
import { Button, EmptyState, ErrorNotice, Loading, Money, Pill } from '../../src/components/ui';
import { theme } from '../../src/theme';

/**
 * The transaction list — the screen that answers "what was that charge?".
 *
 * Tapping a row opens the category picker. Recategorising offers to apply the
 * same choice to similar transactions, which is how the app gets more accurate
 * over time without the user managing rules by hand.
 */
export default function TransactionsScreen() {
  const householdId = useHouseholdId();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();

  const [search, setSearch] = useState('');
  const [uncategorisedOnly, setUncategorisedOnly] = useState(false);
  const [selected, setSelected] = useState<TransactionDTO | null>(null);

  const categories = useQuery({
    queryKey: ['categories', householdId],
    queryFn: () => api.categories(householdId),
    staleTime: 10 * 60_000,
  });

  const transactions = useInfiniteQuery({
    queryKey: ['transactions', householdId, search, uncategorisedOnly],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      api.transactions(householdId, {
        limit: 50,
        ...(search ? { search } : {}),
        ...(uncategorisedOnly ? { uncategorisedOnly: true } : {}),
        ...(pageParam ? { cursor: pageParam } : {}),
      }),
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });

  const recategorise = useMutation({
    mutationFn: ({
      transactionId,
      categorySlug,
      applyToSimilar,
    }: {
      transactionId: string;
      categorySlug: string;
      applyToSimilar: boolean;
    }) => api.updateTransaction(householdId, transactionId, { categorySlug, applyToSimilar }),
    onSuccess: () => {
      setSelected(null);
      void queryClient.invalidateQueries({ queryKey: ['transactions', householdId] });
      void queryClient.invalidateQueries({ queryKey: ['overview', householdId] });
      void queryClient.invalidateQueries({ queryKey: ['budget', householdId] });
    },
  });

  const rows = useMemo(
    () => transactions.data?.pages.flatMap((page) => page.transactions) ?? [],
    [transactions.data],
  );

  const categoryBySlug = useMemo(() => {
    const map = new Map<string, { name: string; color: string }>();
    for (const c of categories.data?.categories ?? []) {
      map.set(c.slug, { name: c.name, color: c.color });
    }
    return map;
  }, [categories.data]);

  return (
    <View style={[styles.screen, { paddingTop: insets.top + theme.space(3) }]}>
      <View style={styles.header}>
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Sök transaktion"
          placeholderTextColor={theme.color.textFaint}
          style={styles.search}
          autoCorrect={false}
        />
        <Pressable
          onPress={() => setUncategorisedOnly((v) => !v)}
          style={[styles.filterChip, uncategorisedOnly && styles.filterChipActive]}
        >
          <Text style={[styles.filterLabel, uncategorisedOnly && styles.filterLabelActive]}>
            Okategoriserat
          </Text>
        </Pressable>
      </View>

      {transactions.isPending ? (
        <Loading />
      ) : transactions.isError ? (
        <View style={{ padding: theme.space(4) }}>
          <ErrorNotice
            message={(transactions.error as Error).message}
            onRetry={() => transactions.refetch()}
          />
        </View>
      ) : rows.length === 0 ? (
        <EmptyState
          title="Inga transaktioner"
          message={
            search || uncategorisedOnly
              ? 'Inget matchar filtret. Prova att rensa sökningen.'
              : 'Koppla en bank eller ladda upp en kontoutdragsfil under Konton.'
          }
        />
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ paddingBottom: insets.bottom + theme.space(6) }}
          onEndReached={() => {
            if (transactions.hasNextPage && !transactions.isFetchingNextPage) {
              void transactions.fetchNextPage();
            }
          }}
          onEndReachedThreshold={0.4}
          renderItem={({ item, index }) => {
            const previous = rows[index - 1];
            const showDate = previous?.date !== item.date;
            return (
              <>
                {showDate ? <Text style={styles.dateHeader}>{formatDate(item.date)}</Text> : null}
                <TransactionRow
                  transaction={item}
                  category={categoryBySlug.get(item.categorySlug)}
                  onPress={() => setSelected(item)}
                />
              </>
            );
          }}
          ListFooterComponent={
            transactions.isFetchingNextPage ? <Loading /> : <View style={{ height: 24 }} />
          }
        />
      )}

      <CategoryPicker
        transaction={selected}
        categories={categories.data?.categories ?? []}
        onClose={() => setSelected(null)}
        onPick={(categorySlug, applyToSimilar) =>
          selected &&
          recategorise.mutate({ transactionId: selected.id, categorySlug, applyToSimilar })
        }
        busy={recategorise.isPending}
      />
    </View>
  );
}

function TransactionRow({
  transaction,
  category,
  onPress,
}: {
  transaction: TransactionDTO;
  category?: { name: string; color: string };
  onPress: () => void;
}) {
  const isTransfer = transaction.transferPairId != null;

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: theme.color.surfaceRaised }]}
    >
      <View style={[styles.rowDot, { backgroundColor: category?.color ?? theme.color.border }]} />

      <View style={{ flex: 1 }}>
        <Text style={styles.rowTitle} numberOfLines={1}>
          {transaction.merchant ?? transaction.description}
        </Text>
        <View style={styles.rowMeta}>
          <Text style={styles.rowMetaText} numberOfLines={1}>
            {category?.name ?? 'Okategoriserat'} · {transaction.accountName}
          </Text>
          {transaction.pending ? <Pill label="Reserverad" color={theme.color.warning} /> : null}
          {isTransfer ? <Pill label="Överföring" /> : null}
        </View>
      </View>

      <Money amount={transaction.amount} colorise={transaction.amount > 0} size="md" />
    </Pressable>
  );
}

function CategoryPicker({
  transaction,
  categories,
  onClose,
  onPick,
  busy,
}: {
  transaction: TransactionDTO | null;
  categories: { slug: string; name: string; groupName: string; color: string }[];
  onClose: () => void;
  onPick: (categorySlug: string, applyToSimilar: boolean) => void;
  busy: boolean;
}) {
  const [applyToSimilar, setApplyToSimilar] = useState(true);
  const insets = useSafeAreaInsets();

  const grouped = useMemo(() => {
    const map = new Map<string, typeof categories>();
    for (const category of categories) {
      const list = map.get(category.groupName) ?? [];
      list.push(category);
      map.set(category.groupName, list);
    }
    return [...map];
  }, [categories]);

  return (
    <Modal visible={transaction != null} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.modalBackdrop} onPress={onClose} />
      <View style={[styles.modalSheet, { paddingBottom: insets.bottom + theme.space(4) }]}>
        <Text style={styles.modalTitle} numberOfLines={1}>
          {transaction?.merchant ?? transaction?.description}
        </Text>
        <Text style={styles.modalSubtitle}>{transaction?.description}</Text>

        <Pressable
          onPress={() => setApplyToSimilar((v) => !v)}
          style={styles.checkboxRow}
        >
          <View style={[styles.checkbox, applyToSimilar && styles.checkboxChecked]}>
            {applyToSimilar ? <Text style={styles.checkboxTick}>✓</Text> : null}
          </View>
          <Text style={styles.checkboxLabel}>
            Använd samma kategori för liknande transaktioner i framtiden
          </Text>
        </Pressable>

        <FlatList
          data={grouped}
          keyExtractor={([groupName]) => groupName}
          style={{ maxHeight: 380 }}
          renderItem={({ item: [groupName, items] }) => (
            <View style={{ marginBottom: theme.space(3) }}>
              <Text style={styles.groupLabel}>{groupName}</Text>
              <View style={styles.chipWrap}>
                {items.map((category) => (
                  <Pressable
                    key={category.slug}
                    disabled={busy}
                    onPress={() => onPick(category.slug, applyToSimilar)}
                    style={[
                      styles.categoryChip,
                      transaction?.categorySlug === category.slug && {
                        borderColor: category.color,
                        backgroundColor: `${category.color}22`,
                      },
                    ]}
                  >
                    <Text style={styles.categoryChipLabel}>{category.name}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          )}
        />

        <Button label="Stäng" variant="ghost" onPress={onClose} />
      </View>
    </Modal>
  );
}

function formatDate(date: string): string {
  const parsed = new Date(`${date}T00:00:00Z`);
  return parsed.toLocaleDateString('sv-SE', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: theme.color.background,
  },
  header: {
    paddingHorizontal: theme.space(4),
    paddingBottom: theme.space(3),
    gap: theme.space(2.5),
  },
  search: {
    backgroundColor: theme.color.surface,
    borderRadius: theme.radius.md,
    paddingHorizontal: theme.space(4),
    paddingVertical: theme.space(3),
    color: theme.color.text,
    fontSize: theme.font.size.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.color.border,
  },
  filterChip: {
    alignSelf: 'flex-start',
    paddingHorizontal: theme.space(3),
    paddingVertical: theme.space(1.5),
    borderRadius: theme.radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.color.border,
  },
  filterChipActive: {
    backgroundColor: theme.color.accentSoft,
    borderColor: theme.color.accent,
  },
  filterLabel: {
    color: theme.color.textMuted,
    fontSize: theme.font.size.sm,
    fontWeight: '600',
  },
  filterLabelActive: {
    color: theme.color.text,
  },
  dateHeader: {
    color: theme.color.textFaint,
    fontSize: theme.font.size.xs,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    paddingHorizontal: theme.space(4),
    paddingTop: theme.space(4),
    paddingBottom: theme.space(1.5),
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.space(3),
    paddingHorizontal: theme.space(4),
    paddingVertical: theme.space(3),
  },
  rowDot: {
    width: 4,
    height: 36,
    borderRadius: 2,
  },
  rowTitle: {
    color: theme.color.text,
    fontSize: theme.font.size.md,
    fontWeight: '600',
  },
  rowMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.space(2),
    marginTop: 3,
  },
  rowMetaText: {
    color: theme.color.textFaint,
    fontSize: theme.font.size.xs,
    flexShrink: 1,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: '#00000099',
  },
  modalSheet: {
    backgroundColor: theme.color.surface,
    borderTopLeftRadius: theme.radius.lg,
    borderTopRightRadius: theme.radius.lg,
    padding: theme.space(5),
    gap: theme.space(3),
  },
  modalTitle: {
    color: theme.color.text,
    fontSize: theme.font.size.lg,
    fontWeight: '700',
  },
  modalSubtitle: {
    color: theme.color.textFaint,
    fontSize: theme.font.size.xs,
    marginTop: -theme.space(2),
  },
  checkboxRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.space(3),
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: theme.color.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxChecked: {
    backgroundColor: theme.color.accent,
    borderColor: theme.color.accent,
  },
  checkboxTick: {
    color: theme.color.text,
    fontSize: 14,
    fontWeight: '700',
  },
  checkboxLabel: {
    color: theme.color.textMuted,
    fontSize: theme.font.size.sm,
    flex: 1,
  },
  groupLabel: {
    color: theme.color.textFaint,
    fontSize: theme.font.size.xs,
    fontWeight: '700',
    textTransform: 'uppercase',
    marginBottom: theme.space(2),
  },
  chipWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.space(2),
  },
  categoryChip: {
    paddingHorizontal: theme.space(3),
    paddingVertical: theme.space(2),
    borderRadius: theme.radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.color.border,
    backgroundColor: theme.color.surfaceRaised,
  },
  categoryChipLabel: {
    color: theme.color.text,
    fontSize: theme.font.size.sm,
  },
});
