import { useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as DocumentPicker from 'expo-document-picker';
import * as WebBrowser from 'expo-web-browser';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatMoney, type AccountDTO, type ImportPreviewDTO } from '@household/shared';
import { api } from '../../src/api/client';
import { useSession, useHouseholdId } from '../../src/store/session';
import {
  Button,
  Card,
  ErrorNotice,
  Loading,
  Money,
  Pill,
  SectionTitle,
} from '../../src/components/ui';
import { theme } from '../../src/theme';

/**
 * Accounts, bank connections and file import.
 *
 * Both ways of getting data in live here side by side, because for most Swedish
 * households they are complementary: PSD2 covers the banks, and a CSV export
 * covers whatever the aggregator does not reach — typically store cards and
 * some Klarna or Amex products.
 */
export default function SettingsScreen() {
  const householdId = useHouseholdId();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();

  const signOut = useSession((s) => s.signOut);
  const user = useSession((s) => s.user);

  const [preview, setPreview] = useState<ImportPreviewDTO | null>(null);
  const [showBanks, setShowBanks] = useState(false);

  const accounts = useQuery({
    queryKey: ['accounts', householdId],
    queryFn: () => api.accounts(householdId),
  });

  const connections = useQuery({
    queryKey: ['connections', householdId],
    queryFn: () => api.connections(householdId),
  });

  const recurring = useQuery({
    queryKey: ['recurring', householdId],
    queryFn: () => api.recurring(householdId),
  });

  const invalidateAll = () => queryClient.invalidateQueries();

  const sync = useMutation({
    mutationFn: () => api.syncAll(householdId),
    onSuccess: (result) => {
      void invalidateAll();
      Alert.alert('Synkning klar', `${result.imported} nya transaktioner hämtades.`);
    },
  });

  const upload = useMutation({
    mutationFn: async () => {
      const picked = await DocumentPicker.getDocumentAsync({
        type: [
          'text/csv',
          'text/comma-separated-values',
          'application/vnd.ms-excel',
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          '*/*',
        ],
        copyToCacheDirectory: true,
      });
      if (picked.canceled || !picked.assets?.[0]) return null;

      const asset = picked.assets[0];
      return api.uploadStatement(householdId, {
        uri: asset.uri,
        name: asset.name,
        mimeType: asset.mimeType,
      });
    },
    onSuccess: (result) => {
      if (result) setPreview(result);
    },
    onError: (error) => Alert.alert('Kunde inte läsa filen', (error as Error).message),
  });

  if (accounts.isPending) return <Loading />;

  return (
    <ScrollView
      style={{ backgroundColor: theme.color.background }}
      contentContainerStyle={{
        paddingHorizontal: theme.space(4),
        paddingTop: insets.top + theme.space(3),
        paddingBottom: insets.bottom + theme.space(10),
      }}
    >
      <Text style={styles.screenTitle}>Konton</Text>

      {accounts.isError ? (
        <ErrorNotice
          message={(accounts.error as Error).message}
          onRetry={() => accounts.refetch()}
        />
      ) : (
        <Card>
          {accounts.data.accounts.length === 0 ? (
            <Text style={styles.meta}>Inga konton ännu.</Text>
          ) : (
            accounts.data.accounts.map((account, index) => (
              <AccountRow key={account.id} account={account} first={index === 0} />
            ))
          )}
        </Card>
      )}

      <SectionTitle>Hämta transaktioner</SectionTitle>
      <View style={{ gap: theme.space(2) }}>
        <Button label="Koppla en bank" onPress={() => setShowBanks(true)} />
        <Button
          label="Ladda upp CSV eller Excel"
          variant="secondary"
          onPress={() => upload.mutate()}
          loading={upload.isPending}
        />
        {(connections.data?.connections.length ?? 0) > 0 ? (
          <Button
            label="Synka alla banker nu"
            variant="ghost"
            onPress={() => sync.mutate()}
            loading={sync.isPending}
          />
        ) : null}
      </View>

      <Text style={styles.disclaimer}>
        Bankkopplingar går via en licensierad kontoinformationstjänst (PSD2). Du identifierar dig
        hos din egen bank med BankID — appen ser aldrig dina bankuppgifter. Samtycket måste förnyas
        var 90:e dag.
      </Text>

      {connections.data && connections.data.connections.length > 0 ? (
        <>
          <SectionTitle>Kopplade banker</SectionTitle>
          <Card>
            {connections.data.connections.map((connection, index) => (
              <View
                key={connection.id}
                style={[styles.row, index > 0 && styles.divider]}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowTitle}>{connection.institutionName}</Text>
                  <Text style={styles.meta}>
                    {connection.lastSyncedAt
                      ? `Senast synkad ${new Date(connection.lastSyncedAt).toLocaleDateString('sv-SE')}`
                      : 'Aldrig synkad'}
                  </Text>
                </View>
                <Pill
                  label={statusLabel(connection.status)}
                  color={
                    connection.status === 'active'
                      ? theme.color.positive
                      : connection.status === 'pending'
                        ? theme.color.warning
                        : theme.color.danger
                  }
                />
              </View>
            ))}
          </Card>
        </>
      ) : null}

      {recurring.data && recurring.data.recurring.length > 0 ? (
        <>
          <SectionTitle>Återkommande kostnader</SectionTitle>
          <Card>
            <Text style={styles.cardLabel}>
              {formatMoney(-recurring.data.totalMonthly)} per månad i abonnemang och autogiro
            </Text>
            {recurring.data.recurring.slice(0, 10).map((item, index) => (
              <View key={item.label} style={[styles.row, index > 0 && styles.divider]}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowTitle} numberOfLines={1}>
                    {item.label}
                  </Text>
                  <Text style={styles.meta}>Sett {item.monthsSeen} månader i rad</Text>
                </View>
                <Money amount={item.monthlyAmount} size="sm" />
              </View>
            ))}
          </Card>
        </>
      ) : null}

      <SectionTitle>Konto</SectionTitle>
      <Card>
        <Text style={styles.rowTitle}>{user?.displayName}</Text>
        <Text style={styles.meta}>{user?.email}</Text>
        <Button
          label="Logga ut"
          variant="ghost"
          onPress={() => void signOut()}
          style={{ marginTop: theme.space(3) }}
        />
      </Card>

      <BankPicker
        visible={showBanks}
        householdId={householdId}
        onClose={() => setShowBanks(false)}
        onLinked={() => {
          setShowBanks(false);
          void invalidateAll();
        }}
      />

      <ImportPreviewModal
        preview={preview}
        accounts={accounts.data?.accounts ?? []}
        householdId={householdId}
        onClose={() => setPreview(null)}
        onCommitted={() => {
          setPreview(null);
          void invalidateAll();
        }}
      />
    </ScrollView>
  );
}

