import { Plan } from '../plan.schema';
import { MarkdownFile } from '../markdown-renderer.service';

export function openspecChangeFolder(plan: Plan): string {
  return `openspec/changes/${plan.meta.featureSlug}`;
}

export function openspecFeatureSpecPath(plan: Plan): string {
  return `${openspecChangeFolder(plan)}/specs/${plan.meta.featureSlug}/spec.md`;
}

export function openspecArchitectureSpecPath(plan: Plan): string {
  return `${openspecChangeFolder(plan)}/specs/${plan.meta.featureSlug}-architecture/spec.md`;
}

export function openspecProposalPath(plan: Plan): string {
  return `${openspecChangeFolder(plan)}/proposal.md`;
}

export function openspecDesignPath(plan: Plan): string {
  return `${openspecChangeFolder(plan)}/design.md`;
}

export function openspecTasksPath(plan: Plan): string {
  return `${openspecChangeFolder(plan)}/tasks.md`;
}

export function buildOpenSpecFileList(plan: Plan): MarkdownFile[] {
  return [
    { path: openspecProposalPath(plan), content: buildOpenSpecProposalMd(plan) },
    { path: openspecFeatureSpecPath(plan), content: buildOpenSpecFeatureSpecMd(plan) },
    { path: openspecArchitectureSpecPath(plan), content: buildOpenSpecArchitectureSpecMd(plan) },
    { path: openspecDesignPath(plan), content: buildOpenSpecDesignMd(plan) },
    { path: openspecTasksPath(plan), content: buildOpenSpecTasksMd(plan) },
  ];
}

export function buildOpenSpecProposalMd(plan: Plan): string {
  const slug = plan.meta.featureSlug;
  const stories = plan.userStories ?? [];
  const frs = plan.functionalRequirements ?? [];
  const layers = plan.architectureLayers ?? [];

  const storyLines = stories.length
    ? stories.map((s) => `- **${s.id}** — ${s.title} (${s.priority})`)
    : ['- No user stories captured yet — see `## What Changes` for derived requirements.'];

  const frLines = frs.length
    ? frs.map((f) => `- **${f.id}** — ${f.text}`)
    : ['- No functional requirements captured.'];

  const layerLines = layers.length
    ? layers.map((l) => `- \`${l.id}\` — ${l.name}`)
    : ['- No architecture layers captured.'];

  const ideaLine = plan.meta.userIdea?.trim()
    ? `> Original ask: "${plan.meta.userIdea.replace(/\n+/g, ' ').trim()}"\n`
    : '';

  return [
    `# Proposal: ${plan.meta.title}`,
    '',
    `> ${plan.meta.summary}`,
    '',
    ideaLine,
    '## Why',
    '',
    `${plan.meta.summary} This change captures the user-facing behaviour, the supporting architecture, and the rollout plan in an OpenSpec-shaped change folder so an OpenSpec-capable agent can run \`/opsx:apply\` against it.`,
    '',
    '## What Changes',
    '',
    `- Introduce the **${plan.meta.title}** feature surface driven by ${stories.length || 'no captured'} user stor${stories.length === 1 ? 'y' : 'ies'}.`,
    '- Add an architecture capability describing the supporting layers, non-functional requirements, and operational constraints.',
    '- Ship tasks grouped by user-story priority so the apply phase can verify them in order.',
    '',
    '## Capabilities',
    '',
    '### New Capabilities',
    '',
    `- \`${slug}\`: User-facing behaviour for ${plan.meta.title}.`,
    `- \`${slug}-architecture\`: Cross-cutting architecture, layers, and operational constraints.`,
    '',
    '### Modified Capabilities',
    '',
    '_None — this change introduces new capabilities only._',
    '',
    '## Impact',
    '',
    `- **User stories affected:** ${stories.length}`,
    `- **Functional requirements:** ${frs.length}`,
    `- **Architecture layers:** ${layers.length}`,
    `- **Affected user stories**:`,
    ...storyLines,
    `- **Functional requirements**:`,
    ...frLines,
    `- **Architecture layers**:`,
    ...layerLines,
    '',
    `Generated: ${plan.meta.generatedAt}`,
  ].join('\n');
}

