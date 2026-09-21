import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { AgentsStore } from '../../core/agents.store';
import { AGENTS, Agent, Skill } from '../../core/agents.data';
import { AgentDetailComponent } from './agent-detail.component';

describe('AgentDetailComponent', () => {
  let storage: Record<string, string>;

  function setup(id = 'agent-1') {
    TestBed.configureTestingModule({
      imports: [AgentDetailComponent],
      providers: [
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: convertToParamMap({ id }) } },
        },
      ],
    });

    const fixture = TestBed.createComponent(AgentDetailComponent);
    fixture.detectChanges();
    const component = fixture.componentInstance as AgentDetailComponent;
    const store = TestBed.inject(AgentsStore);
    return { fixture, component, store };
  }

  beforeEach(() => {
    storage = {};
    vi.useFakeTimers();
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
  });

  afterEach(() => {
    vi.advanceTimersByTime(10_000);
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    TestBed.resetTestingModule();
  });

  it('renders the matching agent name and skills', () => {
    const { fixture } = setup('agent-1');
    const root = fixture.nativeElement as HTMLElement;
    const inputs = Array.from(root.querySelectorAll('input')) as HTMLInputElement[];
    const nameInput = inputs.find((i) => i.getAttribute('aria-label') === 'Agent name');
    expect(nameInput, 'name input must be rendered').toBeDefined();
    expect(nameInput!.value).toBe(AGENTS[0].name);
    const skillNames = inputs
      .filter((i) => i.getAttribute('aria-label') === 'Skill name')
      .map((i) => i.value);
    expect(skillNames).toContain(AGENTS[0].skills[0].name);
    expect(skillNames).toContain(AGENTS[0].skills[1].name);
  });

  it('shows the "Agent not found" panel when the id does not exist', () => {
    const { fixture } = setup('does-not-exist');
    const root = fixture.nativeElement as HTMLElement;
    expect(root.textContent).toContain('Agent not found');
    expect(root.textContent).toContain('does-not-exist');
  });

  it('calls updateAgent when the agent name changes', () => {
    const { component, store } = setup('agent-1');
    vi.spyOn(store, 'updateAgent');
    (component as any).onNameChange('Renamed');
    expect(store.updateAgent).toHaveBeenCalledWith('agent-1', { name: 'Renamed' });
  });

  it('calls updateAgent when the description changes', () => {
    const { component, store } = setup('agent-1');
    vi.spyOn(store, 'updateAgent');
    (component as any).onDescriptionChange('new desc');
    expect(store.updateAgent).toHaveBeenCalledWith('agent-1', { description: 'new desc' });
  });

  it('calls updateSkill when a skill prompt changes', () => {
    const { component, store } = setup('agent-1');
    vi.spyOn(store, 'updateSkill');
    const skillId = AGENTS[0].skills[0].id;
    (component as any).onSkillPromptChange(skillId, 'new prompt');
    expect(store.updateSkill).toHaveBeenCalledWith('agent-1', skillId, { prompt: 'new prompt' });
  });

  it('calls updateSkill when a skill name or description changes', () => {
    const { component, store } = setup('agent-1');
    vi.spyOn(store, 'updateSkill');
    const skillId = AGENTS[0].skills[0].id;
    (component as any).onSkillNameChange(skillId, 'Renamed');
    (component as any).onSkillDescriptionChange(skillId, 'new desc');
    expect(store.updateSkill).toHaveBeenCalledWith('agent-1', skillId, { name: 'Renamed' });
    expect(store.updateSkill).toHaveBeenCalledWith('agent-1', skillId, { description: 'new desc' });
  });

  it('calls removeSkill when the trash button is invoked', () => {
    const { component, store } = setup('agent-1');
    vi.spyOn(store, 'removeSkill');
    const skillId = AGENTS[0].skills[0].id;
    (component as any).onRemoveSkill(skillId);
    expect(store.removeSkill).toHaveBeenCalledWith('agent-1', skillId);
  });

  it('does not call addSkill when the name is empty or whitespace', () => {
    const { component, store } = setup('agent-1');
    vi.spyOn(store, 'addSkill');
    (component as any).newSkillName.set('   ');
    (component as any).onAddSkill();
    expect(store.addSkill).not.toHaveBeenCalled();
  });

  it('calls addSkill with the trimmed form fields when name is present', () => {
    const { component, store } = setup('agent-1');
    vi.spyOn(store, 'addSkill');
    (component as any).newSkillName.set('  New Skill  ');
    (component as any).newSkillDescription.set('  desc  ');
    (component as any).newSkillPrompt.set('  prompt  ');
    (component as any).onAddSkill();
    expect(store.addSkill).toHaveBeenCalledWith('agent-1', {
      name: 'New Skill',
      description: 'desc',
      prompt: 'prompt',
    });
    expect((component as any).newSkillName()).toBe('');
    expect((component as any).newSkillDescription()).toBe('');
    expect((component as any).newSkillPrompt()).toBe('');
  });

  it('omits empty description and prompt when adding a skill', () => {
    const { component, store } = setup('agent-1');
    vi.spyOn(store, 'addSkill');
    (component as any).newSkillName.set('Bare');
    (component as any).onAddSkill();
    expect(store.addSkill).toHaveBeenCalledWith('agent-1', {
      name: 'Bare',
      description: undefined,
      prompt: undefined,
    });
  });

  it('reflects agent edits in the template after store updates', () => {
    const { fixture, store } = setup('agent-1');
    store.updateAgent('agent-1', { name: 'Renamed Live' });
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    const inputs = Array.from(root.querySelectorAll('input')) as HTMLInputElement[];
    const nameInput = inputs.find((i) => i.getAttribute('aria-label') === 'Agent name');
    expect(nameInput?.value).toBe('Renamed Live');
  });

  it('persists new skills through the store', () => {
    const { component, store } = setup('agent-1');
    store.addSkill('agent-1', { name: 'Added', description: 'd', prompt: 'p' });
    const updated = store.getAgent('agent-1') as Agent;
    const added = updated.skills.find((s: Skill) => s.name === 'Added');
    expect(added).toBeDefined();
    expect(added?.description).toBe('d');
    expect(added?.prompt).toBe('p');
    expect((component as any).agent()?.skills.some((s: Skill) => s.name === 'Added')).toBe(true);
  });

  it('renders a Reset to default button in the header', () => {
    const { fixture } = setup('agent-1');
    const root = fixture.nativeElement as HTMLElement;
    const buttons = Array.from(root.querySelectorAll('button')) as HTMLButtonElement[];
    const reset = buttons.find((b) => b.textContent?.includes('Reset to default'));
    expect(reset).toBeDefined();
  });

  it('onResetToDefault calls the store with the current agent id', () => {
    const { component, store } = setup('agent-1');
    vi.spyOn(store, 'resetToDefault');
    (component as any).onResetToDefault();
    expect(store.resetToDefault).toHaveBeenCalledWith('agent-1');
  });

  it('header reflects the agent name after a store reset', () => {
    const { fixture, store } = setup('agent-1');
    store.updateAgent('agent-1', { name: 'Mutated' });
    fixture.detectChanges();
    store.resetToDefault('agent-1');
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    const inputs = Array.from(root.querySelectorAll('input')) as HTMLInputElement[];
    const nameInput = inputs.find((i) => i.getAttribute('aria-label') === 'Agent name');
    expect(nameInput?.value).toBe(AGENTS[0].name);
  });

  it('renders a "Used by stages" panel listing every registry stage the skill drives', () => {
    const { component } = setup('agent-1');

    const stages = (component as any).stagesFor('agent-1', 'skill-1') as string[];
    expect(stages).toEqual(expect.arrayContaining(['scaffold', 'layers', 'tail', 'audit-repair']));
  });

  });
