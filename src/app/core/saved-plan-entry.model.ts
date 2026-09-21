import { Plan } from './plan.schema';
import { TokenUsage } from './token-usage.model';
import { GeneratePromptInput } from './prompt-builder.service';

export interface SavedPlanEntry {
  id: string;
  title: string;
  savedAt: string;
  model: string;
  tokenStats: TokenUsage | null;
  plan: Plan;
  lastOriginalInput?: GeneratePromptInput | null;
}
