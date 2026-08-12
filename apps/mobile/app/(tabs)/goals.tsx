import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatMoney, toMinorUnits, type GoalDTO } from '@household/shared';
import { api } from '../../src/api/client';
import { useHouseholdId } from '../../src/store/session';
import {
  Button,
  Card,
  EmptyState,
  ErrorNotice,
  Loading,
  Money,
  Pill,
  ProgressBar,
  SectionTitle,
} from '../../src/components/ui';
import { theme } from '../../src/theme';

/**
 * Savings goals.
 *
 * Each goal shows the one number that matters: whether the current monthly
 * contribution actually reaches the target by the date the household picked.
 */
export default function GoalsScreen() {
  const householdId = useHouseholdId();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();

  const [creating, setCreating] = useState(false);
  const [contributingTo, setContributingTo] = useState<GoalDTO | null>(null);

  const goals = useQuery({
    queryKey: ['goals', householdId],
    queryFn: () => api.goals(householdId),
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['goals', householdId] });
    void queryClient.invalidateQueries({ queryKey: ['overview', householdId] });
  };

  const contribute = useMutation({
    mutationFn: ({ goalId, amount }: { goalId: string; amount: number }) =>
      api.contributeToGoal(householdId, goalId, amount),
    onSuccess: () => {
      setContributingTo(null);
      invalidate();
    },
  });

  if (goals.isPending) return <Loading label="Hämtar sparmål" />;
  if (goals.isError) {
    return (
      <View style={{ padding: theme.space(4), paddingTop: insets.top + theme.space(6) }}>
        <ErrorNotice message={(goals.error as Error).message} onRetry={() => goals.refetch()} />
      </View>
    );
  }

  const { goals: list, totalSaved, totalTarget } = goals.data;

  return (
    <ScrollView
      style={{ backgroundColor: theme.color.background }}
      contentContainerStyle={{
        paddingHorizontal: theme.space(4),
        paddingTop: insets.top + theme.space(3),
        paddingBottom: insets.bottom + theme.space(10),
      }}
    >
      <Text style={styles.screenTitle}>Sparmål</Text>

      {list.length === 0 ? (
        <EmptyState
          title="Inga sparmål än"
          message="Ett sparmål gör det konkret: hur mycket, till när, och vad det kräver per månad."
          action={<Button label="Skapa sparmål" onPress={() => setCreating(true)} />}
        />
      ) : (
        <>
          <Card>
            <Text style={styles.cardLabel}>Totalt sparat</Text>
            <Money amount={totalSaved} size="xxl" />
            <View style={{ marginTop: theme.space(3), gap: theme.space(2) }}>
              <ProgressBar value={totalTarget > 0 ? totalSaved / totalTarget : 0} height={10} />
              <Text style={styles.meta}>av {formatMoney(totalTarget)} i mål</Text>
            </View>
          </Card>

          <SectionTitle
            action={<Text style={styles.link} onPress={() => setCreating(true)}>Nytt mål</Text>}
          >
            Dina mål
          </SectionTitle>

          <View style={{ gap: theme.space(3) }}>
            {list.map((goal) => (
              <GoalCard
                key={goal.id}
                goal={goal}
                onContribute={() => setContributingTo(goal)}
              />
            ))}
          </View>
        </>
      )}

      <CreateGoalModal
        visible={creating}
        onClose={() => setCreating(false)}
        householdId={householdId}
        onCreated={() => {
          setCreating(false);
          invalidate();
        }}
      />

      <ContributeModal
        goal={contributingTo}
        onClose={() => setContributingTo(null)}
        onSubmit={(amount) =>
          contributingTo && contribute.mutate({ goalId: contributingTo.id, amount })
        }
        busy={contribute.isPending}
      />
    </ScrollView>
  );
}

function GoalCard({ goal, onContribute }: { goal: GoalDTO; onContribute: () => void }) {
  const complete = goal.progress >= 1;

  return (
    <Card style={goal.color ? { borderColor: `${goal.color}55` } : undefined}>
      <View style={styles.goalHeader}>
        <Text style={styles.goalName}>{goal.name}</Text>
        {complete ? (
          <Pill label="Klart" color={theme.color.positive} />
        ) : goal.onTrack ? (
          <Pill label="I fas" color={theme.color.positive} />
        ) : (
          <Pill label="Efter plan" color={theme.color.warning} />
        )}
      </View>

      <View style={styles.goalAmounts}>
        <Money amount={goal.savedAmount} size="xl" />
        <Text style={styles.meta}>av {formatMoney(goal.targetAmount)}</Text>
      </View>

      <ProgressBar value={goal.progress} color={goal.color ?? undefined} height={10} />

      <View style={styles.goalFooter}>
        {complete ? (
          <Text style={styles.meta}>Målet är nått.</Text>
        ) : (
          <Text style={styles.meta}>
            {goal.requiredMonthly != null && goal.requiredMonthly > 0
              ? `Kräver ${formatMoney(goal.requiredMonthly)}/mån till ${goal.targetDate}`
              : goal.projectedDate
                ? `Klart runt ${goal.projectedDate} i nuvarande takt`
                : 'Sätt ett månadsbelopp för att se när målet nås'}
          </Text>
        )}
      </View>

      {!complete ? (
        <Button
          label="Lägg till sparande"
          variant="secondary"
          onPress={onContribute}
          style={{ marginTop: theme.space(3) }}
        />
      ) : null}
    </Card>
  );
}

