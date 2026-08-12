import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { formatMoney, type Currency } from '@household/shared';
import { theme } from '../theme';

export function Card({
  children,
  style,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <View style={styles.sectionTitleRow}>
      <Text style={styles.sectionTitle}>{children}</Text>
      {action}
    </View>
  );
}

/**
 * Money display. Income is green and signed; spending is plain — colouring
 * every purchase red would make an ordinary month look like an emergency.
 */
export function Money({
  amount,
  currency = 'SEK',
  size = 'md',
  colorise = false,
  compact = false,
  style,
}: {
  amount: number;
  currency?: Currency;
  size?: keyof typeof theme.font.size;
  colorise?: boolean;
  compact?: boolean;
  style?: StyleProp<TextStyle>;
}) {
  const color = !colorise
    ? theme.color.text
    : amount > 0
      ? theme.color.positive
      : theme.color.text;

  return (
    <Text
      style={[
        theme.font.numeric,
        { fontSize: theme.font.size[size], color, fontWeight: '600' },
        style,
      ]}
    >
      {formatMoney(amount, currency, { showSign: colorise, compact })}
    </Text>
  );
}

export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled,
  loading,
  style,
}: {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  disabled?: boolean;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const background = {
    primary: theme.color.accent,
    secondary: theme.color.surfaceRaised,
    ghost: 'transparent',
    danger: theme.color.danger,
  }[variant];

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: disabled || loading }}
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: background, opacity: disabled ? 0.5 : pressed ? 0.85 : 1 },
        variant === 'ghost' && styles.buttonGhost,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={theme.color.text} />
      ) : (
        <Text style={styles.buttonLabel}>{label}</Text>
      )}
    </Pressable>
  );
}

/**
 * Budget progress bar. Turns amber past the pace line and red once the limit
 * is gone, so the state is readable without parsing the numbers.
 */
export function ProgressBar({
  value,
  pace,
  color,
  height = 8,
}: {
  /** 0..1, may exceed 1 when overspent. */
  value: number;
  /** 0..1 marker for how far through the period we are. */
  pace?: number;
  color?: string;
  height?: number;
}) {
  const clamped = Math.max(0, Math.min(value, 1));
  const over = value > 1;
  const barColor = over
    ? theme.color.danger
    : (color ?? (pace != null && value > pace + 0.1 ? theme.color.warning : theme.color.accent));

  return (
    <View style={[styles.progressTrack, { height, borderRadius: height / 2 }]}>
      <View
        style={{
          width: `${clamped * 100}%`,
          height: '100%',
          backgroundColor: barColor,
          borderRadius: height / 2,
        }}
      />
      {pace != null && pace > 0 && pace < 1 ? (
        <View style={[styles.paceMarker, { left: `${pace * 100}%` }]} />
      ) : null}
    </View>
  );
}

export function Pill({ label, color }: { label: string; color?: string }) {
  return (
    <View style={[styles.pill, color ? { backgroundColor: `${color}22` } : null]}>
      <Text style={[styles.pillLabel, color ? { color } : null]}>{label}</Text>
    </View>
  );
}

export function EmptyState({
  title,
  message,
  action,
}: {
  title: string;
  message: string;
  action?: ReactNode;
}) {
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyMessage}>{message}</Text>
      {action ? <View style={{ marginTop: theme.space(4) }}>{action}</View> : null}
    </View>
  );
}

export function Loading({ label }: { label?: string }) {
  return (
    <View style={styles.loading}>
      <ActivityIndicator color={theme.color.accent} />
      {label ? <Text style={styles.loadingLabel}>{label}</Text> : null}
    </View>
  );
}

export function ErrorNotice({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <Card style={{ borderColor: theme.color.danger }}>
      <Text style={styles.errorTitle}>Something went wrong</Text>
      <Text style={styles.errorMessage}>{message}</Text>
      {onRetry ? (
        <Button label="Try again" variant="secondary" onPress={onRetry} style={{ marginTop: theme.space(3) }} />
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: theme.color.surface,
    borderRadius: theme.radius.lg,
    padding: theme.space(4),
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.color.border,
  },
  sectionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: theme.space(3),
    marginTop: theme.space(5),
  },
  sectionTitle: {
    color: theme.color.textMuted,
    fontSize: theme.font.size.sm,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  button: {
    paddingVertical: theme.space(3.5),
    paddingHorizontal: theme.space(5),
    borderRadius: theme.radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonGhost: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.color.border,
  },
  buttonLabel: {
    color: theme.color.text,
    fontWeight: '600',
    fontSize: theme.font.size.md,
  },
  progressTrack: {
    backgroundColor: theme.color.surfaceRaised,
    overflow: 'hidden',
    justifyContent: 'center',
  },
  paceMarker: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 2,
    backgroundColor: theme.color.textFaint,
  },
  pill: {
    backgroundColor: theme.color.surfaceRaised,
    paddingHorizontal: theme.space(2.5),
    paddingVertical: theme.space(1),
    borderRadius: theme.radius.pill,
  },
  pillLabel: {
    color: theme.color.textMuted,
    fontSize: theme.font.size.xs,
    fontWeight: '600',
  },
  empty: {
    padding: theme.space(8),
    alignItems: 'center',
  },
  emptyTitle: {
    color: theme.color.text,
    fontSize: theme.font.size.lg,
    fontWeight: '700',
    marginBottom: theme.space(2),
    textAlign: 'center',
  },
  emptyMessage: {
    color: theme.color.textMuted,
    fontSize: theme.font.size.md,
    textAlign: 'center',
    lineHeight: 22,
  },
  loading: {
    padding: theme.space(10),
    alignItems: 'center',
    gap: theme.space(3),
  },
  loadingLabel: {
    color: theme.color.textMuted,
    fontSize: theme.font.size.sm,
  },
  errorTitle: {
    color: theme.color.danger,
    fontWeight: '700',
    fontSize: theme.font.size.md,
    marginBottom: theme.space(1),
  },
  errorMessage: {
    color: theme.color.textMuted,
    fontSize: theme.font.size.sm,
    lineHeight: 20,
  },
});
