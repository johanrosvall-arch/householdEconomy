import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSession } from '../../src/store/session';
import { Button } from '../../src/components/ui';
import { theme } from '../../src/theme';

export default function SignInScreen() {
  const insets = useSafeAreaInsets();
  const signIn = useSession((s) => s.signIn);
  const register = useSession((s) => s.register);
  const error = useSession((s) => s.error);

  const [mode, setMode] = useState<'sign-in' | 'register'>('sign-in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [householdName, setHouseholdName] = useState('Vårt hushåll');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      if (mode === 'sign-in') {
        await signIn(email.trim(), password);
      } else {
        await register({
          email: email.trim(),
          password,
          displayName: displayName.trim() || 'Jag',
          householdName: householdName.trim() || 'Vårt hushåll',
        });
      }
    } catch {
      // The store surfaces the message; nothing to do here.
    } finally {
      setBusy(false);
    }
  };

  const canSubmit = email.includes('@') && password.length >= 8 && !busy;

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={[styles.container, { paddingTop: insets.top + theme.space(16) }]}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.title}>Hushållsekonomi</Text>
        <Text style={styles.subtitle}>
          Se vart pengarna tar vägen — konton, budget och sparmål på ett ställe.
        </Text>

        <View style={styles.form}>
          {mode === 'register' ? (
            <Field label="Ditt namn" value={displayName} onChangeText={setDisplayName} autoCapitalize="words" />
          ) : null}

          <Field
            label="E-post"
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            autoComplete="email"
          />

          <Field
            label="Lösenord"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoComplete={mode === 'sign-in' ? 'current-password' : 'new-password'}
          />

          {mode === 'register' ? (
            <Field label="Hushållets namn" value={householdName} onChangeText={setHouseholdName} />
          ) : null}

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <Button
            label={mode === 'sign-in' ? 'Logga in' : 'Skapa konto'}
            onPress={submit}
            disabled={!canSubmit}
            loading={busy}
            style={{ marginTop: theme.space(2) }}
          />

          <Button
            label={mode === 'sign-in' ? 'Skapa ett nytt hushåll' : 'Jag har redan ett konto'}
            variant="ghost"
            onPress={() => setMode(mode === 'sign-in' ? 'register' : 'sign-in')}
          />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Field({
  label,
  ...props
}: { label: string } & React.ComponentProps<typeof TextInput>) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        {...props}
        style={styles.input}
        placeholderTextColor={theme.color.textFaint}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: theme.space(6),
    paddingBottom: theme.space(10),
  },
  title: {
    color: theme.color.text,
    fontSize: theme.font.size.xxl,
    fontWeight: '800',
  },
  subtitle: {
    color: theme.color.textMuted,
    fontSize: theme.font.size.md,
    marginTop: theme.space(2),
    lineHeight: 22,
  },
  form: {
    marginTop: theme.space(10),
    gap: theme.space(3),
  },
  field: {
    gap: theme.space(1.5),
  },
  fieldLabel: {
    color: theme.color.textMuted,
    fontSize: theme.font.size.sm,
    fontWeight: '600',
  },
  input: {
    backgroundColor: theme.color.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.color.border,
    borderRadius: theme.radius.md,
    paddingHorizontal: theme.space(4),
    paddingVertical: theme.space(3.5),
    color: theme.color.text,
    fontSize: theme.font.size.md,
  },
  error: {
    color: theme.color.danger,
    fontSize: theme.font.size.sm,
  },
});
