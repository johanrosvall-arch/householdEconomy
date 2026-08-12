import { useQuery } from '@tanstack/react-query';
import type { BudgetStatusDTO, OverviewDTO } from '@household/shared';
import { api } from './client';

/**
 * Compile-time regression guard. Not a runtime test — it is checked by
 * `tsc --noEmit` (i.e. `pnpm typecheck`) and never executed.
 *
 * The bug this catches: @tanstack/react-query v5 uses TypeScript's `NoInfer`,
 * which only exists from TS 5.4. Under an older compiler `NoInfer<T>` resolves
 * to an implicit `any`, and *every* `useQuery` in the app silently returns
 * `data: any`. Nothing fails — you simply lose all type safety across every
 * screen, and typos in field names compile fine.
 *
 * That is exactly what happened here: Expo SDK 51 pins TS 5.3.3, so the whole
 * mobile app was unknowingly untyped against the API.
 *
 * `IsAny<T>` exploits `any` being both assignable to and from everything, so
 * `1 & any` is `any` and `0 extends any` holds. If inference degrades again,
 * assigning `false` to a `true` type fails the build.
 */
type IsAny<T> = 0 extends 1 & T ? true : false;

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- type-level only
function inferenceProbe() {
  const overview = useQuery({
    queryKey: ['overview'],
    queryFn: () => api.overview('household-id'),
  });
  const budget = useQuery({
    queryKey: ['budget'],
    queryFn: () => api.budget('household-id'),
  });

  const overviewIsNotAny: IsAny<typeof overview.data> = false;
  const budgetIsNotAny: IsAny<typeof budget.data> = false;

  // And that it is the *right* type, not merely a non-any one.
  const typedOverview: OverviewDTO | undefined = overview.data;
  const typedBudget: BudgetStatusDTO | undefined = budget.data;

  return { overviewIsNotAny, budgetIsNotAny, typedOverview, typedBudget };
}

export type InferenceProbe = ReturnType<typeof inferenceProbe>;
