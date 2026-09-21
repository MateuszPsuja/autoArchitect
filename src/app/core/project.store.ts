import { computed, inject } from '@angular/core';
import { MarkdownRendererService } from './markdown-renderer.service';
import {
  patchState,
  signalStore,
  withComputed,
  withHooks,
  withMethods,
  withState,
} from '@ngrx/signals';
import { Plan } from './plan.schema';
import type { GeneratePromptInput } from './prompt-builder.service';
import type { PlannerRunProgress } from './planner-graph.service';
import { PlannerError } from './planner-error.model';
import { SavedPlanEntry } from './saved-plan-entry.model';
import { TokenUsage } from './token-usage.model';
import type { RefinementAnswer, RefinementQuestion } from './refinement/refinement.schema';
import type {
  RefinementChatSession,
  RefinementChatStatus,
  RefinementChatTurn,
} from './refinement/refinement-chat.schema';
import {
  REFINE_MORE_MAX_ROUNDS,
  REFINE_MORE_QUESTION,
  REFINE_MORE_QUESTION_ID,
} from './refinement/refinement.constants';
import { StateSnapshot } from './state-snapshot.model';
import { MICROBLOG_DEMO_PLAN } from './demo-plan/microblog.plan';
import { PERSIST_DEBOUNCE_MS, PLANNER_INPUT_STORAGE_KEY } from './persistence.constants';
import { AuditFinding } from './audit-runner.service';
import { DiagramAuditReport, DiagramAuditService } from './diagram-audit.service';
import {
  computeUserEditSummary,
  UserEditSummary,
} from './diff/user-edit-summary';
import {
  CONFIG_STORAGE_KEY,
  DEMO_DISMISSED_KEY,
  DEMO_SAVED_PLAN_ID,
  PLAN_STORAGE_KEY,
  SAVED_PLANS_STORAGE_KEY,
  hydrateConfig,
  hydratePlan,
  hydrateSavedPlans,
  refreshDemoPlanEntries,
  refreshStaleDemoPlan,
  seedDemoPlan,
} from './hydration';

let persistTimeout: ReturnType<typeof setTimeout> | null = null;

export type LlmProvider = 'openrouter' | 'lmstudio' | 'claude' | 'chatgpt' | 'grok' | 'minimax';

export interface AgentActivity {

  id: string;

  stage: string;

  agentId: string | null;

  skillId: string | null;

  label: string | null;

  startedAt: number;

  kind: 'stage' | 'parallel-job' | 'audit-repair' | 'pdf';
}

export interface ProviderSlotConfig {
  selectedModel: string;
  customBaseUrl: string;
  defaultTemperature: number;
  defaultMaxTokens: number;
}

export type ProviderConfigsMap = Record<LlmProvider, ProviderSlotConfig>;

export interface PlannerConfigState {
  provider: LlmProvider;
  providerConfigs: ProviderConfigsMap;
  auditRepairMaxAttempts: number;
  parallelSectionConcurrency: number;

  plannerMaxAttempts: number;

  requestTimeoutMs: number;
}

const CONFIG_STORAGE_VERSION = 3;

export function defaultProviderConfigs(
  overrides: Partial<Record<LlmProvider, Partial<ProviderSlotConfig>>> = {},
): ProviderConfigsMap {
  const providerBaseUrls: Record<LlmProvider, string> = {
    openrouter: 'https://openrouter.ai/api/v1',
    lmstudio: 'http://localhost:1234/v1',
    claude: 'https://api.anthropic.com',
    chatgpt: 'https://api.openai.com/v1',
    grok: 'https://api.x.ai/v1',
    minimax: 'https://api.minimax.io/v1',
  };
  const providerIds: readonly LlmProvider[] = [
    'openrouter',
    'lmstudio',
    'claude',
    'chatgpt',
    'grok',
    'minimax',
  ];
  const map = {} as ProviderConfigsMap;
  for (const id of providerIds) {
    const baseUrl = providerBaseUrls[id];
    const override = overrides[id];
    map[id] = {
      selectedModel: override?.selectedModel ?? '',
      customBaseUrl: override?.customBaseUrl ?? baseUrl,
      defaultTemperature: override?.defaultTemperature ?? 0.2,
      defaultMaxTokens: override?.defaultMaxTokens ?? 16_384,
    };
  }
  return map;
}

export function getActiveSlot(state: PlannerConfigState): ProviderSlotConfig {
  return state.providerConfigs[state.provider];
}

export interface RefinementState {
  status: 'idle' | 'loading_questions' | 'asking' | 'completed' | 'error';
  originalInput: GeneratePromptInput | null;
  questions: RefinementQuestion[];
  currentIndex: number;
  answers: RefinementAnswer[];
  draftValue: string;
  error: string | null;
  roundCount: number;
  pendingRefineMore: boolean;
}

function createInitialRefinementState(): RefinementState {
  return {
    status: 'idle',
    originalInput: null,
    questions: [],
    currentIndex: 0,
    answers: [],
    draftValue: '',
    error: null,
    roundCount: 0,
    pendingRefineMore: false,
  };
}