function AccountRow({ account, first }: { account: AccountDTO; first: boolean }) {
  return (
    <View style={[styles.row, !first && styles.divider]}>
      <View style={{ flex: 1 }}>
        <Text style={styles.rowTitle}>{account.name}</Text>
        <Text style={styles.meta}>
          {account.institutionName ?? 'Manuellt konto'}
          {account.mask ? ` ••${account.mask}` : ''}
        </Text>
      </View>
      <Money amount={account.balance} size="md" />
    </View>
  );
}

function BankPicker({
  visible,
  householdId,
  onClose,
  onLinked,
}: {
  visible: boolean;
  householdId: string;
  onClose: () => void;
  onLinked: () => void;
}) {
  const insets = useSafeAreaInsets();

  const institutions = useQuery({
    queryKey: ['institutions', householdId],
    queryFn: () => api.institutions(householdId),
    enabled: visible,
  });

  const link = useMutation({
    mutationFn: async (institutionId: string) => {
      const started = await api.startBankLink(householdId, institutionId);

      // The bank's own authentication happens in a browser session we do not
      // control. openAuthSessionAsync returns when the user is redirected back
      // to our scheme, at which point the consent is ready to confirm.
      await WebBrowser.openAuthSessionAsync(started.authUrl, 'householdeconomy://bank-callback');

      return api.completeBankLink(householdId, started.connectionId);
    },
    onSuccess: onLinked,
    onError: (error) => Alert.alert('Kopplingen misslyckades', (error as Error).message),
  });

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={[styles.sheet, { paddingBottom: insets.bottom + theme.space(4) }]}>
        <Text style={styles.sheetTitle}>Välj bank</Text>

        {institutions.isPending ? (
          <Loading />
        ) : institutions.isError ? (
          <ErrorNotice message={(institutions.error as Error).message} />
        ) : (
          <ScrollView style={{ maxHeight: 400 }}>
            {institutions.data.institutions.map((institution) => (
              <Pressable
                key={institution.id}
                disabled={link.isPending}
                onPress={() => link.mutate(institution.id)}
                style={({ pressed }) => [
                  styles.bankRow,
                  pressed && { backgroundColor: theme.color.surfaceRaised },
                ]}
              >
                <Text style={styles.rowTitle}>{institution.name}</Text>
                <Text style={styles.meta}>{institution.transactionTotalDays} dagars historik</Text>
              </Pressable>
            ))}
          </ScrollView>
        )}

        {link.isPending ? <Loading label="Väntar på banken" /> : null}
        <Button label="Avbryt" variant="ghost" onPress={onClose} />
      </View>
    </Modal>
  );
}

