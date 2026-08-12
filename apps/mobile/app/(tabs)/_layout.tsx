import { Tabs } from 'expo-router';
import { Text, type ColorValue } from 'react-native';
import { theme } from '../../src/theme';

/**
 * Five tabs, in the order a household actually uses them: the overview
 * answers "how are we doing", transactions answers "on what", and the rest
 * are the things you set up once and revisit.
 */
export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: theme.color.surface,
          borderTopColor: theme.color.border,
        },
        tabBarActiveTintColor: theme.color.accent,
        tabBarInactiveTintColor: theme.color.textFaint,
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{ title: 'Översikt', tabBarIcon: ({ color }) => <TabIcon icon="◎" color={color} /> }}
      />
      <Tabs.Screen
        name="transactions"
        options={{ title: 'Transaktioner', tabBarIcon: ({ color }) => <TabIcon icon="≡" color={color} /> }}
      />
      <Tabs.Screen
        name="budget"
        options={{ title: 'Budget', tabBarIcon: ({ color }) => <TabIcon icon="▤" color={color} /> }}
      />
      <Tabs.Screen
        name="goals"
        options={{ title: 'Sparmål', tabBarIcon: ({ color }) => <TabIcon icon="◆" color={color} /> }}
      />
      <Tabs.Screen
        name="settings"
        options={{ title: 'Konton', tabBarIcon: ({ color }) => <TabIcon icon="⚙" color={color} /> }}
      />
    </Tabs>
  );
}

// react-navigation hands back a ColorValue (which may be an opaque platform
// colour), not a plain string.
function TabIcon({ icon, color }: { icon: string; color: ColorValue }) {
  return <Text style={{ color, fontSize: 20, lineHeight: 24 }}>{icon}</Text>;
}
