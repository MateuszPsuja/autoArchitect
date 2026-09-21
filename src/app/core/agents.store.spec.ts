import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentsStore } from './agents.store';
import { AGENTS } from './agents.data';

describe('AgentsStore', () => {
  let storage: Record<string, string>;

  beforeEach(() => {
    vi.useFakeTimers();
    storage = {};
    vi.stubGlobal('localStorage', {
      getItem: vi.fn((key: string) => storage[key] ?? null),
      setItem: vi.fn((key: string, value: string) => {
        storage[key] = value;
      }),
      removeItem: vi.fn((key: string) => {
        delete storage[key];
      }),
      clear: vi.fn(() => {
        storage = {};
      }),
    });
    TestBed.resetTestingModule();
  });

  afterEach(() => {
    vi.advanceTimersByTime(10_000);
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    TestBed.resetTestingModule();
  });

  it('seeds from AGENTS when localStorage is empty', () => {
    const store = TestBed.inject(AgentsStore);
    expect(store.agents().length).toBe(AGENTS.length);
    expect(store.agents()[0].id).toBe(AGENTS[0].id);
  });

  it('seeds every skill with a non-empty starter prompt', () => {
    const store = TestBed.inject(AgentsStore);
    for (const agent of store.agents()) {
      for (const skill of agent.skills) {
        expect(skill.prompt, `seed skill ${agent.id}/${skill.id} should have a prompt`).toBeTypeOf('string');
        expect(skill.prompt!.length, `seed skill ${agent.id}/${skill.id} prompt should be non-trivial`).toBeGreaterThan(80);
      }
    }
  });

  it('returns the matching agent from getAgent', () => {
    const store = TestBed.inject(AgentsStore);
    const agent = store.getAgent('agent-1');
    expect(agent?.name).toBe(AGENTS[0].name);
    expect(store.getAgent('nope')).toBeUndefined();
  });

  it('updateAgent merges the patch into the matching agent', () => {
    const store = TestBed.inject(AgentsStore);
    store.updateAgent('agent-1', { name: 'Renamed Agent', description: 'New desc' });
    const updated = store.getAgent('agent-1');
    expect(updated?.name).toBe('Renamed Agent');
    expect(updated?.description).toBe('New desc');
    expect(updated?.skills.length).toBe(AGENTS[0].skills.length);
  });

  it('updateAgent leaves non-matching agents untouched', () => {
    const store = TestBed.inject(AgentsStore);
    store.updateAgent('agent-1', { name: 'Renamed Agent' });
    expect(store.getAgent('agent-2')?.name).toBe(AGENTS[1].name);
  });

  it('addSkill appends a new skill with a generated id', () => {
    const store = TestBed.inject(AgentsStore);
    const originalLength = store.getAgent('agent-1')!.skills.length;
    store.addSkill('agent-1', { name: 'New Skill', description: 'd', prompt: 'p' });
    const updated = store.getAgent('agent-1')!;
    expect(updated.skills.length).toBe(originalLength + 1);
    const added = updated.skills[updated.skills.length - 1];
    expect(added.name).toBe('New Skill');
    expect(added.description).toBe('d');
    expect(added.prompt).toBe('p');
    expect(typeof added.id).toBe('string');
    expect(added.id.length).toBeGreaterThan(0);
  });

  it('updateSkill patches only the matching skill', () => {
    const store = TestBed.inject(AgentsStore);
    const skillId = AGENTS[0].skills[0].id;
    store.updateSkill('agent-1', skillId, { name: 'Updated', prompt: 'new prompt' });
    const skills = store.getAgent('agent-1')!.skills;
    expect(skills[0].name).toBe('Updated');
    expect(skills[0].prompt).toBe('new prompt');
    expect(skills[1].name).toBe(AGENTS[0].skills[1].name);
  });

  it('removeSkill drops the matching skill and keeps the others', () => {
    const store = TestBed.inject(AgentsStore);
    const skillId = AGENTS[0].skills[0].id;
    const originalLength = store.getAgent('agent-1')!.skills.length;
    store.removeSkill('agent-1', skillId);
    const skills = store.getAgent('agent-1')!.skills;
    expect(skills.length).toBe(originalLength - 1);
    expect(skills.some((s) => s.id === skillId)).toBe(false);
  });

  it('resetToDefault restores a seeded agent to its original values', () => {
    const store = TestBed.inject(AgentsStore);
    store.updateAgent('agent-1', { name: 'Mutated', description: 'Mutated desc' });
    store.addSkill('agent-1', { name: 'Extra' });
    store.updateSkill('agent-1', AGENTS[0].skills[0].id, { name: 'Mutated skill' });
    const originalPrompt = AGENTS[0].skills[0].prompt;
    expect(store.getAgent('agent-1')?.name).toBe('Mutated');
    expect(store.getAgent('agent-1')?.skills.length).toBe(AGENTS[0].skills.length + 1);

    store.resetToDefault('agent-1');

    const restored = store.getAgent('agent-1');
    expect(restored?.name).toBe(AGENTS[0].name);
    expect(restored?.description).toBe(AGENTS[0].description);
    expect(restored?.skills.length).toBe(AGENTS[0].skills.length);
    expect(restored?.skills[0].name).toBe(AGENTS[0].skills[0].name);
    expect(restored?.skills[0].prompt).toBe(originalPrompt);

    expect(store.getAgent('agent-2')?.name).toBe(AGENTS[1].name);
  });

  it('resetToDefault removes a user-added agent that has no seed entry', () => {
    storage['arc-planner:agents'] = JSON.stringify({
      agents: [
        AGENTS[0],
        { id: 'agent-custom', name: 'Custom', skills: [{ id: 's1', name: 'S' }] },
      ],
    });

    TestBed.resetTestingModule();
    const store = TestBed.inject(AgentsStore);
    expect(store.agents().some((a) => a.id === 'agent-custom')).toBe(true);

    store.resetToDefault('agent-custom');

    expect(store.agents().some((a) => a.id === 'agent-custom')).toBe(false);

    expect(store.getAgent('agent-1')?.name).toBe(AGENTS[0].name);
  });

  it('resetToDefault is a no-op for an unknown id', () => {
    const store = TestBed.inject(AgentsStore);
    const before = store.agents().length;
    store.resetToDefault('does-not-exist');
    expect(store.agents().length).toBe(before);
  });

  it('resetToDefault does not mutate the AGENTS seed', () => {
    const store = TestBed.inject(AgentsStore);
    const seedNameBefore = AGENTS[0].name;
    const seedSkillCountBefore = AGENTS[0].skills.length;
    store.resetToDefault('agent-1');
    expect(AGENTS[0].name).toBe(seedNameBefore);
    expect(AGENTS[0].skills.length).toBe(seedSkillCountBefore);
  });

  it('persists updates to localStorage after the debounce window', () => {
    const store = TestBed.inject(AgentsStore);
    store.updateAgent('agent-1', { name: 'Persisted Agent' });
    vi.advanceTimersByTime(250);

    const raw = storage['arc-planner:agents'];
    expect(raw).toBeDefined();
    const parsed = JSON.parse(raw ?? '{}');
    const persisted = parsed.agents.find((a: { id: string }) => a.id === 'agent-1');
    expect(persisted?.name).toBe('Persisted Agent');
  });

  it('coalesces multiple rapid updates into a single localStorage write', () => {
    const setItemSpy = vi.spyOn(localStorage, 'setItem');
    const store = TestBed.inject(AgentsStore);
    store.updateAgent('agent-1', { name: 'A' });
    store.updateAgent('agent-1', { description: 'B' });
    store.updateAgent('agent-1', { name: 'C' });

    expect(setItemSpy).not.toHaveBeenCalled();
    vi.advanceTimersByTime(250);

    const calls = setItemSpy.mock.calls.filter(([k]) => k === 'arc-planner:agents');
    expect(calls.length).toBe(1);
  });

  it('hydrates from localStorage on init, preserving user-added agents', () => {
    storage['arc-planner:agents'] = JSON.stringify({
      agents: [
        { ...AGENTS[0], name: 'From Storage' },
        { id: 'agent-custom', name: 'Custom Agent', skills: [] },
      ],
    });

    TestBed.resetTestingModule();
    const store = TestBed.inject(AgentsStore);

    const all = store.agents();
    expect(all.some((a) => a.id === 'agent-1' && a.name === 'From Storage')).toBe(true);
    expect(all.some((a) => a.id === 'agent-custom' && a.name === 'Custom Agent')).toBe(true);



    expect(all.some((a) => a.id === 'agent-2')).toBe(false);
  });

  it('accepts a bare Agent[] payload (legacy shape) in localStorage', () => {
    storage['arc-planner:agents'] = JSON.stringify([AGENTS[0]]);

    TestBed.resetTestingModule();
    const store = TestBed.inject(AgentsStore);

    expect(store.agents().length).toBe(1);
    expect(store.agents()[0].id).toBe(AGENTS[0].id);
  });

  it('ignores malformed storage and falls back to seeded agents', () => {
    storage['arc-planner:agents'] = 'not-valid-json';

    TestBed.resetTestingModule();
    const store = TestBed.inject(AgentsStore);

    expect(store.agents().length).toBe(AGENTS.length);
    expect(storage['arc-planner:agents']).toBeUndefined();
  });

  it('resolveSkill returns the matching agent/skill pair for a known id', () => {
    const store = TestBed.inject(AgentsStore);
    const resolved = store.resolveSkill('agent-1', 'skill-1');
    expect(resolved?.agentId).toBe('agent-1');
    expect(resolved?.skill.id).toBe('skill-1');
    expect(resolved?.skill.prompt).toBe(AGENTS[0].skills[0].prompt);
  });

  it('resolveSkill returns null when the agent does not exist', () => {
    const store = TestBed.inject(AgentsStore);
    expect(store.resolveSkill('does-not-exist', 'skill-1')).toBeNull();
  });

  it('resolveSkill returns null when the skill does not exist', () => {
    const store = TestBed.inject(AgentsStore);
    expect(store.resolveSkill('agent-1', 'does-not-exist')).toBeNull();
  });

  it('updateSkill is reflected by subsequent resolveSkill calls', () => {
    const store = TestBed.inject(AgentsStore);
    store.updateSkill('agent-1', 'skill-1', { prompt: 'EDITED PROMPT' });
    const resolved = store.resolveSkill('agent-1', 'skill-1');
    expect(resolved?.skill.prompt).toBe('EDITED PROMPT');
  });

  it('replaces a persisted skill-8 with no version field with the latest seeded copy on hydrate', () => {
    const oldSkill8 = AGENTS[3].skills[0];
    const stale = {
      ...AGENTS[3],
      skills: [{ ...oldSkill8, prompt: 'STALE OLD PROMPT' }],
    };

    delete (stale.skills[0] as { version?: number }).version;
    storage['arc-planner:agents'] = JSON.stringify({ agents: [stale] });

    TestBed.resetTestingModule();
    const store = TestBed.inject(AgentsStore);
    const skill = store.resolveSkill('agent-4', 'skill-8');
    expect(skill).toBeTruthy();
    expect(skill!.skill.prompt).not.toBe('STALE OLD PROMPT');
    expect(skill!.skill.prompt).toBe(AGENTS[3].skills[0].prompt);
    expect(skill!.skill.version).toBe(AGENTS[3].skills[0].version);
  });

  it('preserves a persisted skill-8 that already carries the current seed version', () => {
    const seedSkill8 = AGENTS[3].skills[0];
    const edited = {
      ...AGENTS[3],
      skills: [{ ...seedSkill8, prompt: 'USER EDIT PROMPT', version: seedSkill8.version }],
    };
    storage['arc-planner:agents'] = JSON.stringify({ agents: [edited] });

    TestBed.resetTestingModule();
    const store = TestBed.inject(AgentsStore);
    const skill = store.resolveSkill('agent-4', 'skill-8');
    expect(skill!.skill.prompt).toBe('USER EDIT PROMPT');
  });

  it('replaces a persisted skill-8 whose version is strictly less than the seed version', () => {
    const seedSkill8 = AGENTS[3].skills[0];
    const stale = {
      ...AGENTS[3],
      skills: [{ ...seedSkill8, prompt: 'OLD VERSIONED PROMPT', version: 1 }],
    };
    storage['arc-planner:agents'] = JSON.stringify({ agents: [stale] });

    TestBed.resetTestingModule();
    const store = TestBed.inject(AgentsStore);
    const skill = store.resolveSkill('agent-4', 'skill-8');
    expect(skill!.skill.prompt).toBe(AGENTS[3].skills[0].prompt);
    expect(skill!.skill.version).toBe(AGENTS[3].skills[0].version);
  });

  it('re-injects skill-13/14/15 onto a persisted agent-4 that lacks them, preserving the user-edited skill-8', () => {





    const seedSkill8 = AGENTS[3].skills[0];
    const persistedOnlySkill8 = {
      ...AGENTS[3],
      skills: [{ ...seedSkill8, prompt: 'USER EDIT PROMPT', version: seedSkill8.version }],
    };
    storage['arc-planner:agents'] = JSON.stringify({ agents: [persistedOnlySkill8] });

    TestBed.resetTestingModule();
    const store = TestBed.inject(AgentsStore);
    const agent = store.getAgent('agent-4');
    const skillIds = agent?.skills.map((s) => s.id) ?? [];
    expect(skillIds).toEqual(
      expect.arrayContaining(['skill-8', 'skill-13', 'skill-14', 'skill-15']),
    );

    const edited = agent?.skills.find((s) => s.id === 'skill-8');
    expect(edited?.prompt).toBe('USER EDIT PROMPT');

    for (const id of ['skill-13', 'skill-14', 'skill-15']) {
      const seedSkill = AGENTS[3].skills.find((s) => s.id === id);
      const persisted = agent?.skills.find((s) => s.id === id);
      expect(persisted?.prompt, `injected ${id} prompt`).toBe(seedSkill?.prompt);
      expect(persisted?.version, `injected ${id} version`).toBe(1);
    }
  });

  it('does not re-inject seeded skills for a user-added agent that has no seed entry', () => {



    const userOnly = {
      id: 'agent-user',
      name: 'User',
      skills: [],
    };
    storage['arc-planner:agents'] = JSON.stringify({
      agents: [AGENTS[0], AGENTS[3], userOnly],
    });

    TestBed.resetTestingModule();
    const store = TestBed.inject(AgentsStore);

    const agent4 = store.getAgent('agent-4');
    expect(agent4?.skills.find((s) => s.id === 'skill-13')).toBeTruthy();
    expect(agent4?.skills.find((s) => s.id === 'skill-14')).toBeTruthy();
    expect(agent4?.skills.find((s) => s.id === 'skill-15')).toBeTruthy();

    const user = store.getAgent('agent-user');
    expect(user?.skills).toHaveLength(0);
  });
});
