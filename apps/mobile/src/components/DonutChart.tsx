import { View, Text, StyleSheet } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { formatMoney, type Currency } from '@household/shared';
import { theme } from '../theme';

/**
 * Spend-by-group donut.
 *
 * Drawn with stroke-dasharray on concentric circles rather than arc paths —
 * fewer moving parts, and it degrades gracefully when a slice rounds to zero
 * width. The total sits in the hole, which is the number people actually came
 * to read.
 */

export interface DonutSlice {
  label: string;
  amount: number;
  color: string;
}

const MIN_VISIBLE_FRACTION = 0.015;

export function DonutChart({
  slices,
  currency = 'SEK',
  size = 200,
  thickness = 22,
  centerLabel = 'Spent',
}: {
  slices: readonly DonutSlice[];
  currency?: Currency;
  size?: number;
  thickness?: number;
  centerLabel?: string;
}) {
  const total = slices.reduce((sum, s) => sum + s.amount, 0);
  const radius = (size - thickness) / 2;
  const circumference = 2 * Math.PI * radius;

  // Tiny slices are widened to stay visible; the rest absorb the difference so
  // the ring still closes exactly.
  const visible = slices.filter((s) => s.amount > 0);
  const fractions = normaliseFractions(visible.map((s) => s.amount), total);

  let offset = 0;
  const arcs = visible.map((slice, i) => {
    const fraction = fractions[i] ?? 0;
    const arc = {
      color: slice.color,
      dash: fraction * circumference,
      gap: circumference - fraction * circumference,
      rotation: (offset * 360) - 90, // start at 12 o'clock
    };
    offset += fraction;
    return arc;
  });

  return (
    <View style={{ alignItems: 'center' }}>
      <View style={{ width: size, height: size }}>
        <Svg width={size} height={size}>
          <Circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            stroke={theme.color.surfaceRaised}
            strokeWidth={thickness}
            fill="none"
          />
          {arcs.map((arc, i) => (
            <Circle
              key={i}
              cx={size / 2}
              cy={size / 2}
              r={radius}
              stroke={arc.color}
              strokeWidth={thickness}
              strokeDasharray={`${arc.dash} ${arc.gap}`}
              strokeLinecap="butt"
              fill="none"
              // Plain SVG rotate(deg cx cy) rather than react-native-svg's
              // originX/originY/rotation props: on web those are emitted as a
              // kebab-case `transform-origin` DOM attribute, which React
              // rejects with a warning on every render.
              transform={`rotate(${arc.rotation} ${size / 2} ${size / 2})`}
            />
          ))}
        </Svg>

        <View style={[styles.center, { width: size, height: size }]} pointerEvents="none">
          <Text style={styles.centerLabel}>{centerLabel}</Text>
          <Text style={[styles.centerValue, theme.font.numeric]}>
            {formatMoney(total, currency, { compact: total >= 10000000 })}
          </Text>
        </View>
      </View>
    </View>
  );
}

export function DonutLegend({
  slices,
  currency = 'SEK',
}: {
  slices: readonly DonutSlice[];
  currency?: Currency;
}) {
  const total = slices.reduce((sum, s) => sum + s.amount, 0);

  return (
    <View style={styles.legend}>
      {slices.map((slice) => (
        <View key={slice.label} style={styles.legendRow}>
          <View style={[styles.legendDot, { backgroundColor: slice.color }]} />
          <Text style={styles.legendLabel} numberOfLines={1}>
            {slice.label}
          </Text>
          <Text style={styles.legendShare}>
            {total > 0 ? `${Math.round((slice.amount / total) * 100)}%` : '—'}
          </Text>
          <Text style={[styles.legendAmount, theme.font.numeric]}>
            {formatMoney(slice.amount, currency, { compact: true })}
          </Text>
        </View>
      ))}
    </View>
  );
}

/**
 * Gives every non-zero slice at least a sliver of the ring, then rescales so
 * the fractions still sum to 1 — otherwise the donut visibly fails to close.
 */
function normaliseFractions(amounts: readonly number[], total: number): number[] {
  if (total <= 0) return amounts.map(() => 0);

  const raw = amounts.map((a) => a / total);
  const boosted = raw.map((f) => Math.max(f, MIN_VISIBLE_FRACTION));
  const sum = boosted.reduce((a, b) => a + b, 0);
  return boosted.map((f) => f / sum);
}

const styles = StyleSheet.create({
  center: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  centerLabel: {
    color: theme.color.textMuted,
    fontSize: theme.font.size.xs,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 2,
  },
  centerValue: {
    color: theme.color.text,
    fontSize: theme.font.size.xl,
    fontWeight: '700',
  },
  legend: {
    marginTop: theme.space(4),
    gap: theme.space(2.5),
  },
  legendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.space(2.5),
  },
  legendDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  legendLabel: {
    color: theme.color.text,
    fontSize: theme.font.size.md,
    flex: 1,
  },
  legendShare: {
    color: theme.color.textFaint,
    fontSize: theme.font.size.sm,
    width: 42,
    textAlign: 'right',
  },
  legendAmount: {
    color: theme.color.textMuted,
    fontSize: theme.font.size.sm,
    width: 72,
    textAlign: 'right',
  },
});