export function buildOpenSpecFeatureSpecMd(plan: Plan): string {
  const stories = plan.userStories ?? [];

  const blocks: string[] = [];
  if (stories.length === 0) {
    blocks.push(
      '### Requirement: Feature delivery',
      '',
      '#### Scenario: The plan describes a deliverable feature',
      '',
      '- **WHEN** the operator reads `proposal.md` and this file',
      '- **THEN** they can describe what the change ships and why without consulting any other document',
      `- **AND** the summary references: ${plan.meta.summary}`,
    );
  } else {
    stories.forEach((s, index) => {
      const scenarios = s.acceptanceScenarios ?? [];
      if (scenarios.length === 0) {
        blocks.push(
          `### Requirement: ${s.id} ${slugForRequirement(s.title)}`,
          '',
          '#### Scenario: User story is captured',
          '',
          '- **WHEN** the change is reviewed',
          `- **THEN** user story \`${s.id}\` (${s.title}) is acknowledged even without explicit acceptance scenarios`,
        );
        return;
      }
      const scenarioBlocks = scenarios.map((sc) => scenarioBlock(sc, index));
      blocks.push(
        `### Requirement: ${s.id} ${slugForRequirement(s.title)}`,
        '',
        s.description,
        '',
        ...scenarioBlocks,
      );
    });
  }

  return [
    `# Capability: ${plan.meta.title}`,
    '',
    '## Purpose',
    '',
    `Capture the user-facing behaviour for **${plan.meta.title}** as a set of testable requirements. Each requirement maps to a User Story from the source plan; each Scenario to one of that story's acceptance scenarios.`,
    '',
    '## ADDED Requirements',
    '',
    ...blocks,
    '',
  ].join('\n');
}

export function buildOpenSpecArchitectureSpecMd(plan: Plan): string {
  const frs = plan.functionalRequirements ?? [];
  const scs = plan.successCriteria ?? [];
  const layers = plan.architectureLayers ?? [];
  const nfrs = plan.nonFunctionalRequirements ?? [];

  const blocks: string[] = [];

  if (frs.length === 0 && scs.length === 0 && layers.length === 0 && nfrs.length === 0) {
    blocks.push(
      '### Requirement: Architecture coverage',
      '',
      '#### Scenario: Architecture is implied by proposal',
      '',
      '- **WHEN** the operator inspects the change folder',
      '- **THEN** at least one requirement exists so the capability has a valid structure',
      `- **AND** the proposal references: ${plan.meta.summary}`,
    );
  } else {
    if (frs.length) {
      blocks.push(
        '## Functional requirements',
        '',
        `The system shall satisfy every functional requirement captured during planning: ${frs.length} item(s) total.`,
        '',
        ...frs.map((f) =>
          scenarioRequirement(
            `${f.id}`,
            `Functional requirement ${f.id} is satisfied`,
            [
              ['**WHEN**', `the user exercises the path described by ${f.id}`],
              ['**THEN**', `the system fulfils: ${f.text}`],
              ['**AND**', 'no contract test against this requirement regresses'],
            ],
          ),
        ),
      );
    }
    if (scs.length) {
      blocks.push(
        '## Success criteria',
        '',
        `Each success criterion defines a measurable outcome: ${scs.length} item(s) total.`,
        '',
        ...scs.map((sc) => {
          const bullets: Array<[string, string]> = [
            ['**WHEN**', `the operator runs the measurement scenario for ${sc.id}`],
            ['**THEN**', `the system reports: ${sc.text}`],
          ];
          if (sc.measurementScenario) {
            bullets.push(['**AND**', `scenario: ${sc.measurementScenario}`]);
          }
          return scenarioRequirement(
            `${sc.id}`,
            `Success criterion ${sc.id} is measured`,
            bullets,
          );
        }),
      );
    }
    if (layers.length) {
      blocks.push(
        '## Architecture layers',
        '',
        `Each architecture layer ships its own implementation contract: ${layers.length} layer(s) total.`,
        '',
        ...layers.map((l) =>
          scenarioRequirement(
            `layer-${l.id}`,
            `Layer ${l.id} implements its contract`,
            [
              ['**WHEN**', `the ${l.name} layer is exercised`],
              ['**THEN**', `it conforms to: ${l.description}`],
              ['**AND**', `tech stack honours: ${l.techStack.join(', ')}`],
            ],
          ),
        ),
      );
    }
    if (nfrs.length) {
      blocks.push(
        '## Non-functional requirements',
        '',
        `Non-functional requirements span ${nfrs.length} categor${nfrs.length === 1 ? 'y' : 'ies'}.`,
        '',
        ...nfrs.map((n) =>
          scenarioRequirement(
            `nfr-${n.id}`,
            `Non-functional requirement ${n.id} is upheld`,
            [
              ['**WHEN**', `the system is observed under the ${n.category} lens`],
              ['**THEN**', `it upholds: ${n.text}`],
            ],
          ),
        ),
      );
    }
  }

  return [
    `# Capability: ${plan.meta.title} — Architecture`,
    '',
    '## Purpose',
    '',
    `Capture the cross-cutting architecture, layers, and operational constraints that back **${plan.meta.title}**.`,
    '',
    '## ADDED Requirements',
    '',
    ...blocks,
    '',
  ].join('\n');
}

