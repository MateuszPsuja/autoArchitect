import { Plan, PlanSchema } from '../plan.schema';

import raw from '../../../assets/data/microblog-demo.plan.json';

export interface DemoPlanFixture {
  plan: Plan;
}

let cached: DemoPlanFixture | null = null;

export function loadDemoPlanFixture(): DemoPlanFixture {
  if (cached) return cached;
  cached = { plan: PlanSchema.parse(raw) as Plan };
  return cached;
}