function isRefineMoreQuestion(question: RefinementQuestion | undefined): boolean {
  return !!question && question.id === REFINE_MORE_QUESTION_ID;
}

function pickSkipSubstitute(question: RefinementQuestion | undefined): string | null {
  if (!question) return null;
  const recommended = question.recommended?.trim();
  if (recommended) return recommended;
  if (question.type === 'single_choice' && question.options && question.options.length > 0) {
    return question.options[0];
  }
  return null;
}

export type RefinementChatUiStatus =
  | 'idle'
  | 'thinking'
  | 'asking'
  | 'ready'
  | 'applying'
  | 'error';

export interface RefinementChatState {
  status: RefinementChatUiStatus;
  error: string | null;
  draft: string;
  activeSessionId: string | null;
}

function createInitialRefinementChatState(): RefinementChatState {
  return {
    status: 'idle',
    error: null,
    draft: '',
    activeSessionId: null,
  };
}

interface ProjectState {
  providerApiKeys: Record<LlmProvider, string>;
  plan: Plan | null;
  pendingInput: GeneratePromptInput | null;

  pendingResume: PlannerRunProgress | null;
  availableModels: string[];
  isGenerating: boolean;
  streamBuffer: string;
  error: PlannerError | null;
  tokenStats: TokenUsage | null;
  pdfTokenStats: TokenUsage | null;
  markdownOverrides: Record<string, string>;

  lastSavedPlanRef: Plan | null;
  lastGeneratedPlanRef: Plan | null;
  isRegenerating: boolean;
  regenerateError: PlannerError | null;
  userEditSummary: UserEditSummary | null;
  lastOriginalInput: GeneratePromptInput | null;
  savedPlans: SavedPlanEntry[];
  config: PlannerConfigState;
  lastAuditFindings: AuditFinding[];
  activeActivities: AgentActivity[];
  diagramAudit: DiagramAuditReport | null;
  refinement: RefinementState;
  refinementChat: RefinementChatState;

  synthesisedDiagramPatches: Record<string, string>;

  plannerResetTick: number;
}

const initialState: ProjectState = {
  providerApiKeys: {
    openrouter: '',
    lmstudio: '',
    claude: '',
    chatgpt: '',
    grok: '',
    minimax: '',
  },
  plan: null,
  pendingInput: null,
  pendingResume: null,
  availableModels: [],
  isGenerating: false,
  streamBuffer: '',
  error: null,
  tokenStats: null,
  pdfTokenStats: null,
  markdownOverrides: {},
  lastSavedPlanRef: null,
  lastGeneratedPlanRef: null,
  isRegenerating: false,
  regenerateError: null,
  userEditSummary: null,
  lastOriginalInput: null,
  savedPlans: [],
  config: {
    provider: 'openrouter' as LlmProvider,
    providerConfigs: defaultProviderConfigs(),
    auditRepairMaxAttempts: 1,
    parallelSectionConcurrency: 6,
    plannerMaxAttempts: 75,
    requestTimeoutMs: 600_000,
  },
  lastAuditFindings: [],
  activeActivities: [],
  diagramAudit: null,
  refinement: createInitialRefinementState(),
  refinementChat: createInitialRefinementChatState(),
  synthesisedDiagramPatches: {},
  plannerResetTick: 0,
};