export function buildOpenSpecDesignMd(plan: Plan): string {
  const overview = plan.systemOverview;
  const nonGoals = plan.nonGoals ?? [];
  const layers = plan.architectureLayers ?? [];
  const nfrs = plan.nonFunctionalRequirements ?? [];
  const constitution = plan.constitution;
  const operational = plan.meta.operationalConstraints;

  const decisions: string[] = [];
  for (const layer of layers) {
    decisions.push(
      `### Layer: ${layer.name}`,
      '',
      layer.description,
      '',
      `- **Tech stack:** ${layer.techStack.join(', ')}`,
      `- **Patterns:** ${layer.patterns.join(', ')}`,
      '',
    );
  }
  if (operational) {
    const entries = Object.entries(operational);
    if (entries.length) {
      decisions.push(
        '### Operational constraints',
        '',
        entries.map(([key, value]) => `- **${key}:** ${value}`).join('\n'),
        '',
      );
    }
  }
  if (constitution?.articles?.length) {
    decisions.push(
      '### Constitution',
      '',
      `Ratified ${constitution.ratifiedAt}; last amended ${constitution.lastAmendedAt} (version ${constitution.version}).`,
      '',
      constitution.articles.map((a) => `- **Article ${a.articleNumber} — ${a.title}:** ${a.content}`).join('\n'),
      '',
    );
  }

  const decisionsBlock = decisions.length
    ? decisions.join('\n').trimEnd() + '\n\n'
    : '_No cross-cutting decisions captured._\n\n';

  return [
    `# Design: ${plan.meta.title}`,
    '',
    '## Context',
    '',
    `**Purpose.** ${overview.purpose}`,
    '',
    `**Context.** ${overview.context}`,
    '',
    overview.keyActors.length
      ? `**Key actors.** ${overview.keyActors.join(', ')}\n`
      : '',
    overview.constraints.length
      ? `**Constraints.** ${overview.constraints.map((c) => `- ${c}`).join('\n')}\n`
      : '',
    overview.nfrs.length
      ? `**System NFRs.** ${overview.nfrs.map((c) => `- ${c}`).join('\n')}\n`
      : '',
    '## Goals / Non-Goals',
    '',
    '**Goals**',
    '',
    ...(plan.userStories ?? []).slice(0, 5).map((s) => `- ${s.id} — ${s.title}`),
    '- Deliver the architecture layers captured under `## Decisions`.',
    '',
    '**Non-Goals**',
    '',
    ...(nonGoals.length ? nonGoals.map((g) => `- ${g}`) : ['- No explicit non-goals captured.']),
    '',
    '## Decisions',
    '',
    decisionsBlock,
    '## Risks / Trade-offs',
    '',
    nfrs.length
      ? nfrs.map((n) => `- **${n.category}:** ${n.text}`).join('\n') + '\n'
      : '_No non-functional risks captured._\n',
    '',
  ].join('\n');
}

