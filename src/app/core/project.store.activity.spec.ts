import { TestBed } from '@angular/core/testing';
import { ProjectStore } from './project.store';

describe('ProjectStore — live agent activities', () => {
  let store: InstanceType<typeof ProjectStore>;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    store = TestBed.inject(ProjectStore);
  });

  it('starts empty and exposes the active-agents computed', () => {
    expect(store.activeActivities()).toEqual([]);
    expect(store.activeAgents()).toEqual([]);
  });

  it('startActivity adds an entry and returns an id', () => {
    const id = store.startActivity({
      stage: 'scaffold',
      agentId: 'agent-1',
      skillId: 'skill-1',
      label: null,
      kind: 'stage',
    });
    expect(typeof id).toBe('string');
    expect(store.activeActivities().length).toBe(1);
    expect(store.activeActivities()[0].id).toBe(id);
    expect(store.activeAgents()).toEqual([{ agentId: 'agent-1', count: 1 }]);
  });

  it('finishActivity removes the matching entry', () => {
    const id = store.startActivity({
      stage: 'scaffold',
      agentId: 'agent-1',
      skillId: 'skill-1',
      label: null,
      kind: 'stage',
    });
    store.finishActivity(id);
    expect(store.activeActivities()).toEqual([]);
  });

  it('startActivity replaces a previous entry with the same stage+label', () => {
    const first = store.startActivity({
      stage: 'layers',
      agentId: 'agent-1',
      skillId: 'skill-1',
      label: 'frontend',
      kind: 'parallel-job',
    });
    const second = store.startActivity({
      stage: 'layers',
      agentId: 'agent-1',
      skillId: 'skill-1',
      label: 'frontend',
      kind: 'parallel-job',
    });
    expect(first).not.toBe(second);
    expect(store.activeActivities().length).toBe(1);
    expect(store.activeActivities()[0].id).toBe(second);
  });

  it('clearActivities wipes every entry', () => {
    store.startActivity({ stage: 'a', agentId: null, skillId: null, label: null, kind: 'stage' });
    store.startActivity({ stage: 'b', agentId: 'agent-2', skillId: 'skill-3', label: null, kind: 'pdf' });
    expect(store.activeActivities().length).toBe(2);
    store.clearActivities();
    expect(store.activeActivities()).toEqual([]);
  });

  it('counts per agent (one agent with three parallel jobs = count 3)', () => {
    for (const label of ['frontend', 'backend', 'shared']) {
      store.startActivity({
        stage: 'layers',
        agentId: 'agent-1',
        skillId: 'skill-1',
        label,
        kind: 'parallel-job',
      });
    }
    expect(store.activeAgents()).toEqual([{ agentId: 'agent-1', count: 3 }]);
  });

  it('entries with no agentId are excluded from the active-agents computed', () => {
    store.startActivity({ stage: 'a', agentId: null, skillId: null, label: null, kind: 'stage' });
    store.startActivity({ stage: 'b', agentId: 'agent-4', skillId: 'skill-8', label: null, kind: 'pdf' });
    expect(store.activeAgents()).toEqual([{ agentId: 'agent-4', count: 1 }]);
  });
});