export const ProjectStore = signalStore(
  { providedIn: 'root' },
  withState(initialState),
  withComputed((store, markdownRenderer = inject(MarkdownRendererService)) => ({
    hasPlan: computed(() => !!store.plan()),

    isCurrentPlanSaved: computed(() => {
      const plan = store.plan();
      if (!plan) return false;
      if (plan !== store.lastSavedPlanRef()) return false;
      return Object.keys(store.markdownOverrides()).length === 0;
    }),
    hasUserChanges: computed(() => {
      const plan = store.plan();
      const baseline = store.lastGeneratedPlanRef();
      if (!plan) return false;
      if (!baseline) return false;
      if (plan !== baseline) return true;
      return Object.keys(store.markdownOverrides()).length > 0;
    }),
    modifiedFilesCount: computed(() => Object.keys(store.markdownOverrides()).length),
    apiKey: computed(() => store.providerApiKeys()[store.config().provider] ?? ''),
    activeConfig: computed(() => getActiveSlot(store.config())),
    hasPdfTokenStats: computed(() => store.pdfTokenStats() !== null),



    derivedFiles: computed(() => {
      const plan = store.plan();
      return plan ? markdownRenderer.toMarkdownFiles(plan) : [];
    }),
    activeAgents: computed(() => {
      const map = new Map<string, { agentId: string; count: number }>();
      for (const activity of store.activeActivities()) {
        if (!activity.agentId) continue;
        const key = activity.agentId;
        const existing = map.get(key);
        if (existing) {
          existing.count += 1;
        } else {
          map.set(key, { agentId: activity.agentId, count: 1 });
        }
      }
      return [...map.values()];
    }),
  })),
  withMethods((store, diagramAudit = inject(DiagramAuditService)) => ({
    setApiKey(apiKey: string, provider: LlmProvider): void {
      patchState(store, {
        providerApiKeys: { ...store.providerApiKeys(), [provider]: apiKey },
      });
      persistToLocalStorage(store);
    },
    clearApiKey(provider: LlmProvider): void {
      patchState(store, {
        providerApiKeys: { ...store.providerApiKeys(), [provider]: '' },
      });
      persistToLocalStorage(store);
    },
    clearAllApiKeys(): void {
      const cleared = Object.fromEntries(
        Object.keys(store.providerApiKeys()).map((p) => [p, '']),
      ) as Record<LlmProvider, string>;
      patchState(store, { providerApiKeys: cleared });
      persistToLocalStorage(store);
    },
    providerApiKeyFor(provider: LlmProvider): string {
      return store.providerApiKeys()[provider] ?? '';
    },
    setAvailableModels(models: string[]): void {
      patchState(store, { availableModels: models });
    },
    setIsGenerating(isGenerating: boolean): void {
      patchState(store, { isGenerating });
      if (!isGenerating) {



        void this.runDiagramAudit();
      }
    },
    async runDiagramAudit(): Promise<void> {
      try {
        const report = await diagramAudit.auditPlan(store.plan());
        patchState(store, { diagramAudit: report });
      } catch {



        patchState(store, { diagramAudit: null });
      }
    },

    clearDiagramAudit(): void {
      patchState(store, { diagramAudit: null });
    },

    setDiagramAuditRepaired(repaired: number): void {
      const current = store.diagramAudit();
      if (!current) return;
      patchState(store, {
        diagramAudit: { ...current, repaired: Math.max(0, Math.floor(repaired)) },
      });
    },

    mergeSynthesisedDiagramPatches(patches: Record<string, string>): void {
      if (Object.keys(patches).length === 0) return;
      patchState(store, {
        synthesisedDiagramPatches: { ...store.synthesisedDiagramPatches(), ...patches },
      });
    },
    setConfig(config: PlannerConfigState): void {
      patchState(store, { config });
      persistToLocalStorage(store);
    },
    setPlan(
      plan: Plan,
      tokenStats: TokenUsage | null = store.tokenStats(),
      persist: boolean = true,
    ): void {



      const normalized = refreshStaleDemoPlan(plan);



      patchState(store, {
        plan: normalized,
        tokenStats,
        error: null,
        synthesisedDiagramPatches: {},
        lastGeneratedPlanRef: normalized,
        userEditSummary: null,
        regenerateError: null,
        isRegenerating: false,
        lastSavedPlanRef: null,
      });
      if (persist) {
        persistToLocalStorage(store);
      }
      void this.runDiagramAudit();
    },
    replacePlanForUserEdit(plan: Plan): void {
      const normalized = refreshStaleDemoPlan(plan);
      patchState(store, {
        plan: normalized,
        error: null,
        lastSavedPlanRef: null,
        userEditSummary: null,
      });
      persistToLocalStorage(store);
      void this.runDiagramAudit();
    },
    setLastOriginalInput(input: GeneratePromptInput | null): void {
      patchState(store, { lastOriginalInput: input });
    },
    mergeTechnologyOverride(
      layers: Array<{ id: string; techStack: string[] }>,
      hints: string,
    ): void {
      const plan = store.plan();
      if (!plan) return;
      const nextLayers = plan.architectureLayers.map((layer) => {
        const override = layers.find((l) => l.id === layer.id);
        if (!override) return layer;
        const trimmed = override.techStack
          .map((entry) => entry.trim())
          .filter((entry) => entry.length > 0);
        const finalStack = trimmed.length > 0 ? trimmed : [''];
        return { ...layer, techStack: finalStack };
      });
      const nextPlan: Plan = {
        ...plan,
        architectureLayers: nextLayers,
        meta: { ...plan.meta, technologyHints: hints },
      };
      this.replacePlanForUserEdit(nextPlan);
    },
    captureUserEditSummary(): UserEditSummary | null {
      const plan = store.plan();
      const baseline = store.lastGeneratedPlanRef();
      if (!plan || !baseline) {
        patchState(store, { userEditSummary: null });
        return null;
      }
      const summary = computeUserEditSummary(plan, baseline, store.markdownOverrides());
      patchState(store, { userEditSummary: summary });
      return summary;
    },
    snapshotGeneration(plan: Plan): void {
      patchState(store, {
        lastGeneratedPlanRef: plan,
        userEditSummary: null,
        regenerateError: null,
      });
    },
    startRegenerate(): void {
      patchState(store, {
        isRegenerating: true,
        regenerateError: null,
        isGenerating: true,
      });
      if (store.activeActivities().length > 0) {
        patchState(store, { activeActivities: [] });
      }
      if (store.streamBuffer() !== '') {
        patchState(store, { streamBuffer: '' });
      }
    },
    completeRegenerate(plan: Plan): void {
      this.setPlan(plan, store.tokenStats());
      this.snapshotGeneration(plan);
      patchState(store, { isRegenerating: false, isGenerating: false });
      if (store.activeActivities().length > 0) {
        patchState(store, { activeActivities: [] });
      }
    },
    failRegenerate(err: PlannerError): void {
      patchState(store, {
        regenerateError: err,
        isRegenerating: false,
        isGenerating: false,
      });
      if (store.activeActivities().length > 0) {
        patchState(store, { activeActivities: [] });
      }
    },
    clearRegenerateError(): void {
      if (store.regenerateError() !== null) {
        patchState(store, { regenerateError: null });
      }
    },
    setPendingInput(input: GeneratePromptInput | null): void {
      patchState(store, { pendingInput: input });





      try {
        if (input) {
          if (typeof globalThis !== 'undefined' && globalThis.localStorage) {
            globalThis.localStorage.setItem(PLANNER_INPUT_STORAGE_KEY, JSON.stringify(input));
          }
        } else if (typeof globalThis !== 'undefined' && globalThis.localStorage) {
          globalThis.localStorage.removeItem(PLANNER_INPUT_STORAGE_KEY);
        }
      } catch {

      }
    },
    setPendingResume(progress: PlannerRunProgress | null): void {
      patchState(store, { pendingResume: progress });
    },
    startRefinement(input: GeneratePromptInput): void {
      patchState(store, {
        refinement: {
          ...createInitialRefinementState(),
          status: 'loading_questions',
          originalInput: input,
        },
      });
    },
    setRefinementQuestions(questions: RefinementQuestion[]): void {
      const refinement = store.refinement();
      const trimmed = questions.slice(0, 5);
      const atCap = refinement.roundCount >= REFINE_MORE_MAX_ROUNDS;
      const withTerminator =
        trimmed.length > 0 && !atCap ? [...trimmed, REFINE_MORE_QUESTION] : trimmed;
      patchState(store, {
        refinement: {
          ...refinement,
          status: withTerminator.length > 0 ? 'asking' : 'completed',
          questions: withTerminator,
          currentIndex: 0,
          answers: [],
          draftValue: '',
          error: null,
          pendingRefineMore: false,
        },
      });
    },
    setRefinementDraft(value: string): void {
      patchState(store, {
        refinement: { ...store.refinement(), draftValue: value },
      });
    },
    submitRefinementAnswer(answer: RefinementAnswer): void {
      const refinement = store.refinement();
      const question = refinement.questions[refinement.currentIndex];
      if (refinement.status !== 'asking' || !question || answer.questionId !== question.id) {
        return;
      }
      const value = answer.value.trim();
      if (!value || answer.skipped) {
        return;
      }
      const answers = [
        ...refinement.answers,
        { questionId: question.id, value, skipped: false },
      ];
      const isTerminator = isRefineMoreQuestion(question);
      const isLast = refinement.currentIndex >= refinement.questions.length - 1;

      if (isTerminator && value === REFINE_MORE_QUESTION.options![0]) {
        patchState(store, {
          refinement: {
            ...refinement,
            status: 'loading_questions',
            currentIndex: refinement.currentIndex + 1,
            answers,
            draftValue: '',
            roundCount: refinement.roundCount + 1,
            pendingRefineMore: true,
          },
        });
        return;
      }

      patchState(store, {
        refinement: {
          ...refinement,
          status: isLast ? 'completed' : 'asking',
          currentIndex: isLast ? refinement.currentIndex : refinement.currentIndex + 1,
          answers,
          draftValue: '',
          ...(isTerminator ? { roundCount: refinement.roundCount + 1 } : {}),
        },
      });
    },
    skipRefinementQuestion(): void {
      const refinement = store.refinement();
      const question = refinement.questions[refinement.currentIndex];
      if (refinement.status !== 'asking' || !question) {
        return;
      }
      const answers = [
        ...refinement.answers,
        { questionId: question.id, value: '', skipped: true },
      ];
      const isTerminator = isRefineMoreQuestion(question);
      const isLast = refinement.currentIndex >= refinement.questions.length - 1;
      patchState(store, {
        refinement: {
          ...refinement,
          status: isLast ? 'completed' : 'asking',
          currentIndex: isLast ? refinement.currentIndex : refinement.currentIndex + 1,
          answers,
          draftValue: '',
          ...(isTerminator ? { roundCount: refinement.roundCount + 1 } : {}),
        },
      });
    },
    requestMoreRefinementQuestions(): void {
      patchState(store, {
        refinement: {
          ...store.refinement(),
          status: 'loading_questions',
          error: null,
          pendingRefineMore: true,
        },
      });
    },
    skipRefinement(): void {
      patchState(store, {
        refinement: {
          ...createInitialRefinementState(),
          status: 'completed',
          originalInput: store.refinement().originalInput,
        },
      });
    },
    clearRefinement(): void {
      patchState(store, { refinement: createInitialRefinementState() });
    },
    setRefinementError(message: string): void {
      const refinement = store.refinement();
      patchState(store, {
        refinement: {
          ...refinement,
          status: 'error',
          error: message,
          questions: [],
          currentIndex: 0,
          answers: [],
          draftValue: '',
          pendingRefineMore: false,
        },
      });
    },
    startRefinementChat(): RefinementChatSession {
      const plan = store.plan();
      if (!plan) {
        throw new Error('Cannot start refinement chat without an active plan.');
      }
      const session: RefinementChatSession = {
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        status: 'open',
        turns: [],
      };
      const nextChats = [...plan.refinementChats, session];
      const nextPlan: Plan = { ...plan, refinementChats: nextChats };
      patchState(store, {
        plan: nextPlan,
        refinementChat: {
          status: 'idle',
          error: null,
          draft: '',
          activeSessionId: session.id,
        },
      });
      persistToLocalStorage(store);
      return session;
    },
    setActiveRefinementChat(sessionId: string | null): void {
      patchState(store, {
        refinementChat: { ...store.refinementChat(), activeSessionId: sessionId },
      });
    },
    appendRefinementChatTurn(sessionId: string, turn: RefinementChatTurn): void {
      const plan = store.plan();
      if (!plan) return;
      const nextChats = plan.refinementChats.map((session) =>
        session.id === sessionId
          ? { ...session, turns: [...session.turns, turn] }
          : session,
      );
      patchState(store, { plan: { ...plan, refinementChats: nextChats } });
      persistToLocalStorage(store);
    },
    setRefinementChatDraft(value: string): void {
      patchState(store, {
        refinementChat: { ...store.refinementChat(), draft: value },
      });
    },
    setRefinementChatStatus(status: RefinementChatUiStatus, error: string | null = null): void {
      patchState(store, {
        refinementChat: { ...store.refinementChat(), status, error },
      });
    },
    setRefinementChatQuestions(sessionId: string, questions: RefinementQuestion[]): void {
      const plan = store.plan();
      if (!plan) return;
      const nextChats = plan.refinementChats.map((session) => {
        if (session.id !== sessionId) return session;
        const turn: RefinementChatTurn = {
          role: 'assistant',
          kind: 'questions',
          questions,
          at: new Date().toISOString(),
        };
        return {
          ...session,
          status: 'awaiting_answers' as RefinementChatStatus,
          pendingQuestions: questions,
          pendingAnswers: [],
          turns: [...session.turns, turn],
        };
      });
      const nextPlan: Plan = { ...plan, refinementChats: nextChats };
      patchState(store, {
        plan: nextPlan,
        refinementChat: { ...store.refinementChat(), status: 'asking', error: null },
      });
      persistToLocalStorage(store);
    },
    setRefinementChatAnswer(sessionId: string, questionId: string, value: string): void {
      const plan = store.plan();
      if (!plan) return;
      const nextChats = plan.refinementChats.map((session) => {
        if (session.id !== sessionId) return session;
        const existing = session.pendingAnswers ?? [];
        const withoutExisting = existing.filter((a) => a.questionId !== questionId);
        const nextAnswers = [
          ...withoutExisting,
          { questionId, value, skipped: false },
        ];
        return { ...session, pendingAnswers: nextAnswers };
      });
      patchState(store, { plan: { ...plan, refinementChats: nextChats } });
      persistToLocalStorage(store);
    },
    skipRefinementChatAnswer(sessionId: string, questionId: string): void {
      const plan = store.plan();
      if (!plan) return;
      const nextChats = plan.refinementChats.map((session) => {
        if (session.id !== sessionId) return session;
        const existing = session.pendingAnswers ?? [];
        const withoutExisting = existing.filter((a) => a.questionId !== questionId);
        const question = (session.pendingQuestions ?? []).find((q) => q.id === questionId);
        const substituted = pickSkipSubstitute(question);
        const answer = substituted !== null
          ? { questionId, value: substituted, skipped: false }
          : { questionId, value: '', skipped: true };
        return { ...session, pendingAnswers: [...withoutExisting, answer] };
      });
      patchState(store, { plan: { ...plan, refinementChats: nextChats } });
      persistToLocalStorage(store);
    },
    skipAllRefinementChatAnswers(sessionId: string): void {
      const plan = store.plan();
      if (!plan) return;
      const nextChats = plan.refinementChats.map((session) => {
        if (session.id !== sessionId) return session;
        const questions = session.pendingQuestions ?? [];
        const existing = session.pendingAnswers ?? [];
        const hasRealAnswer = (questionId: string) =>
          existing.some((a) => a.questionId === questionId && !a.skipped);
        const appended: { questionId: string; value: string; skipped: boolean }[] = [];
        for (const question of questions) {
          if (hasRealAnswer(question.id)) continue;
          const substituted = pickSkipSubstitute(question);
          if (substituted !== null) {
            appended.push({ questionId: question.id, value: substituted, skipped: false });
          } else {
            appended.push({ questionId: question.id, value: '', skipped: true });
          }
        }
        if (appended.length === 0) return session;
        return {
          ...session,
          pendingAnswers: [...existing, ...appended],
        };
      });
      patchState(store, { plan: { ...plan, refinementChats: nextChats } });
      persistToLocalStorage(store);
    },
    submitRefinementChatAnswers(sessionId: string, finalInstruction: string): void {
      const plan = store.plan();
      if (!plan) return;
      const nextChats = plan.refinementChats.map((session) => {
        if (session.id !== sessionId) return session;
        const finalizedTurn: RefinementChatTurn = {
          role: 'assistant',
          kind: 'finalized',
          instruction: finalInstruction,
          at: new Date().toISOString(),
        };
        const collectedAnswers = (session.pendingAnswers ?? []).map((answer) => ({
          ...answer,
          question: session.pendingQuestions?.find((question) => question.id === answer.questionId)?.question ?? '',
        }));
        return {
          ...session,
          status: 'ready' as RefinementChatStatus,
          finalInstruction,
          collectedAnswers,
          pendingQuestions: undefined,
          pendingAnswers: undefined,
          turns: [...session.turns, finalizedTurn],
        };
      });
      patchState(store, {
        plan: { ...plan, refinementChats: nextChats },
        refinementChat: { ...store.refinementChat(), status: 'ready', error: null },
      });
      persistToLocalStorage(store);
    },
    markRefinementChatApplied(sessionId: string, planGeneratedAt: string): void {
      const plan = store.plan();
      if (!plan) return;
      const nextChats = plan.refinementChats.map((session) =>
        session.id === sessionId
          ? {
              ...session,
              status: 'applied' as RefinementChatStatus,
              appliedPlanGeneratedAt: planGeneratedAt,
            }
          : session,
      );
      patchState(store, {
        plan: { ...plan, refinementChats: nextChats },
        refinementChat: { ...store.refinementChat(), status: 'idle', error: null },
      });
      persistToLocalStorage(store);
    },
    cancelRefinementChat(sessionId: string): void {
      const plan = store.plan();
      if (!plan) return;
      const session = plan.refinementChats.find((s) => s.id === sessionId);
      const nextChats = plan.refinementChats
        .map((s) => (s.id === sessionId ? { ...s, status: 'cancelled' as RefinementChatStatus } : s))
        .filter((s) => !(s.id === sessionId && session && session.turns.length === 0));
      patchState(store, {
        plan: { ...plan, refinementChats: nextChats },
        refinementChat: createInitialRefinementChatState(),
      });
      persistToLocalStorage(store);
    },
    clearAllRefinementChats(): void {
      const plan = store.plan();
      if (!plan) return;
      patchState(store, {
        plan: { ...plan, refinementChats: [] },
        refinementChat: createInitialRefinementChatState(),
      });
      persistToLocalStorage(store);
    },
    setStreamBuffer(streamBuffer: string): void {
      patchState(store, { streamBuffer });
    },
    appendStream(chunk: string): void {
      patchState(store, { streamBuffer: `${store.streamBuffer()}${chunk}` });
    },
    setError(error: PlannerError | null): void {
      patchState(store, { error });
    },
    setWarning(warning: string | null): void {
      const current = store.error();
      if (warning === null) {
        if (current && current.type === 'warning') {
          patchState(store, { error: null });
        }
        return;
      }
      if (current && current.type !== 'warning') return;
      patchState(store, {
        error: { type: 'warning', message: warning },
      });
    },
    setLastAuditFindings(findings: AuditFinding[]): void {
      patchState(store, { lastAuditFindings: findings });
    },

    startActivity(input: Omit<AgentActivity, 'id' | 'startedAt'>): string {
      const id = `act-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`;
      const entry: AgentActivity = {
        ...input,
        id,
        startedAt: Date.now(),
      };
      const next = store
        .activeActivities()
        .filter((existing) => !(existing.stage === entry.stage && existing.label === entry.label));
      patchState(store, { activeActivities: [...next, entry] });
      return id;
    },
    finishActivity(id: string): void {
      const next = store.activeActivities().filter((a) => a.id !== id);
      if (next.length !== store.activeActivities().length) {
        patchState(store, { activeActivities: next });
      }
    },
    clearActivities(): void {
      if (store.activeActivities().length > 0) {
        patchState(store, { activeActivities: [] });
      }
    },
    setTokenStats(tokenStats: TokenUsage | null): void {
      patchState(store, { tokenStats });
      persistToLocalStorage(store);
    },
    setPdfTokenStats(pdfTokenStats: TokenUsage | null): void {
      patchState(store, { pdfTokenStats });
    },
    upsertMarkdownOverride(path: string, content: string): void {
      patchState(store, {
        markdownOverrides: {
          ...store.markdownOverrides(),
          [path]: content,
        },
      });
    },
    removeMarkdownOverride(path: string): void {
      const copy = { ...store.markdownOverrides() };
      delete copy[path];
      patchState(store, { markdownOverrides: copy });
    },
    clearMarkdownOverrides(paths?: string[]): void {
      if (!paths || paths.length === 0) {
        patchState(store, { markdownOverrides: {} });
        return;
      }

      const copy = { ...store.markdownOverrides() };
      for (const path of paths) {
        delete copy[path];
      }
      patchState(store, { markdownOverrides: copy });
    },
    replaceState(snapshot: StateSnapshot): void {
      localStorage.removeItem(PLAN_STORAGE_KEY);
      localStorage.removeItem(CONFIG_STORAGE_KEY);
      localStorage.removeItem(SAVED_PLANS_STORAGE_KEY);
      patchState(store, {
        providerApiKeys: { ...initialState.providerApiKeys, ...snapshot.providerApiKeys },
        config: snapshot.config,
        plan: snapshot.plan ? refreshStaleDemoPlan(snapshot.plan) : null,
        tokenStats: snapshot.tokenStats,
        pdfTokenStats: null,
        markdownOverrides: { ...snapshot.markdownOverrides },
        savedPlans: [...snapshot.savedPlans],
        error: null,
        lastGeneratedPlanRef: snapshot.plan ?? null,
        userEditSummary: null,
        regenerateError: null,
        isRegenerating: false,
        lastOriginalInput: null,

        lastSavedPlanRef: null,
      });
      persistToLocalStorage(store);
    },
    setSavedPlans(savedPlans: SavedPlanEntry[]): void {
      patchState(store, { savedPlans });
      persistToLocalStorage(store);
    },
    savePlan(entry: SavedPlanEntry): void {
      const withoutCurrent = store.savedPlans().filter((saved) => saved.id !== entry.id);
      patchState(store, {
        savedPlans: [entry, ...withoutCurrent].sort((a, b) => b.savedAt.localeCompare(a.savedAt)),





        lastSavedPlanRef: entry.plan,
      });
      persistToLocalStorage(store);
    },
    deleteSavedPlan(id: string): void {
      if (id === DEMO_SAVED_PLAN_ID) {
        return;
      }
      patchState(store, {
        savedPlans: store.savedPlans().filter((saved) => saved.id !== id),
      });
      persistToLocalStorage(store);
    },
    loadSavedPlan(id: string): void {
      const entry = store.savedPlans().find((saved) => saved.id === id);
      if (!entry) {
        return;
      }



      patchState(store, {
        pendingInput: null,
        plannerResetTick: store.plannerResetTick() + 1,
      });
      try {
        if (typeof globalThis !== 'undefined' && globalThis.localStorage) {
          globalThis.localStorage.removeItem(PLANNER_INPUT_STORAGE_KEY);
        }
      } catch {

      }



      if (entry.id === DEMO_SAVED_PLAN_ID) {
        const refreshed: SavedPlanEntry = {
          ...entry,
          plan: MICROBLOG_DEMO_PLAN,
          title: MICROBLOG_DEMO_PLAN.meta.title,
          savedAt: MICROBLOG_DEMO_PLAN.meta.generatedAt,
        };
        const withoutCurrent = store.savedPlans().filter((saved) => saved.id !== entry.id);
        patchState(store, {
          savedPlans: [refreshed, ...withoutCurrent].sort((a, b) =>
            b.savedAt.localeCompare(a.savedAt),
          ),
        });
        persistToLocalStorage(store);
        patchState(store, {
          plan: refreshed.plan,
          tokenStats: refreshed.tokenStats,
          error: null,
          lastGeneratedPlanRef: refreshed.plan,
          userEditSummary: null,
          regenerateError: null,
          isRegenerating: false,
          lastOriginalInput: refreshed.lastOriginalInput ?? null,
          lastSavedPlanRef: refreshed.plan,
        });
        persistToLocalStorage(store);
        return;
      }
      patchState(store, {
        plan: entry.plan,
        tokenStats: entry.tokenStats,
        lastGeneratedPlanRef: entry.plan,
        userEditSummary: null,
        regenerateError: null,
        isRegenerating: false,
        lastOriginalInput: entry.lastOriginalInput ?? null,
        lastSavedPlanRef: entry.plan,
      });
      persistToLocalStorage(store);
    },
    closePlan(): void {
      patchState(store, {
        plan: null,
        error: null,
        markdownOverrides: {},
        tokenStats: null,
        pdfTokenStats: null,
        lastGeneratedPlanRef: null,
        userEditSummary: null,
        regenerateError: null,
        isRegenerating: false,
        lastOriginalInput: null,

        pendingInput: null,
        plannerResetTick: store.plannerResetTick() + 1,

        lastSavedPlanRef: null,
      });
      localStorage.removeItem(PLAN_STORAGE_KEY);
      try {
        if (typeof globalThis !== 'undefined' && globalThis.localStorage) {
          globalThis.localStorage.removeItem(PLANNER_INPUT_STORAGE_KEY);
        }
      } catch {

      }
    },

    dismissDemoPlan(): void {
      localStorage.setItem(DEMO_DISMISSED_KEY, '1');
      const remaining = store
        .savedPlans()
        .filter((saved: SavedPlanEntry) => saved.id !== DEMO_SAVED_PLAN_ID);
      if (remaining.length !== store.savedPlans().length) {
        patchState(store, { savedPlans: remaining });
        persistToLocalStorage(store);
      }
    },
  })),
  withHooks({
    onInit(store): void {
      hydrateFromLocalStorage(store);
    },
    onDestroy(store): void {
      persistToLocalStorage(store);
    },
  }),
);