function CreateGoalModal({
  visible,
  onClose,
  householdId,
  onCreated,
}: {
  visible: boolean;
  onClose: () => void;
  householdId: string;
  onCreated: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [name, setName] = useState('');
  const [target, setTarget] = useState('');
  const [monthly, setMonthly] = useState('');
  const [targetDate, setTargetDate] = useState('');

  const create = useMutation({
    mutationFn: () =>
      api.createGoal(householdId, {
        name: name.trim(),
        targetAmount: toMinorUnits(Number(target.replace(',', '.')) || 0),
        monthlyContribution: monthly ? toMinorUnits(Number(monthly.replace(',', '.'))) : null,
        targetDate: /^\d{4}-\d{2}-\d{2}$/.test(targetDate) ? targetDate : null,
      }),
    onSuccess: () => {
      setName('');
      setTarget('');
      setMonthly('');
      setTargetDate('');
      onCreated();
    },
  });

  const valid = name.trim().length > 0 && Number(target.replace(',', '.')) > 0;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={[styles.sheet, { paddingBottom: insets.bottom + theme.space(4) }]}>
        <Text style={styles.sheetTitle}>Nytt sparmål</Text>

        <Field label="Namn" value={name} onChangeText={setName} placeholder="Buffert" />
        <Field
          label="Målbelopp (kr)"
          value={target}
          onChangeText={setTarget}
          keyboardType="numeric"
          placeholder="100000"
        />
        <Field
          label="Månadssparande (kr)"
          value={monthly}
          onChangeText={setMonthly}
          keyboardType="numeric"
          placeholder="5000"
        />
        <Field
          label="Måldatum (ÅÅÅÅ-MM-DD, valfritt)"
          value={targetDate}
          onChangeText={setTargetDate}
          placeholder="2026-06-01"
        />

        {create.isError ? (
          <Text style={styles.error}>{(create.error as Error).message}</Text>
        ) : null}

        <Button
          label="Skapa"
          onPress={() => create.mutate()}
          disabled={!valid}
          loading={create.isPending}
        />
        <Button label="Avbryt" variant="ghost" onPress={onClose} />
      </View>
    </Modal>
  );
}

function ContributeModal({
  goal,
  onClose,
  onSubmit,
  busy,
}: {
  goal: GoalDTO | null;
  onClose: () => void;
  onSubmit: (amount: number) => void;
  busy: boolean;
}) {
  const insets = useSafeAreaInsets();
  const [amount, setAmount] = useState('');

  return (
    <Modal visible={goal != null} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={[styles.sheet, { paddingBottom: insets.bottom + theme.space(4) }]}>
        <Text style={styles.sheetTitle}>Lägg till sparande</Text>
        <Text style={styles.meta}>{goal?.name}</Text>

        <Field
          label="Belopp (kr)"
          value={amount}
          onChangeText={setAmount}
          keyboardType="numeric"
          placeholder="5000"
        />

        <Button
          label="Spara"
          onPress={() => onSubmit(toMinorUnits(Number(amount.replace(',', '.')) || 0))}
          disabled={!(Number(amount.replace(',', '.')) > 0)}
          loading={busy}
        />
        <Button label="Avbryt" variant="ghost" onPress={onClose} />
      </View>
    </Modal>
  );
}

function Field({ label, ...props }: { label: string } & React.ComponentProps<typeof TextInput>) {
  return (
    <View style={{ gap: theme.space(1.5) }}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput {...props} placeholderTextColor={theme.color.textFaint} style={styles.input} />
    </View>
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
  goalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: theme.space(2),
  },
  goalName: {
    color: theme.color.text,
    fontSize: theme.font.size.lg,
    fontWeight: '700',
    flex: 1,
  },
  goalAmounts: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: theme.space(2),
    marginBottom: theme.space(3),
  },
  goalFooter: {
    marginTop: theme.space(2),
  },
  backdrop: {
    flex: 1,
    backgroundColor: '#00000099',
  },
  sheet: {
    backgroundColor: theme.color.surface,
    borderTopLeftRadius: theme.radius.lg,
    borderTopRightRadius: theme.radius.lg,
    padding: theme.space(5),
    gap: theme.space(3),
  },
  sheetTitle: {
    color: theme.color.text,
    fontSize: theme.font.size.lg,
    fontWeight: '700',
  },
  fieldLabel: {
    color: theme.color.textMuted,
    fontSize: theme.font.size.sm,
    fontWeight: '600',
  },
  input: {
    backgroundColor: theme.color.surfaceRaised,
    borderRadius: theme.radius.md,
    paddingHorizontal: theme.space(4),
    paddingVertical: theme.space(3),
    color: theme.color.text,
    fontSize: theme.font.size.md,
  },
  error: {
    color: theme.color.danger,
    fontSize: theme.font.size.sm,
  },
});
