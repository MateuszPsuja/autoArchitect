import { describe, expect, it } from 'vitest';
import { Plan } from '../plan.schema';
import { minimalPlanFixture } from '../../testing/fixtures';
import {
  buildOpenSpecArchitectureSpecMd,
  buildOpenSpecDesignMd,
  buildOpenSpecFeatureSpecMd,
  buildOpenSpecFileList,
  buildOpenSpecProposalMd,
  buildOpenSpecTasksMd,
  normaliseScenario,
  openspecArchitectureSpecPath,
  openspecChangeFolder,
  openspecFeatureSpecPath,
  slugForRequirement,
} from './openspec-renderer';

describe('openspec-renderer', () => {
  describe('path helpers', () => {
    it('builds the change folder without the numeric branch prefix', () => {
      expect(openspecChangeFolder(minimalPlanFixture)).toBe('openspec/changes/planner-fixture');
    });

    it('builds the feature and architecture spec paths with plain kebab-case slugs', () => {
      expect(openspecFeatureSpecPath(minimalPlanFixture)).toBe(
        'openspec/changes/planner-fixture/specs/planner-fixture/spec.md',
      );
      expect(openspecArchitectureSpecPath(minimalPlanFixture)).toBe(
        'openspec/changes/planner-fixture/specs/planner-fixture-architecture/spec.md',
      );
    });
  });

  describe('buildOpenSpecFileList', () => {
    it('returns exactly 5 paths in the documented order', () => {
      const files = buildOpenSpecFileList(minimalPlanFixture);
      expect(files.map((f) => f.path)).toEqual([
        'openspec/changes/planner-fixture/proposal.md',
        'openspec/changes/planner-fixture/specs/planner-fixture/spec.md',
        'openspec/changes/planner-fixture/specs/planner-fixture-architecture/spec.md',
        'openspec/changes/planner-fixture/design.md',
        'openspec/changes/planner-fixture/tasks.md',
      ]);
      expect(files).toHaveLength(5);
    });
  });

  describe('buildOpenSpecProposalMd', () => {
    it('emits all four required sections and lists both capabilities', () => {
      const md = buildOpenSpecProposalMd(minimalPlanFixture);
      expect(md).toContain('## Why');
      expect(md).toContain('## What Changes');
      expect(md).toContain('## Capabilities');
      expect(md).toContain('## Impact');
      expect(md).toContain('### New Capabilities');
      expect(md).toContain('planner-fixture');
      expect(md).toContain('planner-fixture-architecture');
      expect(md).toContain('US001');
    });
  });

  describe('buildOpenSpecFeatureSpecMd', () => {
    it('still emits ≥1 requirement with ≥1 scenario when the plan has no user stories', () => {
      const plan: Plan = { ...minimalPlanFixture, userStories: [] };
      const md = buildOpenSpecFeatureSpecMd(plan);
      const requirements = md.match(/^### Requirement:/gm) ?? [];
      const scenarios = md.match(/^#### Scenario:/gm) ?? [];
      expect(requirements.length).toBeGreaterThanOrEqual(1);
      expect(scenarios.length).toBeGreaterThanOrEqual(requirements.length);
      expect(md).toContain('### Requirement: Feature delivery');
    });

    it('emits one Requirement per story with WHEN/THEN scenario bullets', () => {
      const md = buildOpenSpecFeatureSpecMd(minimalPlanFixture);
      expect(md).toContain('### Requirement: US001');
      expect(md).toContain('#### Scenario: FR-001');
      expect(md).toMatch(/^- \*\*WHEN\*\* /m);
      expect(md).toMatch(/^- \*\*THEN\*\* /m);
      expect(md).toMatch(/^- \*\*AND\*\* /m);
    });
  });

  describe('buildOpenSpecArchitectureSpecMd', () => {
    it('emits Requirement + Scenario per FR and per layer for the fixture plan', () => {
      const md = buildOpenSpecArchitectureSpecMd(minimalPlanFixture);
      expect(md).toContain('### Requirement: FR-001');
      expect(md).toContain('### Requirement: SC-001');
      expect(md).toContain('### Requirement: layer-backend');
      expect(md).toContain('### Requirement: layer-frontend');
      const requirements = md.match(/^### Requirement:/gm) ?? [];
      const scenarios = md.match(/^#### Scenario:/gm) ?? [];
      expect(scenarios.length).toBe(requirements.length);
    });

    it('falls back to a single Requirement when the plan has no architecture data', () => {
      const plan: Plan = {
        ...minimalPlanFixture,
        functionalRequirements: [],
        successCriteria: [],
        architectureLayers: [],
        nonFunctionalRequirements: [],
      };
      const md = buildOpenSpecArchitectureSpecMd(plan);
      expect(md).toContain('### Requirement: Architecture coverage');
      expect(md.match(/^### Requirement:/gm)).toHaveLength(1);
    });
  });

  describe('buildOpenSpecDesignMd', () => {
    it('emits all five mandatory sections and skips empty optional ones', () => {
      const md = buildOpenSpecDesignMd(minimalPlanFixture);
      expect(md).toContain('## Context');
      expect(md).toContain('## Goals / Non-Goals');
      expect(md).toContain('## Decisions');
      expect(md).toContain('## Risks / Trade-offs');
      expect(md).not.toContain('## Migration Plan');
      expect(md).not.toContain('## Open Questions');
    });
  });

  describe('buildOpenSpecTasksMd', () => {
    it('emits every checkbox as `- [ ] N.M description` and group headings as `## N. Title`', () => {
      const md = buildOpenSpecTasksMd(minimalPlanFixture);
      const checkboxes = md.match(/^- \[ \] \d+\.\d+ .+$/gm) ?? [];
      const groups = md.match(/^## \d+\. .+$/gm) ?? [];
      expect(checkboxes.length).toBeGreaterThan(0);
      expect(groups.length).toBeGreaterThan(0);
      checkboxes.forEach((line) => {
        expect(line).toMatch(/^- \[ \] \d+\.\d+ .+/);
      });
    });

    it('falls back to a single Bootstrap group when there are no agent tasks', () => {
      const plan: Plan = { ...minimalPlanFixture, agentTasks: [] };
      const md = buildOpenSpecTasksMd(plan);
      expect(md).toContain('## 1. Bootstrap');
      expect(md).toMatch(/^- \[ \] 1\.1 .+/m);
    });
  });

  describe('helpers', () => {
    it('normaliseScenario adds WHEN/THEN/AND bullets', () => {
      const out = normaliseScenario({
        given: 'a logged-in user',
        when: 'they click Generate',
        then: 'a plan is produced',
      });
      expect(out).toContain('- **WHEN** they click Generate');
      expect(out).toContain('- **THEN** a plan is produced');
      expect(out).toContain('- **AND** given a logged-in user');
    });

    it('slugForRequirement capitalises words without changing letters', () => {
      expect(slugForRequirement('generate a plan from an idea')).toBe(
        'Generate A Plan From AN Idea',
      );
    });
  });
});