function hydrateFromLocalStorage(store: any): void {
  const safeGet = (key: string): string | null => {
    try {
      if (typeof globalThis !== 'undefined' && globalThis.localStorage) {
        return globalThis.localStorage.getItem(key);
      }
    } catch {

    }
    return null;
  };
  const safeRemove = (key: string): void => {
    try {
      if (typeof globalThis !== 'undefined' && globalThis.localStorage) {
        globalThis.localStorage.removeItem(key);
      }
    } catch {

    }
  };
  const planResult = hydratePlan(safeGet(PLAN_STORAGE_KEY));
  if (planResult.reason === 'invalid') safeRemove(PLAN_STORAGE_KEY);
  if (planResult.plan) {
    store.setPlan(planResult.plan, planResult.tokenStats);
    const plan = planResult.plan as Plan;
    const missingSpecKitV3Fields =
      !plan.userStories ||
      plan.userStories.length === 0 ||
      !plan.constitution;
    if (missingSpecKitV3Fields) {
      store.setWarning(
        'This plan was last exported under spec-kit shape v2; re-generate to populate User Stories and the project constitution.',
      );
    } else {
      store.setWarning(null);
    }
  }

  const configResult = hydrateConfig(safeGet(CONFIG_STORAGE_KEY));
  if (configResult.reason === 'invalid') safeRemove(CONFIG_STORAGE_KEY);
  if (configResult.config) {
    patchState(store, { providerApiKeys: configResult.providerApiKeys });
    store.setConfig(configResult.config);
  }

  const savedPlansResult = hydrateSavedPlans(safeGet(SAVED_PLANS_STORAGE_KEY));
  if (savedPlansResult.reason === 'invalid') safeRemove(SAVED_PLANS_STORAGE_KEY);
  store.setSavedPlans(savedPlansResult.savedPlans);



  const rawPlannerInput = safeGet(PLANNER_INPUT_STORAGE_KEY);
  if (rawPlannerInput) {
    try {
      const parsed = JSON.parse(rawPlannerInput) as GeneratePromptInput;
      if (parsed && typeof parsed.title === 'string' && typeof parsed.idea === 'string') {
        patchState(store, { pendingInput: parsed });
      } else {
        safeRemove(PLANNER_INPUT_STORAGE_KEY);
      }
    } catch {
      safeRemove(PLANNER_INPUT_STORAGE_KEY);
    }
  }



  const dismissed = safeGet(DEMO_DISMISSED_KEY) === '1';
  let saved = seedDemoPlan(store.savedPlans(), dismissed);
  saved = refreshDemoPlanEntries(saved);
  if (saved.length !== store.savedPlans().length || saved !== store.savedPlans()) {
    store.setSavedPlans(saved);
  }

  const rehydratedPlan = store.plan();
  if (rehydratedPlan && findSavedPlanRef(store.savedPlans(), rehydratedPlan)) {
    patchState(store, { lastSavedPlanRef: rehydratedPlan });
  }
}

