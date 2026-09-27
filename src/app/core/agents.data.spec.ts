import { AGENTS } from './agents.data';

describe('agents.data seed (Phase 4)', () => {
  it('declares the four new Phase-4 skills', () => {
    const skillIds = AGENTS.flatMap((a) => a.skills.map((s) => s.id));
    expect(skillIds).toEqual(
      expect.arrayContaining(['skill-9', 'skill-10', 'skill-11', 'skill-12']),
    );
  });

  it('declares the three new PDF Creator skills (skill-13/14/15) on agent-4', () => {
    const pdfCreator = AGENTS.find((a) => a.id === 'agent-4');
    expect(pdfCreator, 'seed should declare the PDF Creator agent').toBeTruthy();
    const skillIds = pdfCreator?.skills.map((s) => s.id) ?? [];
    expect(skillIds).toEqual(expect.arrayContaining(['skill-13', 'skill-14', 'skill-15']));
  });

  it('seeds skill-13/14/15 with version: 1 and a non-empty prompt', () => {
    const pdfCreator = AGENTS.find((a) => a.id === 'agent-4');
    for (const id of ['skill-13', 'skill-14', 'skill-15']) {
      const skill = pdfCreator?.skills.find((s) => s.id === id);
      expect(skill, `agent-4 should seed ${id}`).toBeTruthy();
      expect(skill?.version, `${id} should declare a version`).toBe(1);
      expect(skill?.prompt?.length ?? 0, `${id} should have a non-trivial prompt`).toBeGreaterThan(80);
    }
  });

  it('declares the three Open Spec Verifier skills (skill-16/17/18) on agent-6', () => {
    const openspecVerifier = AGENTS.find((a) => a.id === 'agent-6');
    expect(openspecVerifier, 'seed should declare the Open Spec Verifier agent').toBeTruthy();
    const skillIds = openspecVerifier?.skills.map((s) => s.id) ?? [];
    expect(skillIds).toEqual(expect.arrayContaining(['skill-16', 'skill-17', 'skill-18']));
  });

  it('seeds skill-16/17/18 with a non-empty prompt', () => {
    const openspecVerifier = AGENTS.find((a) => a.id === 'agent-6');
    for (const id of ['skill-16', 'skill-17', 'skill-18']) {
      const skill = openspecVerifier?.skills.find((s) => s.id === id);
      expect(skill, `agent-6 should seed ${id}`).toBeTruthy();
      expect(skill?.prompt?.length ?? 0, `${id} should have a non-trivial prompt`).toBeGreaterThan(80);
    }
  });

  it('every seed skill has a non-empty prompt ≥80 chars', () => {
    for (const agent of AGENTS) {
      for (const skill of agent.skills) {
        expect(
          skill.prompt?.length ?? 0,
          `seed skill ${agent.id}/${skill.id} prompt should be non-trivial`,
        ).toBeGreaterThan(80);
      }
    }
  });
});
