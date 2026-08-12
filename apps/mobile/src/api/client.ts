import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';
import type {
  AccountDTO,
  BudgetStatusDTO,
  ConnectionDTO,
  GoalDTO,
  ImportPreviewDTO,
  InstitutionDTO,
  OverviewDTO,
  TransactionDTO,
} from '@household/shared';

/**
 * Typed API client.
 *
 * Tokens live in SecureStore (Keychain / Android Keystore), never in
 * AsyncStorage — this app's session reads a household's entire financial
 * history, so it deserves the same storage a banking app would use.
 */

const ACCESS_TOKEN_KEY = 'household.accessToken';
const REFRESH_TOKEN_KEY = 'household.refreshToken';

const baseUrl: string =
  (Constants.expoConfig?.extra?.apiUrl as string | undefined) ?? 'http://localhost:3000/api/v1';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function getAccessToken(): Promise<string | null> {
  return SecureStore.getItemAsync(ACCESS_TOKEN_KEY);
}

export async function storeTokens(accessToken: string, refreshToken: string): Promise<void> {
  await Promise.all([
    SecureStore.setItemAsync(ACCESS_TOKEN_KEY, accessToken),
    SecureStore.setItemAsync(REFRESH_TOKEN_KEY, refreshToken),
  ]);
}

export async function clearTokens(): Promise<void> {
  await Promise.all([
    SecureStore.deleteItemAsync(ACCESS_TOKEN_KEY),
    SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY),
  ]);
}

/**
 * Single-flight refresh: several queries firing at once on a stale token must
 * not each spend the one-use refresh token, or all but the first get logged out.
 */
let refreshInFlight: Promise<boolean> | null = null;