function findSavedPlanRef(
  savedPlans: SavedPlanEntry[],
  plan: Plan,
): boolean {
  return savedPlans.some(
    (entry) =>
      entry.plan.meta.title === plan.meta.title &&
      entry.plan.meta.generatedAt === plan.meta.generatedAt,
  );
}

function persistToLocalStorage(store: any): void {

  if (persistTimeout) {
    clearTimeout(persistTimeout);
  }
  persistTimeout = setTimeout(() => {
    try {
      const plan = store.plan();
      if (plan) {



        const tokenStats = store.tokenStats();
        const payload = { plan, tokenStats: tokenStats ?? null };
        localStorage.setItem(PLAN_STORAGE_KEY, JSON.stringify(payload));
      } else {
        localStorage.removeItem(PLAN_STORAGE_KEY);
      }



      const cfg = store.config();
      const safeConfig = {
        providerApiKeys: store.providerApiKeys(),
        provider: cfg.provider,
        providerConfigs: cfg.providerConfigs,
        auditRepairMaxAttempts: cfg.auditRepairMaxAttempts,
        parallelSectionConcurrency: cfg.parallelSectionConcurrency,
        plannerMaxAttempts: cfg.plannerMaxAttempts,
        requestTimeoutMs: cfg.requestTimeoutMs,
      };
      const wrapped = { v: CONFIG_STORAGE_VERSION, config: safeConfig };
      localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(wrapped));

      localStorage.setItem(SAVED_PLANS_STORAGE_KEY, JSON.stringify(store.savedPlans()));
    } catch (e) {





      if (isQuotaExceeded(e)) {
        const plan = store.plan();
        const bytes = plan ? byteLengthOf(plan) : 0;
        const mb = (bytes / (1024 * 1024)).toFixed(1);
        const message =
          bytes > 0
            ? `Plan too large to persist locally (${mb} MB). Use Download zip before refreshing.`
            : 'localStorage quota exceeded while saving the plan.';
        patchState(store, { error: { type: 'persistence', message, bytes } });
      }
      // eslint-disable-next-line no-console
      console.warn('Failed to persist to localStorage', e);
    } finally {
      persistTimeout = null;
    }
  }, PERSIST_DEBOUNCE_MS);
}

function isQuotaExceeded(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }



  const name = (error as { name?: string }).name;
  if (
    name === 'QuotaExceededError' ||
    name === 'QuotaExceeded' ||
    name === 'NS_ERROR_DOM_QUOTA_REACHED'
  ) {
    return true;
  }

  const code = (error as { code?: number }).code;
  return code === 22 || code === 1014;
}

function byteLengthOf(value: unknown): number {
  try {
    return JSON.stringify(value).length;
  } catch {
    return 0;
  }
}