export function buildOpenSpecTasksMd(plan: Plan): string {
  const tasks = plan.agentTasks ?? [];
  const userStories = plan.userStories ?? [];
  const storyById = new Map(userStories.map((s) => [s.id, s] as const));

  const lines: string[] = [`# Tasks: ${plan.meta.title}`, ''];

  if (tasks.length === 0) {
    lines.push(
      '## 1. Bootstrap',
      '',
      `- [ ] 1.1 Capture at least one agent task in the source plan so \`/opsx:apply\` has work to verify.`,
      `- [ ] 1.2 Re-export the change folder so the bundle reflects the new task list.`,
      '',
    );
    return lines.join('\n');
  }

  const groups = new Map<string, typeof tasks>();
  const taskNumber = new Map<string, number>();
  let groupCounter = 0;
  for (const task of tasks) {
    const groupKey = pickGroupKey(task, userStories, storyById);
    if (!groups.has(groupKey)) {
      groupCounter += 1;
      groups.set(groupKey, []);
      taskNumber.set(groupKey, 0);
    }
    groups.get(groupKey)!.push(task);
  }

  let groupIndex = 0;
  for (const [key, groupTasks] of groups) {
    groupIndex += 1;
    lines.push(`## ${groupIndex}. ${groupTitle(key, groupTasks, storyById)}`, '');
    let subIndex = 0;
    for (const task of groupTasks) {
      subIndex += 1;
      const verification = task.acceptanceCriteria?.[0]
        ? ` — verified when: ${task.acceptanceCriteria[0]}`
        : '';
      lines.push(`- [ ] ${groupIndex}.${subIndex} ${task.title}${verification}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

function pickGroupKey(
  task: Plan['agentTasks'][number],
  userStories: Plan['userStories'],
  storyById: Map<string, Plan['userStories'][number]>,
): string {
  const usId = task.userStoryIds?.[0];
  if (usId) {
    const story = storyById.get(usId) ?? userStories.find((s) => s.id === usId);
    if (story) {
      return `us:${story.id}`;
    }
    return `us:${usId}`;
  }
  if (task.taskCluster) {
    return `cluster:${task.taskCluster}`;
  }
  return 'misc:bootstrap';
}

function groupTitle(
  key: string,
  tasks: Plan['agentTasks'],
  storyById: Map<string, Plan['userStories'][number]>,
): string {
  if (key.startsWith('us:')) {
    const id = key.slice(3);
    const story = storyById.get(id);
    if (story) {
      return `${id} — ${story.title}`;
    }
    return `User Story ${id}`;
  }
  if (key.startsWith('cluster:')) {
    const cluster = key.slice('cluster:'.length);
    return `Cluster: ${cluster}`;
  }
  return `Phase: ${tasks.length} task(s)`;
}

function scenarioBlock(scenario: Plan['userStories'][number]['acceptanceScenarios'][number], index: number): string {
  const name = scenario.id ?? `scenario-${index + 1}`;
  return [
    `#### Scenario: ${name}`,
    '',
    normaliseScenario({ given: scenario.given, when: scenario.when, then: scenario.then }),
  ].join('\n');
}

function scenarioRequirement(
  id: string,
  label: string,
  bullets: Array<[string, string]>,
): string {
  const lines = [`### Requirement: ${id} ${label}`, ''];
  lines.push(`#### Scenario: ${id} is verified`, '');
  for (const [marker, body] of bullets) {
    lines.push(`- ${marker} ${body}`);
  }
  return lines.join('\n') + '\n';
}

export function normaliseScenario(input: { given?: string; when: string; then: string }): string {
  const lines: string[] = [];
  if (input.given) {
    lines.push(`- **WHEN** ${input.when}`);
    lines.push(`- **THEN** ${input.then}`);
    lines.push(`- **AND** given ${input.given}`);
  } else {
    lines.push(`- **WHEN** ${input.when}`);
    lines.push(`- **THEN** ${input.then}`);
  }
  return lines.join('\n');
}

export function slugForRequirement(title: string): string {
  return title
    .replace(/[^A-Za-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .map((w) => (w.length <= 3 ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1).toLowerCase()))
    .join(' ');
}