/**
 * Import preview. Deliberately a confirmation step: the user sees the detected
 * format, the parsed sample and the duplicate count before anything is written.
 */
function ImportPreviewModal({
  preview,
  accounts,
  householdId,
  onClose,
  onCommitted,
}: {
  preview: ImportPreviewDTO | null;
  accounts: AccountDTO[];
  householdId: string;
  onClose: () => void;
  onCommitted: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [accountId, setAccountId] = useState<string | null>(null);

  const commit = useMutation({
    mutationFn: () => {
      if (!preview || !accountId) throw new Error('Välj ett konto först');
      return api.commitImport(householdId, preview.batchId, accountId);
    },
    onSuccess: (result) => {
      Alert.alert(
        'Import klar',
        `${result.imported} transaktioner importerade. ${result.skippedDuplicates} dubbletter hoppades över.`,
      );
      onCommitted();
    },
    onError: (error) => Alert.alert('Importen misslyckades', (error as Error).message),
  });

  const importable = preview ? preview.rowCount - preview.errors.length : 0;

  return (
    <Modal visible={preview != null} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={[styles.sheet, { paddingBottom: insets.bottom + theme.space(4) }]}>
        <Text style={styles.sheetTitle}>Granska import</Text>

        <Text style={styles.meta}>
          {preview?.detectedFormat
            ? `Igenkänt format: ${preview.detectedFormat}`
            : 'Okänt format — kolumnerna gissades utifrån innehållet'}
        </Text>
        <Text style={styles.meta}>
          {importable} rader kan importeras · {preview?.duplicateCount ?? 0} dubbletter ·{' '}
          {preview?.errors.length ?? 0} fel
        </Text>

        <Text style={styles.fieldLabel}>Importera till konto</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: theme.space(1) }}>
          <View style={{ flexDirection: 'row', gap: theme.space(2) }}>
            {accounts.map((account) => (
              <Pressable
                key={account.id}
                onPress={() => setAccountId(account.id)}
                style={[
                  styles.accountChip,
                  accountId === account.id && {
                    borderColor: theme.color.accent,
                    backgroundColor: theme.color.accentSoft,
                  },
                ]}
              >
                <Text style={styles.rowTitle}>{account.name}</Text>
              </Pressable>
            ))}
          </View>
        </ScrollView>

        <ScrollView style={{ maxHeight: 220 }}>
          {preview?.sample.map((row) => (
            <View key={row.row} style={styles.sampleRow}>
              <Text style={styles.meta}>{row.date}</Text>
              <Text style={styles.sampleDescription} numberOfLines={1}>
                {row.description}
              </Text>
              <Text style={[styles.sampleAmount, theme.font.numeric]}>
                {row.amount != null ? formatMoney(row.amount) : '—'}
              </Text>
              {row.isDuplicate ? <Pill label="Dubblett" color={theme.color.warning} /> : null}
            </View>
          ))}
        </ScrollView>

        <Button
          label={`Importera ${importable} rader`}
          onPress={() => commit.mutate()}
          disabled={!accountId || importable === 0}
          loading={commit.isPending}
        />
        <Button label="Avbryt" variant="ghost" onPress={onClose} />
      </View>
    </Modal>
  );
}

function statusLabel(status: string): string {
  switch (status) {
    case 'active':
      return 'Aktiv';
    case 'pending':
      return 'Väntar';
    case 'expired':
      return 'Förnya';
    case 'revoked':
      return 'Återkallad';
    default:
      return 'Fel';
  }
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
    marginBottom: theme.space(2),
  },
  meta: {
    color: theme.color.textFaint,
    fontSize: theme.font.size.xs,
  },
  disclaimer: {
    color: theme.color.textFaint,
    fontSize: theme.font.size.xs,
    lineHeight: 18,
    marginTop: theme.space(3),
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: theme.space(3),
    gap: theme.space(3),
  },
  divider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.color.border,
  },
  rowTitle: {
    color: theme.color.text,
    fontSize: theme.font.size.md,
    fontWeight: '600',
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
  bankRow: {
    paddingVertical: theme.space(3.5),
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.color.border,
  },
  accountChip: {
    paddingHorizontal: theme.space(3.5),
    paddingVertical: theme.space(2.5),
    borderRadius: theme.radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.color.border,
    backgroundColor: theme.color.surfaceRaised,
  },
  sampleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.space(2),
    paddingVertical: theme.space(2),
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.color.border,
  },
  sampleDescription: {
    color: theme.color.text,
    fontSize: theme.font.size.sm,
    flex: 1,
  },
  sampleAmount: {
    color: theme.color.textMuted,
    fontSize: theme.font.size.sm,
  },
});
