import { patchState, signalStore, withHooks, withMethods, withState } from '@ngrx/signals';
import { AGENTS, Agent, Skill } from './agents.data';
import { PERSIST_DEBOUNCE_MS, STORAGE_KEYS } from './persistence.constants';

const AGENTS_STORAGE_KEY = STORAGE_KEYS.agents;

let persistTimeout: ReturnType<typeof setTimeout> | null = null;

interface AgentsState {
  agents: Agent[];
}

const initialState: AgentsState = {
  agents: structuredClone(AGENTS),
};

export interface ResolvedSkill {
  agentId: string;
  skill: Skill;
}

export const AgentsStore = signalStore(
  { providedIn: 'root' },
  withState(initialState),
  withMethods((store) => ({
    getAgent(id: string): Agent | undefined {
      return store.agents().find((a) => a.id === id);
    },
    resolveSkill(agentId: string, skillId: string): ResolvedSkill | null {
      const agent = store.agents().find((a) => a.id === agentId);
      if (!agent) return null;
      const skill = agent.skills.find((s) => s.id === skillId);
      if (!skill) return null;
      return { agentId, skill };
    },
    updateAgent(id: string, patch: Partial<Pick<Agent, 'name' | 'description'>>): void {
      const next = store
        .agents()
        .map((agent) => (agent.id === id ? { ...agent, ...patch } : agent));
      patchState(store, { agents: next });
      persistToLocalStorage(store);
    },
    addSkill(agentId: string, skill: Omit<Skill, 'id'>): void {
      const newSkill: Skill = { ...skill, id: crypto.randomUUID() };
      const next = store
        .agents()
        .map((agent) =>
          agent.id === agentId ? { ...agent, skills: [...agent.skills, newSkill] } : agent,
        );
      patchState(store, { agents: next });
      persistToLocalStorage(store);
    },
    updateSkill(agentId: string, skillId: string, patch: Partial<Omit<Skill, 'id'>>): void {
      const next = store.agents().map((agent) => {
        if (agent.id !== agentId) {
          return agent;
        }
        return {
          ...agent,
          skills: agent.skills.map((skill) =>
            skill.id === skillId ? { ...skill, ...patch } : skill,
          ),
        };
      });
      patchState(store, { agents: next });
      persistToLocalStorage(store);
    },
    removeSkill(agentId: string, skillId: string): void {
      const next = store
        .agents()
        .map((agent) =>
          agent.id === agentId
            ? { ...agent, skills: agent.skills.filter((skill) => skill.id !== skillId) }
            : agent,
        );
      patchState(store, { agents: next });
      persistToLocalStorage(store);
    },
    resetToDefault(id: string): void {
      const seed = AGENTS.find((a) => a.id === id);
      if (seed) {



        const restored: Agent = {
          ...structuredClone(seed),
          skills: structuredClone(seed.skills),
        };
        const next = store.agents().map((agent) => (agent.id === id ? restored : agent));
        patchState(store, { agents: next });
        persistToLocalStorage(store);
        return;
      }



      const exists = store.agents().some((a) => a.id === id);
      if (!exists) {
        return;
      }
      const next = store.agents().filter((agent) => agent.id !== id);
      patchState(store, { agents: next });
      persistToLocalStorage(store);
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

function isAgent(value: unknown): value is Agent {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return typeof v['id'] === 'string' && typeof v['name'] === 'string' && Array.isArray(v['skills']);
}

function isAgentArray(value: unknown): value is Agent[] {
  return Array.isArray(value) && value.every(isAgent);
}

function hydrateFromLocalStorage(store: any): void {
  const raw = safeGetItem(AGENTS_STORAGE_KEY);
  if (!raw) {
    return;
  }
  try {
    const parsed = JSON.parse(raw);
    const candidates = Array.isArray(parsed) ? parsed : parsed?.agents;
    if (!isAgentArray(candidates)) {
      localStorage.removeItem(AGENTS_STORAGE_KEY);
      return;
    }



    const migrated = migrateStaleSeededSkills(candidates);
    patchState(store, { agents: migrated });
    if (migrated !== candidates) {
      persistToLocalStorage(store);
    }
  } catch {
    localStorage.removeItem(AGENTS_STORAGE_KEY);
  }
}

function migrateStaleSeededSkills(candidates: Agent[]): Agent[] {
  let mutated = false;
  const next = candidates.map((agent) => {
    const seedAgent = AGENTS.find((a) => a.id === agent.id);
    if (!seedAgent) return agent;
    const persistedIds = new Set(agent.skills.map((s) => s.id));
    let agentMutated = false;
    const skills = agent.skills.map((skill) => {
      const seedSkill = seedAgent.skills.find((s) => s.id === skill.id);
      if (!seedSkill || seedSkill.version === undefined) return skill;
      const persistedVersion = (skill as { version?: number }).version;
      if (persistedVersion !== undefined && persistedVersion >= seedSkill.version) {
        return skill;
      }
      agentMutated = true;





      return {
        ...seedSkill,
        id: skill.id,
        version: seedSkill.version,
      };
    });





    const appended: Skill[] = [];
    for (const seedSkill of seedAgent.skills) {
      if (persistedIds.has(seedSkill.id)) continue;
      agentMutated = true;

      appended.push(structuredClone(seedSkill));
    }
    if (!agentMutated) return agent;
    mutated = true;
    return { ...agent, skills: [...skills, ...appended] };
  });
  return mutated ? next : candidates;
}

function persistToLocalStorage(store: any): void {
  if (persistTimeout) {
    clearTimeout(persistTimeout);
  }
  persistTimeout = setTimeout(() => {
    try {
      const payload = { agents: store.agents() };
      safeSetItem(AGENTS_STORAGE_KEY, JSON.stringify(payload));
    } catch (e) {

      // eslint-disable-next-line no-console
      console.warn('Failed to persist agents to localStorage', e);
    } finally {
      persistTimeout = null;
    }
  }, PERSIST_DEBOUNCE_MS);
}

function safeGetItem(key: string): string | null {
  try {
    if (typeof globalThis !== 'undefined' && globalThis.localStorage) {
      return globalThis.localStorage.getItem(key);
    }
  } catch {

  }
  return null;
}

function safeSetItem(key: string, value: string): void {
  try {
    if (typeof globalThis !== 'undefined' && globalThis.localStorage) {
      globalThis.localStorage.setItem(key, value);
    }
  } catch {

  }
}
