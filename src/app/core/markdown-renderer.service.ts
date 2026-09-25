import { Injectable, inject } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import DOMPurify from 'dompurify';
import { marked } from 'marked';
import {
  Adr,
  Aggregate,
  AgentTask,
  ArchitectureLayer,
  ConstitutionArticle,
  DirectoryEntry,
  Domain,
  DomainComponent,
  DomainEvent,
  FunctionalRequirement,
  KeyEntity,
  OfflineContract,
  Plan,
  TestCase,
  TDDSpec,
  UserStory,
  Workflow,
} from './plan.schema';
import { branchName, featureFolder, slugify } from './feature-slug';
import {
  liftEdgeCasesToFunctionalRequirements,
  synthetiseNegativeAcceptance,
  synthesiseEdgeCases,
} from './edge-case-synthesiser';
import { synthesiseConstitutionTasks } from './speckit/constitution-pack';
import { dedupKey, pickPrimaryStory } from './speckit/task-dedup';
import { fr010Default, resolveFr010ForSpec, stripNestedMarker } from './speckit/fr-clarification';
import {
  GLOSSARY_SEED,
  MULTI_TENANT_BAN_WARNING,
  NON_GOALS_SEED,
  OPEN_QUESTIONS_ANCHOR,
  SC001_DEFAULT_SCENARIO,
  SC003_BASELINE_DEFINITION,
} from './speckit/canonical-fr-ids';

const ONBOARDING_SUBTASK_TITLES: Record<string, string> = {
  'onboarding-route': 'Onboarding route + form scaffold',
  'voice-record-ui': 'Voice-record UI (MediaRecorder + waveform)',
  'avatar-picker-ui': 'Avatar-picker UI',
  'save-flow-sanitise': 'Save flow + DOMPurify sanitization on stored personality text',
};

const RETRIEVAL_DESCRIPTION_LANGCHAIN = 'LangChain-based retrieval';
const RETRIEVAL_DESCRIPTION_FALLBACK =
  'deterministic retrieval via the chosen embedding model (FR-010)';

const VAGUE_ADJECTIVE_RE = /\b(fast|intuitive|smooth|robust|seamless|effortless|natural)\b/gi;
const VAGUE_ADJECTIVE_PLACEHOLDER = '[TODO: measure]';

/**
 * Sweep prose for subjective adjectives (fast / intuitive / smooth / robust /
 * seamless / effortless / natural) and downgrade them to a `[TODO: measure]`
 * placeholder so spec-kit's analyser can grep for them and the user can
 * re-prompt with measurable language. Pure renderer pass; no plan mutation.
 */
export function replaceVagueAdjectives(md: string): string {
  if (!md) return md;
  return md.replace(VAGUE_ADJECTIVE_RE, VAGUE_ADJECTIVE_PLACEHOLDER);
}

/**
 * Spec-kit's analyser requires every rendered Markdown file to carry the
 * `[TODO: measure]` placeholder only when the source text actually contains
 * a vague adjective. The `replaceVagueAdjectives` helper exports the regex
 * + placeholder so tests can verify the exact wording.
 */
export const VAGUE_ADJECTIVE_TEST_FIXTURE = {
  placeholder: VAGUE_ADJECTIVE_PLACEHOLDER,
  pattern: VAGUE_ADJECTIVE_RE.source,
};

export interface MarkdownFile {
  path: string;
  content: string;
}

@Injectable({ providedIn: 'root' })
export class MarkdownRendererService {
  private readonly sanitizer = inject(DomSanitizer);

  // Reverses .kilo/plans/1784575886202-docs-tab-preview-removal.md (which dropped
  // marked + dompurify). AGENTS.md §0.4 mandates DOMPurify before any innerHTML
  // path; the editor → docs tab renders this back as the default preview.
  toSafeHtml(markdown: string): SafeHtml {
    const raw = (marked.parse(markdown, { gfm: true, breaks: false }) as string) ?? '';
    const clean = DOMPurify.sanitize(raw, {
      USE_PROFILES: { html: true },
      FORBID_TAGS: ['style', 'script', 'iframe', 'object', 'embed', 'form'],
      FORBID_ATTR: ['style', 'onerror', 'onload', 'onclick'],
    });
    const safe = clean.replace(
      /<a\s+([^>]*?)>/gi,
      '<a $1 target="_blank" rel="noopener noreferrer">',
    );
    return this.sanitizer.bypassSecurityTrustHtml(safe);
  }

  toMarkdownFiles(plan: Plan, options: { includeDirectoryAgents?: boolean } = {}): MarkdownFile[] {
    const prefix = featureFolder(plan);
    const includeDirectoryAgents = options.includeDirectoryAgents ?? false;
    const files: MarkdownFile[] = [];
    files.push(this.buildConstitutionFile(plan));
    files.push(...this.buildSpecKitArtefacts(plan, prefix));
    files.push(...this.buildRootFiles(plan, prefix));
    files.push(...this.buildSystemFiles(plan, prefix));
    files.push(...this.buildArchitectureFiles(plan, prefix));
    files.push(...this.buildAdrFiles(plan, prefix));
    files.push(...this.buildDomainFiles(plan, prefix));
    files.push(...this.buildWorkflowFiles(plan, prefix));
    files.push(...this.buildAgentTaskFiles(plan, prefix));
    if (includeDirectoryAgents) {
      files.push(...this.buildDirectoryAgentsFiles(plan));
    }
    return files.map((f) => ({ ...f, content: this.sanitiseTerminology(f.content) }));
  }

  /**
   * Last-step normalisation that fixes common LLM typos and brand-name
   * drift (e.g. "Minimax" → "Minimax", "Lang Chain" → "LangChain",
   * "AngularJS" → "Angular"). Runs after every builder, so nothing in the
   * rendered Markdown can carry the LLM-invented variant into the bundle.
   * Also applies the vague-adjective sweep so spec-kit analysers can grep
   * for `[TODO: measure]` and re-prompt the user for measurable language.
   */
  private sanitiseTerminology(md: string): string {
    if (!md) return md;
    const substitutions: ReadonlyArray<readonly [RegExp, string]> = [
      [/\b[Mm]ini\s?[Mm]ax\b/g, 'MiniMax'],
      [/\bMini\s?Max\b/g, 'MiniMax'],
      [/\bminimax\b/g, 'MiniMax'],
      [/\bLang\s?Chain\b/g, 'LangChain'],
      [/\bAngular\s*JS\b/g, 'Angular'],
    ];
    let out = md;
    for (const [pattern, replacement] of substitutions) {
      out = out.replace(pattern, replacement);
    }
    return replaceVagueAdjectives(out);
  }

  private buildConstitutionFile(plan: Plan): MarkdownFile {
    return {
      path: '.specify/memory/constitution.md',
      content: this.buildConstitutionMd(plan),
    };
  }

  private buildSpecKitArtefacts(plan: Plan, prefix: string): MarkdownFile[] {
    return [
      { path: `${prefix}/README.md`, content: this.buildSpecKitReadme(plan) },
      { path: `${prefix}/spec.md`, content: this.buildFeatureSpecMd(plan) },
      { path: `${prefix}/plan.md`, content: this.buildPlanMd(plan) },
      { path: `${prefix}/data-model.md`, content: this.buildDataModelMd(plan) },
      ...this.buildContracts(plan, prefix),
      { path: `${prefix}/quickstart.md`, content: this.buildQuickstartMd(plan) },
      { path: `${prefix}/tasks.md`, content: this.buildTasksMd(plan) },
      { path: `${prefix}/checklist.md`, content: this.buildChecklistMd(plan) },
    ];
  }

  private buildSpecKitReadme(plan: Plan): string {
    const branch = plan.meta.branchName ?? branchName(plan);
    return [
      `# ${plan.meta.title} — spec-kit Export`,
      '',
      `> ${plan.meta.summary}`,
      '',
      `**Branch:** \`${branch}\` · **Export version:** \`3\` (spec-kit shape; per-feature numbered folder \`${branch}/\`)`,
      '',
      'This bundle follows the GitHub [spec-kit spec-driven](https://github.com/github/spec-kit/blob/main/spec-driven.md) deliverable shape. Top-level layout:',
      '',
      '| Artefact | Path |',
      '|---|---|',
      '| Project constitution | `.specify/memory/constitution.md` |',
      '| Feature specification | `spec.md` |',
      '| Implementation plan | `plan.md` |',
      '| Data model | `data-model.md` |',
      '| Per-layer contracts | `contracts/<layer>.md` |',
      '| Quickstart / validation scenarios | `quickstart.md` |',
      '| Task list (User Story phases) | `tasks.md` |',
      '| Compliance checklist | `checklist.md` |',
      '| Architecture summary | `ARCHITECTURE.md` |',
      '| Agent implementation guide | `AGENTS.md` |',
      '| Per-layer architecture docs | `docs/10-architecture/` |',
      '| Domain docs | `docs/30-*/<domain>/` (etc.) |',
      '| ADRs | `docs/20-decisions/` |',
      '| Workflows | `docs/50-workflows/` |',
      '| Agent task details | `docs/60-agent-tasks/` |',
      '| Per-directory AGENTS.md | `<directory>/AGENTS.md` |',
      '| Plan JSON (root of bundle, for tools) | `../plan.json` |',
      '',
      '> **Note.** `research.md` is **omitted** — spec-kit allows omission when no research phase produced notes. Once the planner grows a research step, this README will list it.',
      '',
      `Generated: ${plan.meta.generatedAt}`,
    ].join('\n');
  }

