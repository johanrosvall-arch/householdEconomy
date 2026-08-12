import { useEffect } from 'react';
import { View } from 'react-native';
import { Slot, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useSession } from '../src/store/session';
import { Loading } from '../src/components/ui';
import { theme } from '../src/theme';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Financial data changes when a sync runs, not second to second.
      staleTime: 60_000,
      retry: 1,
      refetchOnWindowFocus: true,
    },
  },
});

export default function RootLayout() {
  return (
    <QueryClientProvider client={queryClient}>
      <SafeAreaProvider>
        <StatusBar style="light" />
        <View style={{ flex: 1, backgroundColor: theme.color.background }}>
          <AuthGate />
        </View>
      </SafeAreaProvider>
    </QueryClientProvider>
  );
}

/**
 * Keeps the route group in sync with auth state: signed-out users are pushed
 * to the sign-in screen, signed-in users away from it.
 */
function AuthGate() {
  const status = useSession((s) => s.status);
  const restore = useSession((s) => s.restore);
  const router = useRouter();
  const segments = useSegments();

  useEffect(() => {
    void restore();
  }, [restore]);

  useEffect(() => {
    if (status === 'loading') return;

    const inAuthGroup = segments[0] === '(auth)';

    if (status === 'signed-out' && !inAuthGroup) {
      router.replace('/(auth)/sign-in');
    } else if (status === 'signed-in' && inAuthGroup) {
      router.replace('/(tabs)');
    }
  }, [status, segments, router]);

  if (status === 'loading') return <Loading label="Loading your household" />;

  // Do not render the route tree until the URL matches the auth state.
  //
  // Redirects happen in an effect, which runs *after* render. Without this
  // guard a signed-out cold start renders the tab screens for one frame
  // before the redirect fires, and those screens require a household — so
  // `useHouseholdId()` throws mid-render. On native the error boundary hides
  // it; in a browser it is a blank white page.
  const inAuthGroup = segments[0] === '(auth)';
  const settled = status === 'signed-in' ? !inAuthGroup : inAuthGroup;
  if (!settled) return <Loading />;

  return <Slot />;
}
