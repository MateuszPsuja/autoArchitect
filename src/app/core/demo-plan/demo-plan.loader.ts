import { inject, provideAppInitializer } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { timeout, catchError } from 'rxjs/operators';
import { of } from 'rxjs';

import { Plan, PlanSchema } from '../plan.schema';
import { TokenUsage } from '../token-usage.model';

// Relative URL so the browser resolves it against `document.baseURI`, which
// honors `<base href="…">`. Absolute paths break under any non-root base-href
// (e.g. the GitHub Pages build served from `/autoarchitect/`).
const DEMO_PLAN_ASSET_URL = 'data/microblog-demo.plan.json';
const DEMO_PLAN_FETCH_TIMEOUT_MS = 5_000;

const DEMO_TOKEN_STATS: TokenUsage = {
  model: 'anthropic/claude-3.5-sonnet',
  promptTokens: 28104,
  completionTokens: 41973,
  totalTokens: 70077,
  startedAt: '2026-09-12T23:51:42.000Z',
  generatedAt: '2026-09-15T00:00:00.000Z',
  llmCalls: 6,
};

let cachedPlan: Plan | null = null;

export function provideDemoPlanInitializer() {
  return provideAppInitializer(async () => {
    const http = inject(HttpClient);
    try {
      const raw = await firstValueFrom(
        http
          .get<unknown>(DEMO_PLAN_ASSET_URL)
          .pipe(
            timeout({
              each: DEMO_PLAN_FETCH_TIMEOUT_MS,
              meta: { reason: 'demo-plan-load' },
            }),
            catchError((err) => {
              console.warn(`[demo-plan] fetch failed; demo plan disabled:`, err);
              return of(null);
            }),
          ),
      );
      if (!raw || typeof raw !== 'object') {
        console.warn('[demo-plan] empty or non-object response; demo plan disabled.');
        return;
      }
      const parsed = PlanSchema.safeParse(raw);
      if (!parsed.success) {
        console.warn(
          '[demo-plan] schema validation failed; demo plan disabled.',
          parsed.error.issues,
        );
        return;
      }
      cachedPlan = parsed.data as Plan;
    } catch (err) {
      console.warn('[demo-plan] unexpected loader failure; demo plan disabled:', err);
    }
  });
}

export function getDemoPlan(): Plan | null {
  return cachedPlan;
}

export function getDemoTokenStats(): TokenUsage | null {
  return cachedPlan ? DEMO_TOKEN_STATS : null;
}

export function isDemoPlan(plan: Plan | null | undefined): boolean {
  if (!plan || !plan.meta) return false;
  const demo = cachedPlan;
  if (!demo) return false;
  return plan.meta.title === demo.meta.title && plan.meta.generatedAt === demo.meta.generatedAt;
}

export function _resetDemoPlanCacheForTests(): void {
  cachedPlan = null;
}

export function _setDemoPlanCacheForTests(plan: Plan | null): void {
  cachedPlan = plan;
}