  private buildFeatureSpecMd(plan: Plan): string {
    const branch = plan.meta.branchName ?? branchName(plan);
    const escapedIdea = (plan.meta.userIdea ?? '')
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"');
    const inputLine = plan.meta.userIdea?.trim()
      ? `**Input**: User description: "${escapedIdea}"`
      : '**Input**: User description: "<original user idea not captured — regenerate to populate>"';
    const lines: string[] = [
      `# Feature Specification: ${plan.meta.title}`,
      '',
      '**Status**: Draft',
      inputLine,
      `**Feature Branch**: \`${branch}\` · **Generated**: ${plan.meta.generatedAt}`,
      '',
      '> What users need and why. No tech stack, no code.',
      '',
      '## Purpose',
      '',
      plan.systemOverview.purpose,
      '',
      '## Context',
      '',
      plan.systemOverview.context,
      '',
    ];

    const liftedFrs = liftEdgeCasesToFunctionalRequirements(
      plan,
      synthesiseEdgeCases(plan),
    );
    const functionalRequirements: FunctionalRequirement[] = [
      ...(plan.functionalRequirements ?? []),
      ...liftedFrs,
    ];

    const storiesForRender = this.ensureTranscriptStory(plan);
    const planForRender: Plan = {
      ...plan,
      userStories: storiesForRender,
      functionalRequirements,
    };

    lines.push('## User Scenarios & Testing', '', '');
    if ((planForRender.userStories ?? []).length === 0) {
      lines.push(
        '> No User Stories defined for this plan. Regenerate the plan to populate prioritised user stories (US001, US002, …).',
        '',
      );
    } else {
      for (const story of planForRender.userStories) {
        lines.push(`### User Story ${story.id} — ${story.title} (Priority: ${story.priority})`, '');
        lines.push(story.description, '');
        lines.push('**Why this priority**', '');
        lines.push(story.whyThisPriority, '');
        lines.push('**Independent Test**', '');
        lines.push(story.independentTest, '');
        lines.push('**Acceptance Scenarios**', '');
        for (let i = 0; i < story.acceptanceScenarios.length; i += 1) {
          const scenario = story.acceptanceScenarios[i];
          lines.push(`${i + 1}. **${scenario.id}** —`);
          lines.push(`   - **Given** ${scenario.given}`);
          lines.push(`   - **When** ${scenario.when}`);
          lines.push(`   - **Then** ${scenario.then}`);
        }
        if (story.boundedContextIds.length > 0) {
          lines.push('');
          lines.push(
            `**Bounded Contexts:** ${story.boundedContextIds.map((id) => `\`${id}\``).join(', ')}`,
          );
        }
        if (story.transcriptFormat) {
          lines.push('');
          lines.push(this.renderTranscriptFormat(story.transcriptFormat));
        }
        const negScenarios = [
          ...(story.negativeAcceptanceScenarios ?? []),
          ...(story.id === 'US007'
            ? []
            : synthetiseNegativeAcceptance(planForRender).filter((s) =>
                s.id.startsWith(story.id),
              )),
        ];
        if (negScenarios.length > 0) {
          lines.push('');
          lines.push('**Negative Acceptance Scenarios**', '');
          for (let i = 0; i < negScenarios.length; i += 1) {
            const scenario = negScenarios[i];
            lines.push(`${i + 1}. **${scenario.id}** —`);
            lines.push(`   - **Given** ${scenario.given}`);
            lines.push(`   - **When** ${scenario.when}`);
            lines.push(`   - **Then** ${scenario.then}`);
          }
        }
        const xrefs = this.renderStoryCrossRefs(story, planForRender);
        if (xrefs.length > 0) {
          lines.push('');
          lines.push(`**Cross-references:** ${xrefs.join(' ')}`);
        }
        lines.push('');
      }
    }

    lines.push('## Edge Cases', '');
    const synthesised = synthesiseEdgeCases(plan);
    if (synthesised.length === 0) {
      lines.push(
        '> No edge cases identified by the planner. Add explicit edge-case notes during refinement.',
        '',
      );
    } else {
      for (const s of synthesised) {
        lines.push(`- ${s}`);
      }
      lines.push('');
    }

    lines.push('## Requirements *(mandatory)*', '');
    lines.push('### Functional Requirements', '');
    const resolvedFr010 = resolveFr010ForSpec(plan);
    if ((planForRender.functionalRequirements ?? []).length === 0) {
      lines.push('> No functional requirements extracted for this plan yet.', '');
    } else {
      for (const fr of planForRender.functionalRequirements) {
        if (fr.id === 'FR-010' && resolvedFr010) {
          lines.push(this.renderFr010Block(fr, resolvedFr010));
          continue;
        }
        const safeNote = stripNestedMarker(fr.clarificationNote);
        const clarification =
          fr.needsClarification && safeNote
            ? ` **[NEEDS CLARIFICATION: ${safeNote}]**`
            : fr.needsClarification
              ? ' **[NEEDS CLARIFICATION]**'
              : '';
        const profileTag =
          fr.validationProfile && fr.validationProfile !== 'none'
            ? ` _(${fr.validationProfile})_`
            : '';
        lines.push(`- **${fr.id}** — ${fr.text}${profileTag}${clarification}`);
      }
      lines.push('');
    }

    if ((plan.accessibilityRequirements ?? []).length > 0) {
      lines.push('### Accessibility', '');
      for (const fr of plan.accessibilityRequirements ?? []) {
        lines.push(`- **${fr.id}** — ${fr.text}`);
      }
      lines.push('');
    }

    if ((plan.nonFunctionalRequirements ?? []).length > 0) {
      lines.push('## Non-Functional Requirements *(mandatory)*', '');
      for (const nfr of plan.nonFunctionalRequirements ?? []) {
        lines.push(`- **${nfr.id}** — ${nfr.text} _(category: ${nfr.category})_`);
      }
      lines.push('');
    }

    lines.push('## Key Entities', '');
    const entities: string[] = [];
    const keyEntities: KeyEntity[] = plan.keyEntities ?? [];
    const personality = keyEntities.find((k) => k.id === 'Personality');
    if (personality) {
      entities.push(this.renderKeyEntity('Personality', personality, true));
    }
    for (const ke of keyEntities) {
      if (ke.id === 'Personality') continue;
      entities.push(this.renderKeyEntity(ke.id, ke, false));
    }
    for (const domain of plan.domains ?? []) {
      for (const agg of domain.aggregates ?? []) {
        entities.push(`- **${agg.name}** (\`${agg.id}\`, in \`${domain.id}\`) — ${agg.description}`);
      }
    }
    if (entities.length === 0) {
      lines.push('> No aggregates defined yet.', '');
    } else {
      lines.push(...entities, '');
    }

    if (plan.meta.avatarBundleSpec) {
      lines.push('### Avatar Bundle Schema', '');
      const spec = plan.meta.avatarBundleSpec;
      lines.push(`- **Manifest version:** \`${spec.manifestVersion}\``);
      if (spec.manifestKeys.length > 0) {
        lines.push(`- **Manifest keys:** ${spec.manifestKeys.map((k) => `\`${k}\``).join(', ')}`);
      }
      if (spec.importValidatorRef) {
        lines.push(`- **Import validator ref:** \`${spec.importValidatorRef}\``);
      }
      lines.push('');
    }

    lines.push('## Offline Behaviour', '');
    const offlineBlock = this.buildOfflineBehaviourBlock(plan);
    lines.push(...offlineBlock);

    lines.push('## Success Criteria *(mandatory)*', '');
    lines.push('### Measurable Outcomes', '');
    if ((plan.successCriteria ?? []).length === 0) {
      lines.push('> No success criteria defined yet.', '');
    } else {
      const rows = plan.successCriteria.map((sc) => ({
        id: sc.id,
        text: sc.text,
        scenario: this.resolveMeasurementScenario(sc),
      }));
      const hasScenario = rows.some((r) => r.scenario);
      if (hasScenario) {
        lines.push('| ID | Outcome | Measurement Scenario |');
        lines.push('|---|---|---|');
        for (const row of rows) {
          lines.push(`| **${row.id}** | ${row.text} | ${row.scenario ?? '—'} |`);
        }
        lines.push('');
      } else {
        for (const sc of plan.successCriteria) {
          lines.push(`- **${sc.id}** — ${sc.text}`);
        }
        lines.push('');
      }
    }

    lines.push('## Preconditions & Constraints', '');
    lines.push(
      '> Operational preconditions and single-tenant constraints. See also `systemOverview.constraints[]`.',
      '',
    );
    if ((plan.systemOverview.constraints ?? []).length > 0) {
      for (const c of plan.systemOverview.constraints) {
        lines.push(`- ${c}`);
      }
      lines.push('');
    }
    const operational = plan.meta.operationalConstraints;
    if (operational) {
      const sidecarBindWarn = /0\.0\.0\.0/.test(operational.sidecarBind);
      const sidecarLine = sidecarBindWarn
        ? `- **Sidecar bind:** \`${operational.sidecarBind}\` — ${MULTI_TENANT_BAN_WARNING}`
        : `- **Sidecar bind:** \`${operational.sidecarBind}\``;
      lines.push('**Operational Constraints:**', '');
      lines.push(sidecarLine);
      lines.push(`- **Auth:** \`${operational.auth}\``);
      lines.push(`- **Multi-tenant ban:** ${operational.multiTenantBan}`);
      lines.push('');
    }

    lines.push('## Non-Goals', '');
    const nonGoals: ReadonlyArray<string> = (plan.nonGoals ?? []).length > 0 ? plan.nonGoals ?? [] : NON_GOALS_SEED;
    const nonGoalsAreSeed = (plan.nonGoals ?? []).length === 0;
    for (const ng of nonGoals) {
      const prefix = nonGoalsAreSeed ? `${VAGUE_ADJECTIVE_PLACEHOLDER} — default` : '';
      lines.push(`- ${prefix}${prefix ? ' ' : ''}${ng}`.trim());
    }
    if (nonGoalsAreSeed) {
      lines.push('', '> Default seed — override via `plan.nonGoals[]`.', '');
    }

    const openQuestions = this.collectOpenQuestions(plan);
    if (openQuestions.length > 0) {
      lines.push('', '## Open Questions', '');
      lines.push(OPEN_QUESTIONS_ANCHOR, '');
      for (const q of openQuestions) {
        lines.push(`- ${q}`);
      }
      lines.push('');
    }

    lines.push('## Glossary', '');
    const glossaryEntries: ReadonlyArray<{ term: string; definition: string }> =
      (plan.glossary ?? []).length > 0 ? plan.glossary ?? [] : GLOSSARY_SEED;
    const glossaryIsSeed = (plan.glossary ?? []).length === 0;
    lines.push('| Term | Definition |', '|---|---|');
    for (const entry of glossaryEntries) {
      lines.push(`| **${entry.term}** | ${entry.definition}${glossaryIsSeed ? ' _(default seed)_' : ''} |`);
    }
    lines.push('');

    return lines.join('\n');
  }

  /**
   * When no user story has `id === 'US007'` we append a generated story for
   * the transcript export surface. Defaults are sourced from
   * `plan.meta.transcriptSchema` (or `transcriptFormat` on an existing story).
   */
  private ensureTranscriptStory(plan: Plan): UserStory[] {
    const stories = plan.userStories ?? [];
    if (stories.some((s) => s.id === 'US007')) return stories;
    const ts = plan.meta.transcriptSchema ?? { primary: 'json', secondary: 'markdown' };
    const synthetic: UserStory = {
      id: 'US007',
      title: 'Transcript export',
      priority: 'P2',
      description: 'Operators can export the transcript of a session for review and archival.',
      whyThisPriority:
        'Required for compliance review and for the Spec Verifier cross-check loop.',
      independentTest:
        'Generate a transcript artefact from the spec editor and verify it round-trips through the JSON Schema validator.',
      acceptanceScenarios: [
        {
          id: 'SC-007a',
          given: 'a completed session is recorded in the conversation-memory service',
          when: 'an operator requests a transcript export',
          then: `an artefact with \`primary=${ts.primary}\` and \`secondary=${ts.secondary ?? 'n/a'}\` is produced and signed`,
        },
      ],
      boundedContextIds: [],
      transcriptFormat: {
        primary: ts.primary,
        secondary: ts.secondary,
        schemaRef: ts.schemaRef,
      },
    };
    return [...stories, synthetic];
  }

  private renderTranscriptFormat(format: { primary: string; secondary?: string; schemaRef?: string }): string {
    const parts = [`primary: \`${format.primary}\``];
    if (format.secondary) parts.push(`secondary: \`${format.secondary}\``);
    if (format.schemaRef) parts.push(`schema: \`${format.schemaRef}\``);
    return `**Transcript format:** ${parts.join(', ')}`;
  }

  private renderStoryCrossRefs(story: UserStory, plan: Plan): string[] {
    const refs: string[] = [];
    const haystack = `${story.title} ${story.description} ${story.whyThisPriority} ${story.independentTest} ${story.acceptanceScenarios.map((s) => `${s.id} ${s.given} ${s.when} ${s.then}`).join(' ')}`;
    const frs = Array.from(new Set(Array.from(haystack.matchAll(/FR-[A-Za-z0-9-]+/g)).map((m) => m[0])))
      .filter((id) => (plan.functionalRequirements ?? []).some((fr) => fr.id === id) || id.startsWith('FR-'));
    const scs = Array.from(new Set(Array.from(haystack.matchAll(/SC-\d+/g)).map((m) => m[0])))
      .filter((id) => (plan.successCriteria ?? []).some((sc) => sc.id === id));
    for (const id of frs) refs.push(`↔ ${id}`);
    for (const id of scs) refs.push(`↔ ${id}`);
    return refs;
  }

  private renderFr010Block(fr: FunctionalRequirement, resolved: { text: string; latencyTargetMs: number; note: string; embeddingVersioning: { schemaMigration: string; sampleBackfill: string } }): string {
    const lines: string[] = [
      `- **${fr.id}** (resolved at generation time) — ${resolved.text}`,
      '',
      '  > **Embedding Versioning**',
      `  > - Schema migration: ${resolved.embeddingVersioning.schemaMigration}`,
      `  > - Sample backfill: ${resolved.embeddingVersioning.sampleBackfill}`,
      `  > - Latency budget: ${resolved.latencyTargetMs}ms p95 (profile \`deterministic-embedding\`).`,
      `  > - Note: ${resolved.note}`,
      '',
    ];
    return lines.join('\n');
  }

  private renderKeyEntity(id: string, entity: KeyEntity, isFirstClass: boolean): string {
    const label = isFirstClass ? '**Personality** _(first-class)_' : `**${entity.name}**`;
    const lines: string[] = [`- ${label} (\`${id}\`) — ${entity.description}`];
    if (entity.fields.length > 0) {
      lines.push('  - Fields:');
      for (const field of entity.fields) {
        const rules = field.rules.length > 0 ? ` _(rules: ${field.rules.join('; ')})_` : '';
        lines.push(`    - \`${field.name}\`: ${field.type}${rules}`);
      }
    }
    if (entity.invariants.length > 0) {
      lines.push('  - Invariants:');
      for (const inv of entity.invariants) {
        lines.push(`    - ${inv}`);
      }
    }
    return lines.join('\n');
  }

  private buildOfflineBehaviourBlock(plan: Plan): string[] {
    const out: string[] = [];
    const contract: OfflineContract | undefined = plan.offlineContract;
    if (!contract) {
      if (plan.meta.localFirst) {
        out.push(
          '> ⚠️ [OFFLINE CONTRACT PENDING — regenerate to populate this section]',
          '',
        );
        return out;
      }
      out.push(
        '> No offline contract declared. `local-first` is not set on this plan; add `plan.offlineContract` to surface the per-capability degradation matrix below.',
        '',
      );
      return out;
    }
    out.push('**Per-capability degradation matrix:**', '');
    out.push('| Capability | Mode | Reason |', '|---|---|---|');
    for (const row of contract.degrade) {
      out.push(`| \`${row.capability}\` | \`${row.mode}\` | ${row.reason} |`);
    }
    out.push('');
    if (contract.cacheableAssets.length > 0) {
      out.push('**Cacheable assets:**', '');
      for (const asset of contract.cacheableAssets) {
        out.push(`- ${asset}`);
      }
      out.push('');
    }
    out.push(`**UI indicator:** ${contract.uiIndicator}`, '');
    if (contract.replayOnReconnect.length > 0) {
      out.push('**Replay-on-reconnect queue:**', '');
      for (const item of contract.replayOnReconnect) {
        out.push(`- ${item}`);
      }
      out.push('');
    }
    return out;
  }

  private resolveMeasurementScenario(sc: { id: string; measurementScenario?: string }): string | undefined {
    if (sc.measurementScenario && sc.measurementScenario.trim().length > 0) {
      return sc.measurementScenario;
    }
    if (sc.id === 'SC-001') return SC001_DEFAULT_SCENARIO;
    if (sc.id === 'SC-003') return SC003_BASELINE_DEFINITION;
    return undefined;
  }

  private collectOpenQuestions(plan: Plan): string[] {
    const out: string[] = [];
    const re = /\[?\s*NEEDS\s+CLARIFICATION\s*\]?[:.\s-]*([^\n.]*)/i;
    const push = (source: string | undefined, context: string): void => {
      if (!source) return;
      const match = re.exec(source);
      if (match) {
        const note = (match[1] ?? '').trim();
        out.push(`\`${context}\` — ${note || 'unresolved clarification needed'}`);
      }
    };
    for (const layer of plan.architectureLayers ?? []) {
      push(layer.summary, `${layer.id}.summary`);
      if (layer.technicalContext) {
        const tc = layer.technicalContext;
        for (const [key, value] of Object.entries(tc)) {
          if (Array.isArray(value)) continue;
          push(value, `${layer.id}.technicalContext.${key}`);
        }
      }
      for (const gate of layer.constitutionCheck ?? []) {
        push(gate, `${layer.id}.constitutionCheck`);
      }
      for (const ct of layer.complexityTracking ?? []) {
        push(ct.violation, `${layer.id}.complexityTracking.violation`);
        push(ct.whyNeeded, `${layer.id}.complexityTracking.whyNeeded`);
        push(ct.simplerAlternativeRejected, `${layer.id}.complexityTracking.simplerAlternativeRejected`);
      }
    }
    for (const bc of plan.boundedContexts ?? []) {
      push(bc.description, `boundedContext.${bc.id}.description`);
    }
    for (const task of plan.agentTasks ?? []) {
      push(task.description, `agentTask.${task.id}.description`);
    }
    return out;
  }

  private buildPlanMd(plan: Plan): string {
    const branch = plan.meta.branchName ?? branchName(plan);
    const tc = this.aggregateTechnicalContext(plan);
    const lines: string[] = [
      `# Implementation Plan: ${plan.meta.title}`,
      '',
      `> ${plan.meta.summary}`,
      '',
      `**Branch**: \`${branch}\` · **Date**: ${plan.meta.generatedAt} · **Spec**: [./spec.md](./spec.md)`,
      '',
      '**Note**: This template is filled in by the `__SPECKIT_COMMAND_PLAN__` command; its definition describes the execution workflow.',
      '',
      '## Summary',
      '',
      plan.meta.summary,
      '',
      '## Technical Context',
      '',
      '| Field | Value |',
      '|---|---|',
      `| **Language / Version** | ${tc.languageVersion} |`,
      `| **Primary Dependencies** | ${tc.primaryDependencies} <br/> _langchain decision: ${tc.langchainDecision}_ |`,
      `| **Storage** | ${tc.storage} |`,
      `| **Testing** | ${tc.testing} |`,
      `| **Target Platform** | ${tc.targetPlatform} |`,
      `| **Project Type** | ${tc.projectType} |`,
      `| **Performance Goals** | ${tc.performanceGoals} |`,
      `| **Constraints** | ${tc.constraints} |`,
      `| **Scale / Scope** | ${tc.scaleScope} |`,
      '',
      '## Constitution Check',
      '',
    ];

    const constitutionItems = plan.constitution
      ? plan.constitution.articles.map((a) => {
          const resolved = (a.content ?? '').trim().length > 0;
          return { article: a, resolved };
        })
      : [];
    if (constitutionItems.length === 0) {
      lines.push(
        '> ⚠️ PENDING — no project constitution on this plan. Regenerate to populate the 9-article constitution at `.specify/memory/constitution.md`.',
        '',
      );
    } else {
      const allResolved = constitutionItems.every((i) => i.resolved);
      lines.push(
        allResolved
          ? 'All gates pass at the current draft:'
          : '⚠️ PENDING — regenerate the plan to ratify the constitution. Current draft:',
        '',
      );
      for (const { article, resolved } of constitutionItems) {
        lines.push(
          `- ${resolved ? '✅' : '⚠️ PENDING'} Article ${article.articleNumber} — ${article.title}`,
        );
      }
      lines.push('');
    }

    const allGates = (plan.architectureLayers ?? []).flatMap((l) =>
      (l.constitutionCheck ?? []).map((g) => `\`${l.id}\` — ${g}`),
    );
    if (allGates.length > 0) {
      lines.push('**Per-layer gates:**', '');
      for (const gate of allGates) {
        lines.push(`- ✅ ${gate}`);
      }
      lines.push('');
    }

    lines.push('## Project Structure', '');
    lines.push('### Documentation (this plan)', '');
    lines.push('```text');
    lines.push('specs/');
    lines.push(`└── ${branch}/`);
    lines.push('    ├── README.md');
    lines.push('    ├── spec.md');
    lines.push('    ├── plan.md');
    lines.push('    ├── data-model.md');
    lines.push('    ├── contracts/');
    lines.push('    ├── quickstart.md');
    lines.push('    ├── tasks.md');
    lines.push('    ├── checklist.md');
    lines.push('    ├── ARCHITECTURE.md');
    lines.push('    ├── AGENTS.md');
    lines.push('    └── docs/');
    lines.push('        ├── 00-system/');
    lines.push('        ├── 10-architecture/');
    lines.push('        ├── 20-decisions/');
    lines.push('        ├── 30-…/ (per layer)');
    lines.push('        ├── 50-workflows/');
    lines.push('        └── 60-agent-tasks/');
    lines.push('```');
    lines.push('');
    lines.push('### Source Code', '');
    lines.push('```text');
    const treePaths = this.collectCanonicalSourceTree(plan);
    if (treePaths.length === 0) {
      lines.push('No source paths declared. Populate `agentTasks[].fileHints` or `architectureLayers[].directoryStructure[].path` to populate this block.');
    } else {
      for (const p of treePaths) lines.push(`${p}/`);
    }
    lines.push('```');
    lines.push('');

    lines.push(
      '**Structure Decision**: [Document the selected structure — see the per-layer `projectStructureTree` diagrams in `docs/10-architecture/`]',
      '',
    );

    lines.push('## Complexity Tracking', '');
    const tracking = (plan.architectureLayers ?? []).flatMap((l) =>
      (l.complexityTracking ?? []).map((c) => ({ ...c, layerId: l.id })),
    );
    const hasOpenViolations = (plan.architectureLayers ?? []).some((l) =>
      (l.constitutionCheck ?? []).some((g) => g.startsWith('❌')),
    );
    if (tracking.length === 0 || !hasOpenViolations) {
      lines.push('> No constitution violations; standard complexity.', '');
    } else {
      lines.push('> **Fill ONLY if Constitution Check has violations that must be justified**', '');
      lines.push('| Layer | Violation | Why Needed | Simpler Alternative Rejected |');
      lines.push('|---|---|---|---|');
      for (const row of tracking) {
        lines.push(
          `| \`${row.layerId}\` | ${row.violation} | ${row.whyNeeded} | ${row.simplerAlternativeRejected} |`,
        );
      }
      lines.push('');
    }

    lines.push('## See also', '');
    lines.push('- Data model: [./data-model.md](./data-model.md)');
    lines.push('- API contracts: [./contracts/](./contracts/)');
    lines.push('- Quickstart: [./quickstart.md](./quickstart.md)');
    lines.push('- Checklist: [./checklist.md](./checklist.md)');

    return lines.join('\n');
  }

  private aggregateTechnicalContext(plan: Plan): {
    languageVersion: string;
    primaryDependencies: string;
    storage: string;
    testing: string;
    targetPlatform: string;
    projectType: string;
    performanceGoals: string;
    constraints: string;
    scaleScope: string;
    langchainDecision: string;
  } {
    const layers = plan.architectureLayers ?? [];
    const techStack = layers.flatMap((l) => l.techStack);
    const uniqueTechStack = Array.from(new Set(techStack)).filter(Boolean);
    const aggregateField = (key: 'storage' | 'targetPlatform' | 'performanceGoals' | 'constraints' | 'scaleScope'): string => {
      const values = layers
        .map((l) => l.technicalContext?.[key])
        .filter((v): v is string => !!v && v.length > 0);
      if (values.length === 0) return 'varies per layer (see `docs/10-architecture/`)';
      const unique = Array.from(new Set(values));
      return unique.length === 1 ? unique[0] : unique.join('; ');
    };
    const layerIds = layers.map((l) => l.id).join(' + ');
    const projectType = layers.length === 0
      ? 'Single layer'
      : layers.length === 1
        ? `${layers[0].name} (${layers[0].id})`
        : `Multi-layer (${layerIds})`;
    const hints = plan.meta.technologyHints?.trim();
    const langchainDecision = this.resolveLangChainDecision(plan, techStack);
    return {
      languageVersion: hints ? hints : 'TypeScript 5.x (Angular 17+, Node 20+)',
      primaryDependencies: uniqueTechStack.length > 0 ? uniqueTechStack.join(', ') : 'N/A',
      storage: aggregateField('storage'),
      testing: 'Vitest / Jasmine for frontend, pytest for backend',
      targetPlatform: aggregateField('targetPlatform'),
      projectType,
      performanceGoals: aggregateField('performanceGoals'),
      constraints: aggregateField('constraints'),
      scaleScope: aggregateField('scaleScope'),
      langchainDecision,
    };
  }

  /**
   * Build the single canonical `### Source Code` tree in `plan.md`. Prefers
   * paths derived from `agentTasks[].fileHints` (since each task is the
   * authoritative owner of the file it ships), and falls back to
   * `architectureLayers[].directoryStructure[].path` when no tasks exist.
   * Leaf directories that contain no concrete file hint are dropped.
   */
  private collectCanonicalSourceTree(plan: Plan): string[] {
    const dirs = new Set<string>();
    const hintDirs: string[] = [];
    for (const task of plan.agentTasks ?? []) {
      for (const hint of task.fileHints ?? []) {
        const dir = hint.replace(/\/[^/]+$/, '');
        if (dir) {
          hintDirs.push(dir);
          dirs.add(dir);
        }
      }
    }
    if (hintDirs.length > 0) {
      return [...dirs].sort();
    }
    const layerPaths = (plan.architectureLayers ?? []).flatMap((l) =>
      (l.directoryStructure ?? []).map((d) => d.path),
    );
    for (const p of layerPaths) {
      const trimmed = p.replace(/\/[^/]+$/, '');
      if (trimmed) dirs.add(trimmed);
    }
    return [...dirs].sort();
  }

  /**
   * Spec-kit requires the implementation plan to either declare an agent
   * framework or document why none is needed. The decision is sourced from
   * `plan.agentFramework` when set, otherwise inferred from the tech stack.
   */
  private resolveLangChainDecision(plan: Plan, techStack: string[]): string {
    if (plan.agentFramework && plan.agentFramework !== 'none') {
      return `Agent framework: ${plan.agentFramework} — see ADR-0001 in \`docs/20-decisions/ADR-0001-agent-framework.md\`.`;
    }
    const usesLangChain = techStack.some((t) => /LangChain|LangGraph/i.test(t));
    return usesLangChain
      ? 'Includes LangChain / LangGraph for the agentic pipeline (see per-layer architecture).'
      : `Agent framework: none — deterministic retrieval via the chosen embedding model. See ADR-0001 in \`docs/20-decisions/ADR-0001-agent-framework.md\`.`;
  }

  private buildDataModelMd(plan: Plan): string {
    const lines: string[] = [
      `# ${plan.meta.title} — Data Model`,
      '',
      'Cross-layer index of aggregates, value objects, commands, and domain events.',
      '',
    ];

    if ((plan.domains ?? []).length === 0) {
      lines.push('> No domains declared.', '');
      return lines.join('\n');
    }

    lines.push('## Domains', '');
    lines.push('| Domain | Layer | Aggregates | Events |');
    lines.push('|---|---|---|---|');
    for (const d of plan.domains) {
      lines.push(
        `| [${d.name}](#${this.anchor(d.id)}) | \`${d.layer}\` | ${(d.aggregates ?? []).length} | ${(d.domainEvents ?? []).length} |`,
      );
    }
    lines.push('');

    for (const d of plan.domains) {
      lines.push(`## ${d.name}`, '');
      lines.push(d.description, '');
      lines.push(`**Layer:** \`${d.layer}\` · **Directory:** \`${d.directoryPath}\``, '');

      if ((d.aggregates ?? []).length > 0) {
        lines.push('### Aggregates', '');
        for (const agg of d.aggregates ?? []) {
          lines.push(`#### ${agg.name}`, '');
          lines.push(agg.description, '');
          lines.push(`**Root entity:** \`${agg.rootEntity}\``, '');
          lines.push('**Invariants:**', '');
          for (const inv of agg.invariants) {
            lines.push(`- ${inv}`);
          }
          lines.push('');
          lines.push('**Value objects:**', '');
          for (const vo of agg.valueObjects) {
            lines.push(`- \`${vo}\``);
          }
          lines.push('');
          lines.push('**Commands:**', '');
          for (const cmd of agg.commands) {
            lines.push(`- \`${cmd}\``);
          }
          lines.push('');
          lines.push('**Domain events emitted:**', '');
          for (const ev of agg.domainEvents) {
            lines.push(`- \`${ev}\``);
          }
          lines.push('');
        }
      }

      if ((d.domainEvents ?? []).length > 0) {
        lines.push('### Domain Events', '');
        for (const ev of d.domainEvents ?? []) {
          lines.push(`#### ${ev.name}`, '');
          lines.push(ev.description, '');
          lines.push(`**Triggered by:** ${ev.triggeredBy}`, '');
          lines.push(`**Handled by:** ${ev.handledBy.join(', ') || 'N/A'}`, '');
          lines.push('**Payload:**', '');
          for (const p of ev.payload) {
            lines.push(`- \`${p}\``);
          }
          lines.push('');
        }
      }
    }

    return lines.join('\n');
  }

  private anchor(id: string): string {
    return slugify(id);
  }

  private buildContracts(plan: Plan, prefix: string): MarkdownFile[] {
    return (plan.architectureLayers ?? []).map((layer) => ({
      path: `${prefix}/contracts/${layer.id}.md`,
      content: this.buildLayerContractsMd(plan, layer.id),
    }));
  }

  private buildLayerContractsMd(plan: Plan, layerId: string): string {
    const layer = (plan.architectureLayers ?? []).find((l) => l.id === layerId);
    const lines: string[] = [
      `# ${layer?.name ?? this.titleCase(layerId)} — Contracts`,
      '',
      `> Public surface for the **${layerId}** layer. Sourced from each component's \`publicApi\`, \`inputs\`, and \`outputs\`.`,
      '',
    ];

    const components = plan.domains
      .flatMap((d) => d.components)
      .filter((c) => c.targetFile?.startsWith(layer?.directoryStructure?.[0]?.path ?? '') || true);

    if (components.length === 0) {
      lines.push('> No public components documented for this layer.', '');
      return lines.join('\n');
    }

    for (const c of components) {
      lines.push(`## ${c.name}`, '');
      lines.push(`**Type:** \`${c.type}\` · **Layer:** \`${c.layer}\` · **File:** \`${c.targetFile}\``, '');
      lines.push(c.description, '');
      if ((c.publicApi ?? []).length) {
        lines.push('**Public API:**', '');
        for (const api of c.publicApi) {
          lines.push(`- \`${api}\``);
        }
        lines.push('');
      }
      if (c.inputs.length) {
        lines.push('**Inputs:**', '');
        for (const i of c.inputs) {
          lines.push(`- ${i}`);
        }
        lines.push('');
      }
      if (c.outputs.length) {
        lines.push('**Outputs:**', '');
        for (const o of c.outputs) {
          lines.push(`- ${o}`);
        }
        lines.push('');
      }
    }

    return lines.join('\n');
  }

  private buildQuickstartMd(plan: Plan): string {
    const lines: string[] = [
      `# ${plan.meta.title} — Quickstart / Validation Scenarios`,
      '',
      '> Auto-derived from the per-layer constitution checks. Each scenario is a BDD Given/When/Then that an automated test (or manual run) can reproduce.',
      '',
    ];

    const gates = (plan.architectureLayers ?? []).flatMap((l) =>
      (l.constitutionCheck ?? []).map((g) => ({ layerId: l.id, gate: g })),
    );

    if (gates.length === 0) {
      lines.push('> No constitution entries to derive scenarios from. Add per-layer gates in `plan.md` to populate this section.', '');
      return lines.join('\n');
    }

    for (const [i, entry] of gates.entries()) {
      lines.push(`## Scenario ${String(i + 1).padStart(2, '0')} — ${entry.gate}`, '');
      lines.push('- **Given** the plan has been generated and the per-layer constitution checks are recorded,');
      lines.push(`- **When** an agent implements the \`${entry.layerId}\` layer,`);
      lines.push(`- **Then** ${entry.gate.toLowerCase().replace(/\.$/, '')} holds true.`, '');
    }

    return lines.join('\n');
  }

  private buildTasksMd(plan: Plan): string {
    const userStories = plan.userStories ?? [];
    const storiesByPriority = [...userStories].sort((a, b) => a.priority.localeCompare(b.priority));
    const storiesById = new Map(storiesByPriority.map((s) => [s.id, s] as const));

    const fmt = (n: number): string => `T${String(n).padStart(3, '0')}`;
    const hintSets = (plan.agentTasks ?? []).map((t) => new Set([...t.fileHints, ...t.userStoryIds]));
    let counter = 1;
    const next = (): string => fmt(counter++);

    const lines: string[] = [
      `# Tasks: ${plan.meta.title}`,
      '',
      '> Tasks organised by User Story priority. Tests are written **before** implementation inside each story phase. Tasks with disjoint files (`fileHints`) AND disjoint user stories (`userStoryIds`) from every other task are marked `[P]` (parallelizable).',
      '',
      '## Format',
      '',
      '`- [ ] T### [P?] [USn?] Description — files: a, b`',
      '',
      '## Path Conventions',
      '',
      '- Repo root: this plan\'s branch (`specs/<NNN>-<slug>/`)',
      '- Per-layer architecture: `docs/10-architecture/<layer>-architecture.md`',
      '- Per-task file: `docs/60-agent-tasks/<NN>-<slug>.md`',
      '',
      '## Phase 1: Setup (Shared Infrastructure)',
      '',
      `- [ ] ${next()} Bootstrap repository layout per \`docs/10-architecture/overview.md\` and per-layer \`projectStructureTree\`.`,
      '',
    ];

    lines.push('## Phase 2: Foundational (Blocking Prerequisites)', '');
    const constitutionTasks = synthesiseConstitutionTasks(plan);
    const foundational = (plan.domains ?? []).filter((d) => d.layer === 'domain');
    if (constitutionTasks.length === 0) {
      if (foundational.length === 0) {
        lines.push('> No domain-layer components block every user story.', '');
      } else {
        for (const domain of foundational) {
          lines.push(
            `- [ ] ${next()} Establish \`${domain.name}\` domain scaffolding (${domain.components.length} component(s)).`,
          );
        }
      }
    } else {
      for (const ct of constitutionTasks) {
        const tag = ct.constitutionArticle ? `Article ${ct.constitutionArticle} — ` : '';
        lines.push(`- [ ] ${next()} [PHASE 2] (pack) ${tag}${ct.title}`);
      }
    }
    const ghosts = this.ghostFoundationalTasks(plan);
    for (const ghost of ghosts) {
      lines.push(
        `- [ ] ${next()} (ghost) ${ghost.title}`,
      );
    }
    lines.push('');

    let phaseNum = 3;

    if (storiesByPriority.length === 0) {
      const polishPhase = phaseNum;
      lines.push(`## Phase ${polishPhase}: Polish & Cross-Cutting Concerns`, '');
      lines.push(
        '**Independent Test**: every success criterion has a reproducible measurement harness and the audit/regenerate cycle is green.',
        '',
      );
      this.appendPolishPhase(plan, lines, next);
      lines.push('', '## Dependencies & Execution Order', '');
      lines.push('- Phase 1 (Setup) blocks every later phase.');
      lines.push('- Phase 2 (Foundational) blocks every Polish phase.');
      lines.push('');
      lines.push('## Parallel Example', '');
      lines.push('```text');
      lines.push('# Within a User Story phase:');
      lines.push('T101 [P] (US001) Build the Post aggregate');
      lines.push('T102 [P] (US001) Build the PostRepository');
      lines.push('T103     (US001) Wire the Post REST controller (depends on T101, T102)');
      lines.push('```');
      lines.push('');
      lines.push('## Implementation Strategy', '');
      lines.push('- MVP first: ship Phase 1 → Phase 2 → Polish. Validate before extending.');
      lines.push('- Tests-first: every phase writes its tests before the implementation sub-phase.');
      lines.push('');
      lines.push('## Notes', '');
      lines.push('> No User Stories defined for this plan. Add user stories (`USNNN`) in `spec.md`, regenerate the plan, then re-export `tasks.md`.');
      lines.push('- `[P]` tasks can run in parallel only when their `fileHints` AND `userStoryIds` are disjoint from every other in-flight task.');
      lines.push('- `[USn]` markers cross-link the task to a User Story in `spec.md`.');
      return lines.join('\n');
    }

    for (const story of storiesByPriority) {
      const mvpTag = story.priority === 'P1' ? ' 🎯 MVP' : '';
      lines.push(
        `## Phase ${phaseNum}: User Story ${story.id} — ${story.title} (Priority: ${story.priority})${mvpTag}`,
        '',
      );
      lines.push(`**Independent Test**: ${story.independentTest}`, '');
      lines.push(`### Tests for User Story ${story.id} (OPTIONAL — write first)`, '');
      for (const sc of story.acceptanceScenarios) {
        lines.push(
          `- [ ] ${next()} [${story.id}] Author BDD for ${sc.id}: Given ${sc.given}, When ${sc.when}, Then ${sc.then}`,
        );
      }
      const contextComponents = this.componentsForStory(story, plan);
      const testableComponents = contextComponents.filter(
        (c) => (c.tddSpec?.unitTests?.length ?? 0) + (c.tddSpec?.integrationTests?.length ?? 0) > 0,
      );
      if (testableComponents.length > 0) {
        lines.push(
          `- [ ] ${next()} Surface TDD specs for the components this story touches: ${testableComponents
            .slice(0, 4)
            .map((c) => `\`${c.id}\``)
            .join(', ')}.`,
        );
      }
      lines.push('');
      lines.push(`### Implementation for User Story ${story.id}`, '');
      const relatedTasks = (plan.agentTasks ?? []).filter((t) => t.userStoryIds.includes(story.id));
      const synthetics = this.syntheticStoryTasks(story, plan);
      const emitMap = new Map<string, { task: AgentTask; primaryStoryId: string }>();
      for (const task of relatedTasks) {
        const key = dedupKey(task);
        const existing = emitMap.get(key);
        if (!existing) {
          emitMap.set(key, { task, primaryStoryId: pickPrimaryStory(task, storiesByPriority) });
        }
      }
      const primaryHere = [...emitMap.values()].filter(({ primaryStoryId }) => primaryStoryId === story.id);
      const crossRefs = [...emitMap.values()].filter(({ primaryStoryId }) => primaryStoryId !== story.id);
      const syntheticsForStory = synthetics;
      if (primaryHere.length === 0 && crossRefs.length === 0 && syntheticsForStory.length === 0) {
        lines.push(
          `> No agent tasks linked to ${story.id}. Add \`userStoryIds: ["${story.id}"]\` on the relevant \`agentTasks\` entries.`,
        );
      } else {
        for (const { task } of primaryHere) {
          const idx = (plan.agentTasks ?? []).indexOf(task);
          const parallel = this.canParallelize(task, hintSets, idx);
          const storyTags = task.userStoryIds.length > 0
            ? `${task.userStoryIds.map((id) => `[${id}]`).join(' ')} `
            : '';
          lines.push(`- [ ] ${next()} ${parallel ? '[P] ' : ''}${storyTags}${task.title}`);
          lines.push(`  - **Files:** ${task.fileHints.map((f) => `\`${f}\``).join(', ')}`);
          lines.push(
            `  - **User Stories:** ${task.userStoryIds.length > 0 ? task.userStoryIds.map((id) => `\`${id}\`${storiesById.get(id) ? '' : ' (missing)'}`).join(', ') : '_none linked_'}`,
          );
          lines.push(`  - ${this.formatAgentTaskDescription(task, plan)}`);
          if (task.acceptanceCriteria.length) {
            lines.push('  - **Acceptance criteria:**');
            for (const ac of task.acceptanceCriteria) {
              lines.push(`    - [ ] ${ac}`);
            }
          }
        }
        for (const { task, primaryStoryId } of crossRefs) {
          const snippet = (task.description ?? '').slice(0, 60).trim();
          const ellipsis = (task.description ?? '').length > 60 ? '…' : '';
          lines.push(
            `- [ ] ${next()} (ref ${primaryStoryId}) [${story.id}] — implementation lives in ${primaryStoryId} (${snippet}${ellipsis})`,
          );
        }
        for (const synth of syntheticsForStory) {
          const storyTags = synth.userStoryIds.length > 0
            ? `${synth.userStoryIds.map((id) => `[${id}]`).join(' ')} `
            : '';
          lines.push(`- [ ] ${next()} (synth) ${storyTags}${synth.title}`);
          lines.push(`  - **Files:** ${synth.fileHints.map((f) => `\`${f}\``).join(', ')}`);
          lines.push(`  - **User Stories:** ${synth.userStoryIds.map((id) => `\`${id}\``).join(', ')}`);
          lines.push(`  - ${synth.description}`);
          if (synth.acceptanceCriteria.length) {
            lines.push('  - **Acceptance criteria:**');
            for (const ac of synth.acceptanceCriteria) {
              lines.push(`    - [ ] ${ac}`);
            }
          }
        }
      }

      if (story.onboarding) {
        const onboardingSuffixes = [
          'onboarding-route',
          'voice-record-ui',
          'avatar-picker-ui',
          'save-flow-sanitise',
        ];
        for (const suffix of onboardingSuffixes) {
          const title = ONBOARDING_SUBTASK_TITLES[suffix];
          lines.push(`- [ ] ${next()} (onboarding) [${story.id}] ${title}`);
        }
      }

      const roundTripFrs = (plan.functionalRequirements ?? []).filter(
        (fr) => fr.validationProfile === 'round-trip' || fr.roundTripRequired,
      );
      for (const fr of roundTripFrs) {
        const matchingSc =
          (plan.successCriteria ?? []).find((s) => s.text.toLowerCase().includes('reimport')) ??
          (plan.successCriteria ?? []).find((s) => s.id === 'SC-005b');
        lines.push(
          `- [ ] ${next()} [${story.id}] ${fr.id} round-trip: export → wipe local store → import → re-validate against ${matchingSc?.id ?? 'SC-005b'}`,
        );
        if (!matchingSc) {
          lines.push(
            `- [ ] ${next()} [POLISH] SC-005b — exported-then-reimported ${fr.id} bundle yields identical checksum within 60s p95`,
          );
        }
      }

      lines.push('');
      phaseNum += 1;
    }

    lines.push(`## Phase ${phaseNum}: Polish & Cross-Cutting Concerns`, '');
    lines.push(
      '**Independent Test**: every success criterion (SC-NNN) has a reproducible measurement harness and the audit/regenerate cycle is green.',
      '',
    );
    this.appendPolishPhase(plan, lines, next);

    lines.push('', '## Dependencies & Execution Order', '');
    lines.push('- Phase 1 (Setup) blocks every later phase.');
    lines.push('- Phase 2 (Foundational) blocks every User Story phase.');
    lines.push(
      `- User Story phases (${phaseNum - 3} of them) can run sequentially or in parallel once Phase 2 completes.`,
    );
    lines.push('');
    lines.push('## Parallel Example', '');
    lines.push('```text');
    lines.push('# Within a User Story phase:');
    lines.push('T101 [P] [US001] Build the Post aggregate');
    lines.push('T102 [P] [US001] Build the PostRepository');
    lines.push('T103     [US001] Wire the Post REST controller (depends on T101, T102)');
    lines.push('```');
    lines.push('');
    lines.push('## Implementation Strategy', '');
    lines.push('- MVP first: ship Phase 1 → Phase 2 → first P1 User Story. Validate before moving on.');
    lines.push('- Incremental delivery: each completed User Story phase is independently shippable.');
    lines.push('- Tests-first: write BDD scenarios in the `Tests for User Story` sub-phase before the implementation sub-phase.');
    lines.push('');
    lines.push('## Notes', '');
    lines.push('- `[P]` tasks can run in parallel only when their `fileHints` AND `userStoryIds` are disjoint from every other in-flight task.');
    lines.push('- `[USn]` markers cross-link the task to a User Story in `spec.md`.');
    lines.push(
      '- `(ghost)` / `(synth)` markers flag tasks synthesised by the renderer to close spec-kit coverage gaps; they are NOT persisted back to `plan.agentTasks` and disappear if the LLM produces real work on the next regeneration.',
    );

    return lines.join('\n');
  }

  /**
   * Returns the components that intersect this story's bounded contexts.
   * Used by the TDD spec emitter to keep test work scoped to what the
   * story actually touches (Article 1 / H6).
   */
  private componentsForStory(story: UserStory, plan: Plan): DomainComponent[] {
    const ids = new Set(story.boundedContextIds ?? []);
    if (ids.size === 0) {
      return plan.domains?.flatMap((d) => d.components ?? []) ?? [];
    }
    const out: DomainComponent[] = [];
    for (const d of plan.domains ?? []) {
      if (!ids.has(d.id) && !ids.has(d.layer)) continue;
      for (const c of d.components ?? []) out.push(c);
    }
    return out;
  }

  /**
   * Returns the description text used in the rendered `tasks.md` block for
   * an agent task. When the task description names a LangChain-style
   * retrieval step but the plan does not declare `agentFramework === 'langchain'`,
   * the text is rewritten to the deterministic-embedding fallback so the
   * emitted plan does not contradict itself.
   */
  private formatAgentTaskDescription(task: AgentTask, plan: Plan): string {
    const usesLangChain = plan.agentFramework === 'langchain';
    const text = task.description ?? '';
    if (usesLangChain) return text;
    if (!/LangChain|Lang\s?Chain/i.test(text)) return text;
    return text.replace(
      new RegExp(RETRIEVAL_DESCRIPTION_LANGCHAIN, 'gi'),
      RETRIEVAL_DESCRIPTION_FALLBACK,
    );
  }

  /**
   * Synthesises ghost-component tasks (controller, orchestrator, memory
   * service, repository) when the domain model implies their absence. Tasks
   * are emitted with stable synthetic ids and target the first matching layer
   * directory; they live in `tasks.md` only.
   */
  private ghostFoundationalTasks(plan: Plan): { id: string; title: string; fileHints: string[] }[] {
    const tasks: { id: string; title: string; fileHints: string[] }[] = [];
    const domainLayers = (plan.domains ?? []).filter((d) => d.layer !== 'frontend' && d.layer !== 'presentation');
    if (domainLayers.length === 0) return tasks;
    const allComponents = (plan.domains ?? []).flatMap((d) => d.components ?? []);
    const firstLayerDir = (plan.architectureLayers ?? [])
      .flatMap((l) => l.directoryStructure ?? [])
      .map((d) => d.path)[0];

    const hasController = allComponents.some((c) => c.type === 'controller');
    if (!hasController) {
      tasks.push({
        id: 'ghost-controller',
        title: 'Scaffold the application-layer controller (HTTP / WS boundary)',
        fileHints: firstLayerDir ? [`${firstLayerDir}/controllers/`] : ['controllers/'],
      });
    }
    const hasOrchestrator = allComponents.some(
      (c) => /orchestrat/i.test(c.name ?? '') || c.type === 'use-case',
    );
    if (!hasOrchestrator) {
      tasks.push({
        id: 'ghost-orchestrator',
        title:
          'Scaffold the use-case orchestrator that wires controller → domain → repository',
        fileHints: firstLayerDir ? [`${firstLayerDir}/use-cases/`] : ['use-cases/'],
      });
    }
    const haystack = `${plan.systemOverview?.purpose ?? ''} ${plan.meta?.summary ?? ''} ${plan.systemOverview?.context ?? ''}`;
    const hasMemoryService = /memory|conversation|history|long[- ]?term|recall/i.test(haystack);
    if (!hasMemoryService) {
      tasks.push({
        id: 'ghost-memory',
        title: 'Scaffold the conversation-memory service (recent window + long-term recall)',
        fileHints: firstLayerDir ? [`${firstLayerDir}/memory/`] : ['memory/'],
      });
    }
    const hasRepo = allComponents.some((c) => c.type === 'repository');
    if (!hasRepo) {
      tasks.push({
        id: 'ghost-repo',
        title: 'Scaffold the persistence repository (outbox + read model)',
        fileHints: firstLayerDir ? [`${firstLayerDir}/repositories/`] : ['repositories/'],
      });
    }
    return tasks;
  }

  /**
   * Synthesises a starter task per detected "feature cluster" inside a User
   * Story when the agent produced no real work for it. Each synthetic task
   * references the story id, any FR / SC ids parsed from the description,
   * and inherits file hints from the story's first layer directory.
   */
  private syntheticStoryTasks(
    story: UserStory,
    plan: Plan,
  ): {
    id: string;
    title: string;
    description: string;
    fileHints: string[];
    userStoryIds: string[];
    acceptanceCriteria: string[];
  }[] {
    const out: {
      id: string;
      title: string;
      description: string;
      fileHints: string[];
      userStoryIds: string[];
      acceptanceCriteria: string[];
    }[] = [];
    const firstLayerDir = (plan.architectureLayers ?? [])
      .flatMap((l) => l.directoryStructure ?? [])
      .map((d) => d.path)[0];
    const defaultHint = (suffix: string): string[] =>
      firstLayerDir ? [`${firstLayerDir}/${suffix}`] : [suffix];

    const text = `${story.title} ${story.description}`;
    const frMatches = Array.from(text.matchAll(/FR-\d{3,}/g)).map((m) => m[0]);
    const scMatches = Array.from(text.matchAll(/SC-\d{3,}/g)).map((m) => m[0]);
    const note = (refs: string[]): string =>
      refs.length > 0 ? ` (references ${refs.join(', ')})` : '';

    const clusters: { re: RegExp; id: string; title: string; hint: string[] }[] = [
      {
        re: /image[- ]?gen(eration)?|image[- ]?pipeline/i,
        id: 'image-gen',
        title: 'Wire the image-generation pipeline',
        hint: defaultHint('image-gen/'),
      },
      {
        re: /persona[- ]?edit/i,
        id: 'persona-edit',
        title: 'Implement the persona-editing surface',
        hint: defaultHint('persona-edit/'),
      },
      {
        re: /\bstt\b|speech[- ]?to[- ]?text|transcrib/i,
        id: 'stt',
        title: 'Integrate the speech-to-text (STT) pipeline',
        hint: defaultHint('stt/'),
      },
      {
        re: /\bvad\b|voice[- ]?activity/i,
        id: 'vad',
        title: 'Wire the voice-activity-detection (VAD) pipeline',
        hint: defaultHint('vad/'),
      },
      {
        re: /barge[- ]?in/i,
        id: 'barge-in',
        title: 'Implement barge-in handling (interrupt + resume)',
        hint: defaultHint('barge-in/'),
      },
      {
        re: /zod|schema[- ]?valid(ation)?/i,
        id: 'zod-pipeline',
        title: 'Add the Zod schema validation pipeline',
        hint: defaultHint('schemas/'),
      },
      {
        re: /measurement|harness|benchmark/i,
        id: 'measurement-harness',
        title: 'Build the SC measurement harness',
        hint: defaultHint('harness/'),
      },
    ];

    const contextIds = new Set(story.boundedContextIds ?? []);
    for (const cluster of clusters) {
      if (!cluster.re.test(text)) continue;
      if (contextIds.size > 0) {
        const matchesContext =
          [...contextIds].some((id) => id.includes(cluster.id) || cluster.id.includes(id)) ||
          [...contextIds].some((id) => cluster.re.test(id));
        if (!matchesContext) continue;
      }
      out.push({
        id: `synth-${story.id}-${cluster.id}`,
        title: cluster.title,
        description:
          `Synthetic starter task synthesised by the renderer to close spec-kit coverage for "${cluster.id}" cluster${note([...frMatches, ...scMatches])}.`.trim(),
        fileHints: cluster.hint,
        userStoryIds: [story.id],
        acceptanceCriteria: [
          `Implements ${cluster.id} cluster for ${story.id} per the acceptance scenarios in spec.md.`,
        ],
      });
    }
    return out;
  }

  /**
   * Emits the Polish phase owned sub-phases (Tests then Implementation)
   * including synthesised SC measurement-harness tasks.
   */
  private appendPolishPhase(
    plan: Plan,
    lines: string[],
    next: () => string,
  ): void {
    lines.push('### Tests for the polish phase', '');
    const measurement = this.synthesiseMeasurementTasks(plan);
    if (measurement.length === 0) {
      lines.push(
        '- [ ] ' +
          next() +
          ' Cross-layer integration tests pass (see per-layer `tddSpec.integrationTests`).',
      );
    } else {
      for (const m of measurement) {
        lines.push(`- [ ] ${next()} ${m.title} — ${m.scRef} measurement harness.`);
      }
    }
    lines.push('');
    lines.push('### Implementation for the polish phase', '');
    for (const m of measurement) {
      lines.push(`- [ ] ${next()} ${m.implementation}`);
    }
    lines.push(`- [ ] ${next()} Document the spec-kit compliance audit + changelog updates.`);
    lines.push('');
  }

  /**
   * Walks `plan.successCriteria` and emits one measurement-harness task per
   * criterion. Latency / time-budget / completion-rate SCs are always emitted
   * (even if a task description already references the SC id) because they
   * imply a concrete harness with timing code; boolean SCs are only emitted
   * when no agent task already references the SC id.
   */
  private synthesiseMeasurementTasks(
    plan: Plan,
  ): { scRef: string; title: string; implementation: string }[] {
    const out: { scRef: string; title: string; implementation: string }[] = [];
    const tasks = plan.agentTasks ?? [];
    for (const sc of plan.successCriteria ?? []) {
      const kind = sc.kind ?? 'boolean';
      const alwaysEmit = kind === 'latency' || kind === 'time-budget' || kind === 'completion-rate';
      const covered = tasks.some((t) => (t.description ?? '').includes(sc.id));
      if (!alwaysEmit && covered) continue;
      const budget =
        kind === 'latency' && sc.latencyTargetMs
          ? ` (budget: ${sc.latencyTargetMs}ms p95)`
          : kind === 'time-budget'
            ? ' (budget: see SC text)'
            : '';
      out.push({
        scRef: sc.id,
        title: `Build the ${sc.id} measurement harness${budget}`,
        implementation: `Implement the ${sc.id} criteria: ${sc.text}`,
      });
    }
    return out;
  }

  private buildChecklistMd(plan: Plan): string {
    let counter = 1;
    const next = (): string => `CHK${String(counter++).padStart(3, '0')}`;
    const lines: string[] = [
      `# ${plan.meta.title} — spec-kit Compliance Checklist`,
      '',
      '> Derived from `Plan` data. Every checkbox below is a yes/no gate that the planner re-evaluates whenever the plan is regenerated. Spec-kit calls this artefact `checklist.md` (the `/speckit.checklist` step).',
      '',
      '## Specification Clarity',
      '',
    ];

    const openQuestions = this.collectOpenQuestions(plan);
    if (openQuestions.length === 0) {
      lines.push(
        `- [x] ${next()} No \`NEEDS CLARIFICATION\` markers detected anywhere in the plan — the spec is unambiguous.`,
        '',
      );
    } else {
      lines.push(
        `- [ ] ${next()} ${openQuestions.length} \`NEEDS CLARIFICATION\` marker(s) detected outside the Open Questions in [\`spec.md\`](./spec.md). Resolve before implementation.`,
        '',
      );
    }

    lines.push('## Acceptance Criteria Quality', '');
    const agentTasks = plan.agentTasks ?? [];
    const tasksWithoutAC = agentTasks.filter((t) => !t.acceptanceCriteria || t.acceptanceCriteria.length === 0);
    if (agentTasks.length === 0) {
      lines.push(`- [ ] ${next()} No \`AgentTask\`s are defined yet — generate tasks via \`/speckit.tasks\`.`, '');
    } else if (tasksWithoutAC.length === 0) {
      lines.push(`- [x] ${next()} All ${agentTasks.length} agent task(s) carry a non-empty \`acceptanceCriteria[]\`.`, '');
    } else {
      lines.push(
        `- [ ] ${next()} ${tasksWithoutAC.length} agent task(s) missing \`acceptanceCriteria[]\`: ${tasksWithoutAC.map((t) => `\`${t.id}\``).join(', ')}.`,
        '',
      );
    }

    lines.push('## Test Coverage', '');
    const allComponents = (plan.domains ?? []).flatMap((d) => d.components ?? []);
    const componentsWithoutTdd = allComponents.filter((c) => !c.tddSpec);
    const tddScenarioCount = allComponents.reduce(
      (sum, c) => sum + (c.tddSpec ? c.tddSpec.unitTests.length + c.tddSpec.integrationTests.length : 0),
      0,
    );
    if (allComponents.length === 0) {
      lines.push(`- [ ] ${next()} No components are defined yet — regenerate to populate BDD Given/When/Then scenarios.`, '');
    } else if (componentsWithoutTdd.length === 0) {
      lines.push(
        `- [x] ${next()} All ${allComponents.length} component(s) ship a \`tddSpec\` (${tddScenarioCount} BDD scenario(s) total — every component has at least one Given/When/Then).`,
        '',
      );
    } else {
      lines.push(
        `- [ ] ${next()} ${componentsWithoutTdd.length} component(s) missing \`tddSpec\`: ${componentsWithoutTdd.map((c) => `\`${c.id}\``).join(', ')}.`,
        '',
      );
    }

    lines.push('## NFR Coverage', '');
    const layers = plan.architectureLayers ?? [];
    const layersWithoutGates = layers.filter((l) => !(l.constitutionCheck ?? []).length);
    if (layers.length === 0) {
      lines.push(`- [ ] ${next()} No architecture layers defined.`, '');
    } else if (layersWithoutGates.length === 0) {
      lines.push(`- [x] ${next()} All ${layers.length} architecture layer(s) ship a non-empty \`constitutionCheck[]\` (NFRs + quality bars).`, '');
    } else {
      lines.push(
        `- [ ] ${next()} ${layersWithoutGates.length} layer(s) missing \`constitutionCheck[]\`: ${layersWithoutGates.map((l) => `\`${l.id}\``).join(', ')}.`,
        '',
      );
    }

    lines.push('## Spec-Kit Compliance', '');
    const complianceIssues: string[] = [];
    for (const layer of layers) {
      const missing: string[] = [];
      if (!layer.summary) missing.push('summary');
      if (!layer.technicalContext) missing.push('technicalContext');
      const hasProjectStructure =
        !!layer.projectStructureTree || (layer.directoryStructure?.length ?? 0) > 0;
      if (!hasProjectStructure) missing.push('projectStructure');
      if (!layer.complexityTracking) missing.push('complexityTracking');
      const layerDomains = (plan.domains ?? []).filter((d) => d.layer === layer.id);
      if (layerDomains.length === 0) missing.push('domainAreas');
      if (missing.length > 0) {
        complianceIssues.push(`\`${layer.id}\` is missing: ${missing.join(', ')}.`);
      }
    }
    if (layers.length === 0) {
      lines.push(`- [ ] ${next()} No architecture layers defined.`, '');
    } else if (complianceIssues.length === 0) {
      lines.push(
        `- [x] ${next()} All ${layers.length} architecture layer(s) carry the spec-kit section set: \`summary\`, \`technicalContext\` (5 rows), \`projectStructure\`, \`complexityTracking\`, \`domainAreas\`.`,
        '',
      );
    } else {
      lines.push(`- [ ] ${next()} ${complianceIssues.length} layer(s) have gaps:`, '');
      for (const issue of complianceIssues) {
        lines.push(`  - ${issue}`);
      }
      lines.push('');
    }

    return lines.join('\n');
  }

  private taskLayerId(task: { fileHints: string[] }, plan: Plan): string {
    for (const layer of plan.architectureLayers) {
      if ((layer.directoryStructure ?? []).some((d) => task.fileHints.some((h) => h.startsWith(d.path)))) {
        return layer.id;
      }
    }
    return 'shared';
  }

  private canParallelize(
    task: { fileHints: string[] },
    hintSets: Set<string>[],
    selfIndex: number,
  ): boolean {
    const own = new Set(task.fileHints);
    for (let i = 0; i < hintSets.length; i += 1) {
      if (i === selfIndex) continue;
      const other = hintSets[i];
      for (const h of own) {
        if (other.has(h)) return false;
      }
    }
    return true;
  }

  private buildRootFiles(plan: Plan, prefix: string): MarkdownFile[] {
    return [
      { path: `${prefix}/ARCHITECTURE.md`, content: this.buildArchitectureMd(plan) },
      { path: `${prefix}/AGENTS.md`, content: this.buildRootAgentsMd(plan) },
    ];
  }

  private buildArchitectureMd(plan: Plan): string {
    const lines: string[] = [
      `# ${plan.meta.title} — Architecture`,
      '',
      `> ${plan.meta.summary}`,
      '',
      '## Architecture Approach',
      '',
      ...(plan.architectureLayers ?? []).flatMap((l) => [
        `### ${l.name}`,
        '',
        l.description,
        '',
        `**Patterns:** ${l.patterns.join(', ') || 'N/A'}`,
        `**Tech stack:** ${l.techStack.join(', ') || 'N/A'}`,
        '',
      ]),
      '## Document Index',
      '',
      '| Section | File |',
      '|---|---|',
      '| Feature Spec | [spec.md](spec.md) |',
      '| Implementation Plan | [plan.md](plan.md) |',
      '| Data Model | [data-model.md](data-model.md) |',
      '| Contracts | [contracts/](contracts/) |',
      '| Quickstart | [quickstart.md](quickstart.md) |',
      '| Tasks | [tasks.md](tasks.md) |',
      '| System Overview | [docs/00-system/overview.md](docs/00-system/overview.md) |',
      '| Bounded Context Map | [docs/00-system/bounded-context-map.md](docs/00-system/bounded-context-map.md) |',
      '| Architecture Overview | [docs/10-architecture/overview.md](docs/10-architecture/overview.md) |',
      ...(plan.architectureLayers ?? []).map(
        (l) =>
          `| ${l.name} Architecture | [docs/10-architecture/${l.id}-architecture.md](docs/10-architecture/${l.id}-architecture.md) |`,
      ),
      ...(plan.architectureLayers ?? []).map(
        (l) =>
          `| ${l.name} Contracts | [contracts/${l.id}.md](contracts/${l.id}.md) |`,
      ),
      '',
    ];

    return lines.join('\n');
  }

  private buildRootAgentsMd(plan: Plan): string {
    const lines: string[] = [
      `# ${plan.meta.title} — Agent Implementation Guide`,
      '',
      '> Start here. This file maps implementation order to files and feature directories.',
      '',
      '## Implementation Order',
      '',
      '| # | Task | Files |',
      '|---|---|---|',
      ...plan.agentTasks.map(
        (t, i) =>
          `| ${String(i + 1).padStart(2, '0')} | ${t.title} | ${t.fileHints.join(', ')} |`,
      ),
      '',
      '## Feature Directories',
      '',
      ...(plan.architectureLayers ?? []).flatMap((layer) =>
        layer.directoryStructure.map(
          (dir) =>
            `- [\`${dir.path}\`](${dir.path}/AGENTS.md) — ${dir.description}`,
        ),
      ),
      '',
      '## Detailed Task Files',
      '',
      ...plan.agentTasks.map(
        (t, i) =>
          `- [${t.title}](docs/60-agent-tasks/${String(i + 1).padStart(2, '0')}-${slugify(t.title)}.md)`,
      ),
      '',
    ];

    return lines.join('\n');
  }

  private buildSystemFiles(plan: Plan, prefix: string): MarkdownFile[] {
    return [
      {
        path: `${prefix}/docs/00-system/overview.md`,
        content: this.buildSystemOverviewMd(plan),
      },
      {
        path: `${prefix}/docs/00-system/bounded-context-map.md`,
        content: this.buildBoundedContextMapMd(plan),
      },
    ];
  }

  private buildSystemOverviewMd(plan: Plan): string {
    const s = plan.systemOverview;
    return [
      '# System Overview',
      '',
      `## Purpose\n${s.purpose}`,
      '',
      `## Context\n${s.context}`,
      '',
      '## Key Actors',
      ...((s.keyActors ?? []).length ? (s.keyActors ?? []).map((a) => `- ${a}`) : ['- N/A']),
      '',
      '## Constraints',
      ...((s.constraints ?? []).length ? (s.constraints ?? []).map((c) => `- ${c}`) : ['- None']),
      '',
      '## Non-Functional Requirements',
      ...((s.nfrs ?? []).length ? (s.nfrs ?? []).map((n) => `- ${n}`) : ['- None']),
      '',
    ].join('\n');
  }

  private buildBoundedContextMapMd(plan: Plan): string {
    const lines: string[] = [
      '# Bounded Context Map',
      '',
      '## Bounded Contexts',
      '',
    ];

    for (const bc of (plan.boundedContexts ?? [])) {
      lines.push(
        `### ${bc.name} (\`${bc.id}\`)`,
        '',
        `**Layer:** ${bc.layer}`,
        '',
        bc.description,
        '',
      );

      if (Object.keys(bc.ubiquitousLanguage).length > 0) {
        lines.push(
          '#### Ubiquitous Language',
          '',
          '| Term | Definition |',
          '|---|---|',
          ...Object.entries(bc.ubiquitousLanguage).map(
            ([term, def]) => `| **${term}** | ${def} |`,
          ),
          '',
        );
      }
    }

    return lines.join('\n');
  }

  private buildArchitectureFiles(plan: Plan, prefix: string): MarkdownFile[] {
    const files: MarkdownFile[] = [
      {
        path: `${prefix}/docs/10-architecture/overview.md`,
        content: this.buildArchOverviewMd(plan),
      },
    ];
    for (const layer of plan.architectureLayers ?? []) {
      files.push({
        path: `${prefix}/docs/10-architecture/${layer.id}-architecture.md`,
        content: this.buildLayerArchMd(plan, layer.id),
      });
    }
    return files;
  }

  private buildArchOverviewMd(plan: Plan): string {
    const lines: string[] = [
      '# Architecture Overview',
      '',
      '## Design Principles',
      '',
      '- **Domain-Driven Design (DDD):** Bounded contexts align code ownership with business domains.',
      '- **Clean Architecture:** Dependencies point inward; domain layer has zero external dependencies.',
      '- **Test-Driven Development (TDD):** Each component ships with BDD-style Given/When/Then specifications.',
      '',
      '## Layers',
      '',
      '| Layer | Responsibility | Pattern |',
      '|---|---|---|',
      ...(plan.architectureLayers ?? []).map(
        (l) => `| ${l.name} | ${l.description} | ${l.patterns.join(', ') || 'N/A'} |`,
      ),
      '',
      '## ADR Index',
      '',
      ...plan.adrs.map(
        (adr, i) =>
          `- [${adr.id} — ${adr.title}](../20-decisions/adr-${String(i + 1).padStart(3, '0')}-${slugify(adr.title)}.md) *(${adr.status})*`,
      ),
      '',
    ];

    return lines.join('\n');
  }

  private buildLayerArchMd(plan: Plan, layerId: string): string {
    const layer = (plan.architectureLayers ?? []).find((l) => l.id === layerId);
    const title = layer?.name ?? this.titleCase(layerId);
    const layerIndex = (plan.architectureLayers ?? []).findIndex((l) => l.id === layerId);
    const prefix = this.layerPrefix(layerIndex);
    const docBase = `${prefix}-${layerId}`;

    const isInteractiveLayer =
      layerId === 'frontend' || layer?.name?.toLowerCase().includes('frontend');
    const domains = plan.domains.filter((d) =>
      isInteractiveLayer ? d.layer === layerId : d.layer === layerId,
    );





    if (!isInteractiveLayer) {
      for (const d of plan.domains) {
        if (domains.includes(d)) continue;
        const matches = (plan.architectureLayers ?? []).some((l) => l.id === d.layer);
        if (!matches) domains.push(d);
      }
    }

    const lines: string[] = [
      `# ${title} Architecture`,
      '',
      `**Layer ID**: \`${layerId}\` · **Spec**: docs/10-architecture/${layerId}-architecture.md · **Generated**: ${plan.meta.generatedAt}`,
      '',
    ];

    lines.push('## Summary', '');
    lines.push(layer?.summary ?? layer?.description ?? '_No summary provided._', '');

    if (layer?.technicalContext) {
      const tc = layer.technicalContext;
      lines.push('## Technical Context', '');
      lines.push('| Field | Value |', '|---|---|');
      lines.push(`| **Storage** | ${tc.storage} |`);
      lines.push(`| **Target Platform** | ${tc.targetPlatform} |`);
      lines.push(`| **Performance Goals** | ${tc.performanceGoals} |`);
      lines.push(`| **Constraints** | ${tc.constraints} |`);
      lines.push(`| **Scale / Scope** | ${tc.scaleScope} |`);
      lines.push('');
    } else {

      lines.push('## Technical Context', '');
      if (layer) {
        lines.push(
          '| Field | Value |',
          '|---|---|',
          `| **Tech stack** | ${(layer.techStack ?? []).join(', ') || 'N/A'} |`,
          `| **Patterns** | ${(layer.patterns ?? []).join(', ') || 'N/A'} |`,
          '',
        );
      }
    }

    if (layer?.constitutionCheck && layer.constitutionCheck.length > 0) {
      lines.push('## Constitution Check', '');
      for (const gate of layer.constitutionCheck) {
        lines.push(`- ✅ ${gate}`);
      }
      lines.push('');
    }

    lines.push('## Project Structure', '');
    lines.push('### Documentation (this layer)', '');
    lines.push('```text');
    lines.push(`docs/${docBase}/`);
    for (const d of domains) {
      lines.push(`docs/${docBase}/${d.id}/`);
      const variant = this.domainTemplateVariant(d);
      for (const file of this.domainFileNames(variant)) {
        lines.push(`docs/${docBase}/${d.id}/${file}`);
      }
    }
    lines.push('```');
    lines.push('');
    if (layer?.projectStructureTree) {
      lines.push('### Source Code', '');
      lines.push('```text');
      lines.push(layer.projectStructureTree.trim());
      lines.push('```');
      lines.push('');
    } else if (layer && layer.directoryStructure.length > 0) {

      lines.push('### Source Code', '');
      lines.push('```text');
      for (const dir of layer.directoryStructure) {
        lines.push(`${dir.path}/`);
      }
      lines.push('```');
      lines.push('');
    }

    lines.push('## Complexity Tracking', '');
    const tracking = layer?.complexityTracking ?? [];
    if (tracking.length === 0) {
      lines.push('> No constitution violations; standard complexity.', '');
    } else {
      lines.push('| Violation | Why Needed | Simpler Alternative Rejected Because |');
      lines.push('|---|---|---|');
      for (const row of tracking) {
        lines.push(
          `| ${row.violation} | ${row.whyNeeded} | ${row.simplerAlternativeRejected} |`,
        );
      }
      lines.push('');
    }

    if (domains.length > 0) {
      lines.push(
        '## Domain Areas',
        '',
        '| Domain | Layer | Description |',
        '|---|---|---|',
        ...domains.map(
          (d) =>
            `| [${d.name}](../${docBase}/${d.id}/overview.md) | ${d.layer} | ${d.description} |`,
        ),
        '',
      );
    }

    return lines.join('\n');
  }

  private buildAdrFiles(plan: Plan, prefix: string): MarkdownFile[] {
    const existing = plan.adrs.map((adr, i) => ({
      path: `${prefix}/docs/20-decisions/adr-${String(i + 1).padStart(3, '0')}-${slugify(adr.title)}.md`,
      content: this.buildAdrMd(adr),
    }));
    if (plan.agentFramework) {
      const framework = plan.agentFramework;
      const rejected = framework === 'langgraph' ? ['langchain', 'none'] : ['langgraph'];
      existing.unshift({
        path: `${prefix}/docs/20-decisions/ADR-0001-agent-framework.md`,
        content: [
          '# ADR-0001 — Agent Framework',
          '',
          '**Status:** `accepted`',
          '',
          '## Context',
          '',
          `The plan needs a single, explicit decision about the agent framework so downstream tasks (\`tasks.md\`) can refer to it unambiguously.`,
          '',
          '## Decision',
          '',
          `Chosen framework: **${framework}**. ${framework === 'none' ? 'The plan relies on deterministic retrieval via the chosen embedding model (FR-010) rather than an agent runtime.' : 'The chosen framework powers the agentic pipeline end-to-end.'}`,
          '',
          '## Consequences',
          '',
          `- \`tasks.md\` retrieval tasks cite the framework explicitly (no LangChain drift).`,
          `- ${rejected.map((r) => `\`${r}\` rejected${r === 'none' ? ' — keeps the runtime surface small' : ' — kept available as a fallback if FR-010 changes'}`).join('\n- ')}`,
          '',
        ].join('\n'),
      });
    }
    return existing;
  }

  private buildAdrMd(adr: Adr): string {
    return [
      `# ${adr.id} — ${adr.title}`,
      '',
      `**Status:** \`${adr.status}\``,
      '',
      '## Context',
      '',
      adr.context,
      '',
      '## Decision',
      '',
      adr.decision,
      '',
      '## Consequences',
      '',
      ...adr.consequences.map((c) => `- ${c}`),
      '',
    ].join('\n');
  }

  private buildDomainFiles(plan: Plan, prefix: string): MarkdownFile[] {
    return plan.domains.flatMap((domain) => this.buildDomainFilesForDomain(plan, domain, prefix));
  }

  private domainTemplateVariant(domain: Domain): 'interactive' | 'compute' | 'infra' {
    const componentLayers = new Set((domain.components ?? []).map((c) => c.layer));
    if (componentLayers.has('presentation')) return 'interactive';
    if (componentLayers.has('infrastructure') && componentLayers.size === 1) return 'infra';
    if (domain.layer === 'frontend') return 'interactive';
    if (componentLayers.has('domain') || componentLayers.has('application')) return 'compute';
    return 'compute';
  }

  private domainFileNames(variant: 'interactive' | 'compute' | 'infra'): string[] {
    if (variant === 'interactive') {
      return ['overview.md', 'components.md', 'services.md', 'state.md'];
    }
    if (variant === 'infra') {
      return ['overview.md', 'adapters.md', 'configuration.md'];
    }
    return [
      'overview.md',
      'domain/aggregates.md',
      'domain/domain-services.md',
      'application/use-cases.md',
      'infrastructure/repositories.md',
    ];
  }

  private buildDomainFilesForDomain(plan: Plan, domain: Domain, featurePrefix: string): MarkdownFile[] {
    const layerIndex = this.findLayerIndexForDomain(plan, domain);
    const docPrefix = this.layerPrefix(layerIndex);
    const layerId = plan.architectureLayers[layerIndex]?.id ?? domain.layer;
    const base = `${featurePrefix}/docs/${docPrefix}-${layerId}/${domain.id}`;
    const variant = this.domainTemplateVariant(domain);

    const files: MarkdownFile[] = [
      { path: `${base}/overview.md`, content: this.buildDomainOverviewMd(domain) },
    ];

    if (variant === 'interactive') {
      files.push(
        { path: `${base}/components.md`, content: this.buildFrontendComponentsMd(domain) },
        { path: `${base}/services.md`, content: this.buildFrontendServicesMd(domain) },
        { path: `${base}/state.md`, content: this.buildFrontendStateMd(domain) },
      );
    } else if (variant === 'infra') {
      files.push(
        { path: `${base}/adapters.md`, content: this.buildInfraAdaptersMd(domain) },
        { path: `${base}/configuration.md`, content: this.buildInfraConfigurationMd(domain) },
      );
    } else {
      files.push(
        { path: `${base}/domain/aggregates.md`, content: this.buildAggregatesMd(domain) },
        { path: `${base}/domain/domain-services.md`, content: this.buildDomainServicesMd(domain) },
        { path: `${base}/application/use-cases.md`, content: this.buildUseCasesMd(domain) },
        { path: `${base}/infrastructure/repositories.md`, content: this.buildRepositoriesMd(domain) },
      );
    }

    return files;
  }

  private findLayerIndexForDomain(plan: Plan, domain: Domain): number {
    const layers = plan.architectureLayers ?? [];
    const exact = layers.findIndex((l) => l.id === domain.layer);
    if (exact >= 0) return exact;





    const byBoundedContext = layers.findIndex((l) => {
      const matchedDomain = plan.domains.find((d) => d.id === domain.id);
      if (!matchedDomain) return false;
      return l.id === matchedDomain.layer;
    });
    if (byBoundedContext >= 0) return byBoundedContext;
    return 0;
  }

  private layerPrefix(layerIndex: number): string {
    return String((layerIndex + 1) * 10 + 20);
  }

  private titleCase(id: string): string {
    return id
      .split('-')
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');
  }

  private buildDomainOverviewMd(domain: Domain): string {
    return [
      `# ${domain.name}`,
      '',
      domain.description,
      '',
      `**Layer:** \`${domain.layer}\``,
      domain.directoryPath ? `**Directory:** \`${domain.directoryPath}\`` : '',
      '',
      '## Responsibilities',
      '',
      ...domain.responsibilities.map((r) => `- ${r}`),
      '',
    ]
      .filter((l) => l !== undefined)
      .join('\n');
  }

  private buildAggregatesMd(domain: Domain): string {
    const lines: string[] = [
      `# ${domain.name} — Aggregates & Domain Events`,
      '',
    ];

    if ((domain.aggregates ?? []).length === 0) {
      lines.push('*No aggregates defined.*', '');
    } else {
      for (const agg of (domain.aggregates ?? [])) {
        lines.push(
          `## ${agg.name}`,
          '',
          agg.description,
          '',
          `**Root Entity:** \`${agg.rootEntity}\``,
          '',
          '### Invariants',
          ...agg.invariants.map((inv) => `- ${inv}`),
          '',
          '### Value Objects',
          ...agg.valueObjects.map((vo) => `- \`${vo}\``),
          '',
          '### Commands',
          ...agg.commands.map((cmd) => `- \`${cmd}\``),
          '',
          '### Domain Events Emitted',
          ...agg.domainEvents.map((ev) => `- \`${ev}\``),
          '',
        );
      }
    }

    if ((domain.domainEvents ?? []).length > 0) {
      lines.push('## Domain Events Catalog', '');
      for (const ev of (domain.domainEvents ?? [])) {
        lines.push(
          `### ${ev.name}`,
          '',
          ev.description,
          '',
          `**Triggered by:** ${ev.triggeredBy}`,
          `**Handled by:** ${ev.handledBy.join(', ') || 'N/A'}`,
          '',
          '**Payload:**',
          ...ev.payload.map((p) => `- \`${p}\``),
          '',
        );
      }
    }

    return lines.join('\n');
  }

  private buildDomainServicesMd(domain: Domain): string {
    const services = domain.components.filter(
      (c) => c.layer === 'domain' && c.type !== 'aggregate',
    );

    const lines: string[] = [`# ${domain.name} — Domain Services`, ''];

    if (services.length === 0) {
      lines.push('*No domain-layer services defined.*', '');
    } else {
      for (const svc of services) {
        lines.push(...this.buildComponentSection(svc));
      }
    }

    return lines.join('\n');
  }

  private buildUseCasesMd(domain: Domain): string {
    const useCases = domain.components.filter((c) => c.layer === 'application');

    const lines: string[] = [`# ${domain.name} — Application Use Cases`, ''];

    if (useCases.length === 0) {
      lines.push('*No application-layer use cases defined.*', '');
    } else {
      for (const uc of useCases) {
        lines.push(...this.buildComponentSection(uc));
      }
    }

    return lines.join('\n');
  }

  private buildRepositoriesMd(domain: Domain): string {
    const repos = domain.components.filter((c) => c.layer === 'infrastructure');

    const lines: string[] = [`# ${domain.name} — Infrastructure`, ''];

    if (repos.length === 0) {
      lines.push('*No infrastructure-layer components defined.*', '');
    } else {
      for (const repo of repos) {
        lines.push(...this.buildComponentSection(repo));
      }
    }

    return lines.join('\n');
  }

  private buildInfraAdaptersMd(domain: Domain): string {
    const adapters = domain.components.filter(
      (c) => c.type === 'repository' || c.type === 'controller' || c.layer === 'infrastructure',
    );

    const lines: string[] = [`# ${domain.name} — Adapters`, ''];

    if (adapters.length === 0) {
      lines.push('*No adapters defined.*', '');
    } else {
      for (const adapter of adapters) {
        lines.push(...this.buildComponentSection(adapter));
      }
    }

    return lines.join('\n');
  }

  private buildInfraConfigurationMd(domain: Domain): string {
    const lines: string[] = [
      `# ${domain.name} — Configuration`,
      '',
      '> Operational settings, environment variables, and deployment hooks for this domain.',
      '',
      '## Configuration Surface',
      '',
      ...domain.responsibilities.map((r) => `- ${r}`),
      '',
    ];

    return lines.join('\n');
  }

  private buildFrontendComponentsMd(domain: Domain): string {
    const components = domain.components.filter(
      (c) => c.type === 'ui-component' || c.layer === 'presentation',
    );

    const lines: string[] = [`# ${domain.name} — UI Components`, ''];

    if (components.length === 0) {
      lines.push('*No UI components defined.*', '');
    } else {
      for (const c of components) {
        lines.push(...this.buildComponentSection(c));
      }
    }

    return lines.join('\n');
  }

  private buildFrontendServicesMd(domain: Domain): string {
    const services = domain.components.filter(
      (c) => (c.type === 'service' || c.layer === 'application') && c.type !== 'store',
    );

    const lines: string[] = [`# ${domain.name} — Services`, ''];

    if (services.length === 0) {
      lines.push('*No services defined.*', '');
    } else {
      for (const svc of services) {
        lines.push(...this.buildComponentSection(svc));
      }
    }

    return lines.join('\n');
  }

  private buildFrontendStateMd(domain: Domain): string {
    const stores = domain.components.filter((c) => c.type === 'store');

    const lines: string[] = [`# ${domain.name} — State Management`, ''];

    if (stores.length === 0) {
      lines.push('*No state stores defined.*', '');
    } else {
      for (const store of stores) {
        lines.push(...this.buildComponentSection(store));
      }
    }

    return lines.join('\n');
  }

  private buildComponentSection(c: DomainComponent): string[] {
    const lines: string[] = [
      `## ${c.name}`,
      '',
      `**Type:** \`${c.type}\`` +
        (c.layer ? ` · **Layer:** \`${c.layer}\`` : '') +
        (c.targetFile ? ` · **File:** \`${c.targetFile}\`` : ''),
      '',
      '### Purpose',
      '',
      c.description,
      '',
    ];

    if (c.responsibilities.length) {
      lines.push(
        '### Responsibilities',
        '',
        ...c.responsibilities.map((r) => `- ${r}`),
        '',
      );
    }

    if ((c.publicApi ?? []).length) {
      lines.push(
        '### Public API',
        '',
        ...(c.publicApi ?? []).map((m) => `- \`${m}\``),
        '',
      );
    }

    if (c.inputs.length) {
      lines.push('### Inputs', '', ...c.inputs.map((i) => `- ${i}`), '');
    }

    if (c.outputs.length) {
      lines.push('### Outputs', '', ...c.outputs.map((o) => `- ${o}`), '');
    }

    if (c.dependencies.length) {
      lines.push(
        '### Dependencies',
        '',
        ...c.dependencies.map((d) => `- ${d}`),
        '',
      );
    }

    if (c.errorHandling) {
      lines.push('### Error Handling', '', c.errorHandling, '');
    }

    if ((c.acceptanceCriteria ?? []).length) {
      lines.push(
        '### Acceptance Criteria',
        '',
        ...(c.acceptanceCriteria ?? []).map((ac) => `- [ ] ${ac}`),
        '',
      );
    }

    if ((c.outOfScope ?? []).length) {
      lines.push(
        '### Out of Scope',
        '',
        ...(c.outOfScope ?? []).map((o) => `- ${o}`),
        '',
      );
    }

    if (c.tddSpec) {
      lines.push(...this.buildTDDSection(c.tddSpec));
    }

    lines.push('---', '');

    return lines;
  }

  private buildTDDSection(spec: TDDSpec): string[] {
    const lines: string[] = ['### Test Specifications', ''];

    if (spec.unitTests.length > 0) {
      lines.push('#### Unit Tests', '');
      for (const t of spec.unitTests) {
        lines.push(...this.buildTestCase(t));
      }
    }

    if (spec.integrationTests.length > 0) {
      lines.push('#### Integration Tests', '');
      for (const t of spec.integrationTests) {
        lines.push(...this.buildTestCase(t));
      }
    }

    return lines;
  }

  private buildTestCase(t: TestCase): string[] {
    return [
      `**Test: ${t.description}**`,
      '',
      ...t.given.map((g) => `- Given: ${g}`),
      `- When: ${t.when}`,
      ...t.then.map((th) => `- Then: ${th}`),
      '',
    ];
  }

  private buildWorkflowFiles(plan: Plan, prefix: string): MarkdownFile[] {
    return plan.workflows.map((w) => ({
      path: `${prefix}/docs/50-workflows/${w.id}.md`,
      content: this.buildWorkflowMd(w),
    }));
  }

  private buildWorkflowMd(w: Workflow): string {







    const steps = Array.isArray(w.steps) ? w.steps : [];
    const domainIds = Array.isArray(w.domainIds) ? w.domainIds : [];
    return [
      `# ${w.name}`,
      '',
      w.description,
      '',
      '## Steps',
      '',
      ...steps.map((step, i) => `${i + 1}. ${step}`),
      '',
      '## Domains Involved',
      '',
      ...domainIds.map((id) => `- \`${id}\``),
      '',
    ].join('\n');
  }

  private buildAgentTaskFiles(plan: Plan, prefix: string): MarkdownFile[] {
    const taskFiles: MarkdownFile[] = plan.agentTasks.map((task, i) => ({
      path: `${prefix}/docs/60-agent-tasks/${String(i + 1).padStart(2, '0')}-${slugify(task.title)}.md`,
      content: [
        `# Task ${String(i + 1).padStart(2, '0')}: ${task.title}`,
        '',
        task.description,
        '',
        ...(task.userStoryIds.length > 0
          ? [
              '**User Stories:**',
              '',
              ...task.userStoryIds.map((id) => `- \`${id}\``),
              '',
            ]
          : []),
        '## Acceptance Criteria',
        '',
        ...task.acceptanceCriteria.map((ac) => `- [ ] ${ac}`),
        '',
        '## Target Files',
        '',
        ...task.fileHints.map((f) => `- \`${f}\``),
        '',
      ].join('\n'),
    }));

    const indexFile: MarkdownFile = {
      path: `${prefix}/docs/60-agent-tasks/00-implementation-order.md`,
      content: [
        '# Implementation Order',
        '',
        '| # | Task | Files |',
        '|---|---|---|',
        ...plan.agentTasks.map(
          (t, i) =>
            `| [${String(i + 1).padStart(2, '0')}](${String(i + 1).padStart(2, '0')}-${slugify(t.title)}.md) | ${t.title} | ${t.fileHints.join(', ')} |`,
        ),
        '',
      ].join('\n'),
    };

    return [indexFile, ...taskFiles];
  }

  private buildConstitutionMd(plan: Plan): string {
    const c = plan.constitution;
    const lines: string[] = [];
    if (c) {
      lines.push(
        `# ${c.projectName} Project Constitution`,
        '',
        '> The principles that govern how this project is built. Every per-layer Constitution Check in `plan.md` MUST be traceable back to one of the articles below. Amendments append a changelog entry to **Last Amended** rather than rewriting articles in place.',
        '',
        '| Field | Value |',
        '|---|---|',
        `| **Version** | \`${c.version}\` |`,
        `| **Ratified** | ${c.ratifiedAt} |`,
        `| **Last Amended** | ${c.lastAmendedAt} |`,
        '',
      );
    } else {
      lines.push(
        `# Project Constitution`,
        '',
        '> ⚠️ PENDING — no constitution is attached to this plan yet. Regenerate the plan to populate the 9-article project constitution.',
        '',
      );
    }

    if (c) {
      const articlesByNumber = new Map<number, ConstitutionArticle>();
      for (const article of c.articles) {
        articlesByNumber.set(article.articleNumber, article);
      }
      for (let n = 1; n <= 9; n += 1) {
        const article = articlesByNumber.get(n);
        if (!article) {
          lines.push(`## Article ${n} — (missing)`, '');
          lines.push('> ⚠️ PENDING — regenerate the plan to populate Article ' + n + '.', '');
          continue;
        }
        lines.push(...this.renderConstitutionArticle(article, plan));
      }

      lines.push('## Governance', '');
      lines.push(
        '- This constitution is amended, not rewritten. When an article changes, append a changelog row to the **Changelog** table and bump the **Version** field.',
        '- The 9-article structure mirrors GitHub spec-kit\'s `constitution-template.md`. Adding or removing articles requires a major version bump.',
        '- Per-layer Constitution Checks in `plan.md` MUST be traceable to one of the 9 articles above.',
        '',
      );
      lines.push('## Changelog', '');
      lines.push('| Version | Date | Change | Author |');
      lines.push('|---|---|---|---|');
      lines.push(`| \`${c.version}\` | ${c.lastAmendedAt} | Initial ratification (9 articles generated from autoArchitect stack + plan NFRs). | autoArchitect planner |`);
      lines.push('');
    }

    return lines.join('\n');
  }

  /**
   * Renders a single constitution article, applying the empty-content
   * fallback rules: Article 2 (CLI Interface) may be intentionally dropped —
   * we emit a single sentence explaining the drop; every other article with
   * empty content is marked as pending so spec-kit's gate picks it up.
   */
  private renderConstitutionArticle(article: ConstitutionArticle, plan: Plan): string[] {
    const lines: string[] = [`## Article ${article.articleNumber} — ${article.title}`, ''];
    const raw = article.content ?? '';
    const content = this.stripConstitutionPlaceholder(raw);
    if (content.length === 0) {
      if (article.articleNumber === 2) {
        lines.push(
          '_Dropped in this project — no CLI surface is planned. See [plan.md](../plan.md) for the runtime surface._',
          '',
        );
      } else {
        lines.push(
          '⚠️ PENDING — regenerate the plan to populate this article with at least two sentences of non-trivial content (autoArchitect stack, NFR, and bounded-context evidence).',
          '',
        );
      }
      return lines;
    }
    const enriched = this.enforceArticle3Content(article, content, plan);
    lines.push(enriched, '');
    return lines;
  }

  private stripConstitutionPlaceholder(content: string): string {
    const trimmed = content.trim();
    const placeholderPattern = /^>?\s*_?Regenerate the plan to populate[^.]*\.?_?$/i;
    if (placeholderPattern.test(trimmed)) return '';
    return trimmed;
  }

  /**
   * Article 3 (Test-First) MUST describe an enforcement mechanism. If the
   * LLM supplied only a one-liner without naming the tooling, we append a
   * synthesised enforcement sentence so spec-kit recognises the gate.
   */
  private enforceArticle3Content(article: ConstitutionArticle, content: string, _plan: Plan): string {
    if (article.articleNumber !== 3) return content;
    const mentionsMechanism = /tests-first|test-first|tdd|vitest|jasmine|bdd|ci\s?gate|coverage/i.test(
      content,
    );
    if (mentionsMechanism) return content;
    const trail =
      ' Tests are written first inside every User Story phase; Vitest / Jasmine cover every component, BDD Given/When/Then cover every acceptance scenario, and a CI gate blocks merges when coverage falls below the per-component floor.';
    return `${content.replace(/[\s.]+$/, '')}${trail}`;
  }

  private buildDirectoryAgentsFiles(plan: Plan): MarkdownFile[] {
    const files: MarkdownFile[] = [];

    for (const layer of (plan.architectureLayers ?? [])) {
      for (const dir of (layer.directoryStructure ?? [])) {
        files.push({
          path: `${stripExportPrefix(dir.path)}/AGENTS.md`,
          content: this.buildDirectoryAgentsMd(dir, layer.name, plan),
        });
      }
    }

    return files;
  }

  private buildDirectoryAgentsMd(
    dir: DirectoryEntry,
    layerName: string,
    plan: Plan,
  ): string {
    const relatedComponents = plan.domains
      .flatMap((d) => d.components)
      .filter((c) => c.targetFile?.startsWith(dir.path));

    const lines: string[] = [
      `# \`${dir.path}\``,
      '',
      `> **Layer:** ${layerName}`,
      '',
      dir.description,
      '',
      '## Agent Instructions',
      '',
      ...dir.agentInstructions.map((inst) => `- [ ] ${inst}`),
      '',
    ];

    if (relatedComponents.length > 0) {
      lines.push(
        '## Files to Create',
        '',
        '| File | Type | Description |',
        '|---|---|---|',
        ...relatedComponents.map(
          (c) =>
            `| \`${c.targetFile ?? '(see component spec)'}\` | \`${c.type}\` | ${c.description} |`,
        ),
        '',
        '## Component Specifications',
        '',
      );
      for (const c of relatedComponents) {
        lines.push(
          `### ${c.name}`,
          '',
          `See full spec in [domain docs](../../docs).`,
          '',
          '**Acceptance Criteria:**',
          ...(c.acceptanceCriteria ?? []).map((ac) => `- [ ] ${ac}`),
          '',
        );
      }
    }

    return lines.join('\n');
  }
}

/**
 * Drops the export-bundle's own top-level `specs/` prefix from a
 * `directoryStructure[].path` before the renderer emits it as a per-directory
 * `AGENTS.md` file. The LLM sometimes mirrors the `specs/<NNN-slug>/` prefix
 * into the source-tree paths it produces, which would otherwise double the
 * prefix in the exported zip (`specs/specs/001-xface/...`). Stripping it here
 * keeps the per-directory AGENTS.md flat at the zip root regardless of what
 * the LLM emitted.
 */
function stripExportPrefix(path: string): string {
  let p = path;
  while (/^specs\//.test(p)) {
    p = p.replace(/^specs\//, '');
  }
  return p;
}
