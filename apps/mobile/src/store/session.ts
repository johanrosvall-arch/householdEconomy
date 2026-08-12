import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { api, clearTokens, getAccessToken, storeTokens } from '../api/client';

/**
 * Session state: who is signed in and which household they are looking at.
 *
 * The household id is deliberately part of global state rather than a route
 * param — every screen needs it, and a household switch must invalidate all
 * cached data at once.
 */

const HOUSEHOLD_KEY = 'household.selectedId';

export interface Household {
  id: string;
  name: string;
  role: string;
  baseCurrency?: string;
}

interface SessionState {
  status: 'loading' | 'signed-out' | 'signed-in';
  user: { id: string; email: string; displayName: string } | null;
  households: Household[];
  householdId: string | null;
  error: string | null;

  restore: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  register: (input: {
    email: string;
    password: string;
    displayName: string;
    householdName: string;
  }) => Promise<void>;
  signOut: () => Promise<void>;
  selectHousehold: (id: string) => Promise<void>;
}

export const useSession = create<SessionState>((set, get) => ({
  status: 'loading',
  user: null,
  households: [],
  householdId: null,
  error: null,

  /** Called once at startup: a stored token means the user stays signed in. */
  restore: async () => {
    const token = await getAccessToken();
    if (!token) {
      set({ status: 'signed-out' });
      return;
    }

    try {
      const me = await api.me();
      const stored = await AsyncStorage.getItem(HOUSEHOLD_KEY);
      const households = me.households.map((h) => ({
        id: h.id,
        name: h.name,
        role: h.role,
        baseCurrency: h.baseCurrency,
      }));

      set({
        status: 'signed-in',
        user: { id: me.id, email: me.email, displayName: me.displayName },
        households,
        householdId:
          stored && households.some((h) => h.id === stored) ? stored : (households[0]?.id ?? null),
      });
    } catch {
      // A token that no longer works is the same as no token.
      await clearTokens();
      set({ status: 'signed-out' });
    }
  },

  signIn: async (email, password) => {
    set({ error: null });
    try {
      const result = await api.login(email, password);
      await storeTokens(result.accessToken, result.refreshToken);

      const households = (result.households ?? []).map((h) => ({
        id: h.id,
        name: h.name,
        role: h.role,
      }));
      const householdId = households[0]?.id ?? null;
      if (householdId) await AsyncStorage.setItem(HOUSEHOLD_KEY, householdId);

      set({ status: 'signed-in', user: result.user, households, householdId });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Could not sign in' });
      throw err;
    }
  },

  register: async (input) => {
    set({ error: null });
    try {
      const result = await api.register(input);
      await storeTokens(result.accessToken, result.refreshToken);

      const householdId = result.householdId ?? null;
      if (householdId) await AsyncStorage.setItem(HOUSEHOLD_KEY, householdId);

      set({
        status: 'signed-in',
        user: result.user,
        households: householdId
          ? [{ id: householdId, name: input.householdName, role: 'owner' }]
          : [],
        householdId,
      });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Could not create the account' });
      throw err;
    }
  },

  signOut: async () => {
    await clearTokens();
    await AsyncStorage.removeItem(HOUSEHOLD_KEY);
    set({ status: 'signed-out', user: null, households: [], householdId: null });
  },

  selectHousehold: async (id) => {
    if (!get().households.some((h) => h.id === id)) return;
    await AsyncStorage.setItem(HOUSEHOLD_KEY, id);
    set({ householdId: id });
  },
}));

/**
 * Household id for screens that cannot render without one. The tab navigator
 * only mounts when signed in, so this is safe there.
 */
export function useHouseholdId(): string {
  const householdId = useSession((s) => s.householdId);
  if (!householdId) throw new Error('No household selected');
  return householdId;
}