async function refreshSession(): Promise<boolean> {
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async () => {
    const refreshToken = await SecureStore.getItemAsync(REFRESH_TOKEN_KEY);
    if (!refreshToken) return false;

    try {
      const response = await fetch(`${baseUrl}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });
      if (!response.ok) {
        await clearTokens();
        return false;
      }
      const data = (await response.json()) as { accessToken: string; refreshToken: string };
      await storeTokens(data.accessToken, data.refreshToken);
      return true;
    } catch {
      return false;
    } finally {
      refreshInFlight = null;
    }
  })();

  return refreshInFlight;
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  /** Multipart upload; skips JSON encoding. */
  formData?: FormData;
  /** Internal: prevents an infinite refresh loop. */
  retrying?: boolean;
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const token = await getAccessToken();

  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (!options.formData) headers['Content-Type'] = 'application/json';

  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.formData ?? (options.body != null ? JSON.stringify(options.body) : undefined),
  });

  if (response.status === 401 && !options.retrying) {
    if (await refreshSession()) {
      return request<T>(path, { ...options, retrying: true });
    }
  }

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  const payload: unknown = text ? JSON.parse(text) : {};

  if (!response.ok) {
    const error = (payload as { error?: { code: string; message: string; details?: unknown } })
      .error;
    throw new ApiError(
      response.status,
      error?.code ?? 'unknown',
      error?.message ?? 'Something went wrong',
      error?.details,
    );
  }

  return payload as T;
}

// ---------------------------------------------------------------------------
// Endpoints
// ---------------------------------------------------------------------------

export interface AuthResult {
  user: { id: string; email: string; displayName: string };
  households?: { id: string; name: string; role: string }[];
  householdId?: string;
  accessToken: string;
  refreshToken: string;
}

export const api = {
  login: (email: string, password: string) =>
    request<AuthResult>('/auth/login', { method: 'POST', body: { email, password } }),

  register: (input: { email: string; password: string; displayName: string; householdName?: string }) =>
    request<AuthResult>('/auth/register', { method: 'POST', body: input }),

  me: () =>
    request<{
      id: string;
      email: string;
      displayName: string;
      households: { id: string; name: string; baseCurrency: string; role: string }[];
    }>('/auth/me'),

  overview: (householdId: string, period?: string) =>
    request<OverviewDTO>(
      `/households/${householdId}/overview${period ? `?period=${period}` : ''}`,
    ),

  accounts: (householdId: string) =>
    request<{ accounts: AccountDTO[] }>(`/households/${householdId}/accounts`),

  createAccount: (householdId: string, body: unknown) =>
    request<{ account: AccountDTO }>(`/households/${householdId}/accounts`, {
      method: 'POST',
      body,
    }),

  transactions: (householdId: string, params: Record<string, string | number | boolean> = {}) => {
    const query = new URLSearchParams(
      Object.entries(params).map(([k, v]) => [k, String(v)]),
    ).toString();
    return request<{ transactions: TransactionDTO[]; nextCursor: string | null }>(
      `/households/${householdId}/transactions${query ? `?${query}` : ''}`,
    );
  },

  updateTransaction: (
    householdId: string,
    transactionId: string,
    body: { categorySlug?: string; notes?: string | null; applyToSimilar?: boolean },
  ) =>
    request<{ transaction: TransactionDTO; alsoUpdated: number }>(
      `/households/${householdId}/transactions/${transactionId}`,
      { method: 'PATCH', body },
    ),

  categories: (householdId: string) =>
    request<{
      categories: {
        id: string;
        slug: string;
        name: string;
        groupSlug: string;
        groupName: string;
        kind: string;
        color: string;
      }[];
    }>(`/households/${householdId}/categories`),

  budget: (householdId: string, period?: string) =>
    request<BudgetStatusDTO>(
      `/households/${householdId}/budget${period ? `?period=${period}` : ''}`,
    ),

  saveBudget: (householdId: string, body: unknown) =>
    request<BudgetStatusDTO>(`/households/${householdId}/budget`, { method: 'PUT', body }),

  budgetSuggestion: (householdId: string, period?: string) =>
    request<{ period: string; lines: { categorySlug: string; limit: number; rollover: boolean }[] }>(
      `/households/${householdId}/budget/suggestion${period ? `?period=${period}` : ''}`,
    ),

  goals: (householdId: string) =>
    request<{ goals: GoalDTO[]; totalTarget: number; totalSaved: number }>(
      `/households/${householdId}/goals`,
    ),

  createGoal: (householdId: string, body: unknown) =>
    request<{ goal: GoalDTO }>(`/households/${householdId}/goals`, { method: 'POST', body }),

  contributeToGoal: (householdId: string, goalId: string, amount: number) =>
    request<{ goal: GoalDTO }>(`/households/${householdId}/goals/${goalId}/contributions`, {
      method: 'POST',
      body: { amount },
    }),

  institutions: (householdId: string) =>
    request<{ provider: string; institutions: InstitutionDTO[] }>(
      `/households/${householdId}/institutions`,
    ),

  connections: (householdId: string) =>
    request<{ connections: ConnectionDTO[] }>(`/households/${householdId}/connections`),

  startBankLink: (householdId: string, institutionId: string) =>
    request<{ connectionId: string; authUrl: string; expiresAt: string }>(
      `/households/${householdId}/connections`,
      { method: 'POST', body: { institutionId } },
    ),

  completeBankLink: (householdId: string, connectionId: string) =>
    request<{ connection: ConnectionDTO }>(
      `/households/${householdId}/connections/${connectionId}/complete`,
      { method: 'POST' },
    ),

  syncAll: (householdId: string) =>
    request<{ synced: number; imported: number }>(`/households/${householdId}/sync`, {
      method: 'POST',
    }),

  uploadStatement: (householdId: string, file: { uri: string; name: string; mimeType?: string }) => {
    const form = new FormData();
    // React Native's FormData takes this shape for a file part; the cast is
    // required because the DOM lib types only accept Blob here.
    form.append('file', {
      uri: file.uri,
      name: file.name,
      type: file.mimeType ?? 'text/csv',
    } as unknown as Blob);

    return request<ImportPreviewDTO>(`/households/${householdId}/imports`, {
      method: 'POST',
      formData: form,
    });
  },

  commitImport: (householdId: string, batchId: string, accountId: string, includeDuplicates = false) =>
    request<{ imported: number; skippedDuplicates: number; failed: number }>(
      `/households/${householdId}/imports/${batchId}/commit`,
      { method: 'POST', body: { batchId, accountId, includeDuplicates } },
    ),

  recurring: (householdId: string) =>
    request<{
      recurring: { label: string; monthlyAmount: number; monthsSeen: number; lastCharged: string }[];
      totalMonthly: number;
    }>(`/households/${householdId}/insights/recurring`),
};
