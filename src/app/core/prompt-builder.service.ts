import { Injectable, inject } from '@angular/core';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import { z } from 'zod';
import { ContextAttachment } from './context-attachment.model';
import {
  BoundedContextChunkSchema,
  DomainChunkSchema,
  LayerChunkSchema,
  Plan,
  ScaffoldSchema,
  TailSchema,
} from './plan.schema';
import { AgentsStore, ResolvedSkill } from './agents.store';
import { AuditFinding } from './audit-runner.service';
import { UserEditSummary } from './diff/user-edit-summary';
import type { RefinementAnswer } from './refinement/refinement.schema';

export interface GeneratePromptInput {
  title: string;
  idea: string;
  technicalConstraints: string;
  nfrs: string;
  hints: string;
  contextAttachments?: ContextAttachment[];
}

export type ComplexityTier = 'low' | 'medium' | 'high';

export interface ComplexityCaps {
  tier: ComplexityTier;
  maxLayers: number;
  maxDomains: number;
}

const SYSTEM_PROMPT = `You are a principal software architect. Your task is to produce a complete, detailed architecture plan as a single valid JSON object — no markdown fences, no prose outside the JSON.

The plan MUST conform exactly to the JSON schema provided. Follow every instruction below without exception.

━━━ INPUT INTERPRETATION ━━━

- Treat the application idea, optional detail fields, and context files as unstructured source material. They may contain prose, lists, fragments, mixed topics, or information that does not match the field label.
- Extract and reconcile every explicit product requirement, technical constraint, quality attribute, integration, and technology preference found anywhere in the user input.
- Explicit user requirements take precedence over inferred choices. Infer only decisions that do not conflict with supplied information.
- When optional input is blank or incomplete, infer sensible constraints, measurable non-functional requirements, architecture patterns, and a specific technology stack from the application idea. The resulting plan must still be complete.
- Do not copy vague notes blindly. Convert them into concrete, internally consistent architecture decisions and call out important assumptions in the generated plan.

━━━ DDD INSTRUCTIONS ━━━

1. BOUNDED CONTEXTS
   - Identify 2–6 bounded contexts from the idea.
   - Assign each a "layer": "frontend", "backend", or "shared".
   - For each bounded context, define a "ubiquitousLanguage" map of domain terms → plain-English definitions.
   - Populate the root "boundedContexts" array.
   - Generate a "boundedContextMap" Mermaid diagram in systemOverview showing how contexts relate (use relationships like "uses", "conforms to", "anti-corruption layer").

2. DOMAINS (DDD tactical patterns — backend/shared only)
   - For each backend or shared domain, identify aggregate roots:
     * rootEntity: the main entity that enforces invariants
     * invariants: business rules that must always hold (e.g. "OrderTotal must be > 0")
     * valueObjects: immutable descriptors (e.g. "Money", "Address")
     * commands: intent actions (e.g. "PlaceOrder", "CancelOrder")
     * domainEvents: past-tense outcomes (e.g. "OrderPlaced", "OrderCancelled")
   - Populate "aggregates" and "domainEvents" arrays on each backend/shared domain.
   - Set "directoryPath" to the repo-relative path where this domain's code lives.

3. CLEAN ARCHITECTURE LAYERS (backend/shared components)
   - Classify every component by "layer":
     * "domain": aggregates, domain services, value objects, domain events — no framework dependencies
     * "application": use-cases, command/query handlers, ports/interfaces — orchestrates domain
     * "infrastructure": repositories (DB), external adapters, HTTP clients, messaging
   - Set "type" appropriately: "aggregate", "domain-service", "use-case", "repository", "controller", "utility"

4. FRONTEND LAYERS
   - Frontend components get "layer": "presentation"
   - Frontend services and stores get "layer": "application"
   - Set "type" to "ui-component", "service", or "store"

━━━ TDD INSTRUCTIONS ━━━

5. TEST SPECIFICATIONS (every component MUST have tddSpec)
   - Provide at least 2 unitTests and 1 integrationTest per component.
   - Each test case: { "description", "given": [...], "when": "...", "then": [...] }
   - "given" = preconditions as plain sentences
   - "when"  = the single action being tested
   - "then"  = verifiable outcomes (one assertion per item)

   Example tddSpec:
   {
     "unitTests": [
       {
         "description": "calculates order total correctly",
         "given": ["an Order with two items costing 10 and 20"],
         "when": "calculateTotal() is called",
         "then": ["total equals 30", "currency is preserved"]
       }
     ],
     "integrationTests": [
       {
         "description": "persists order and publishes domain event",
         "given": ["a valid PlaceOrder command", "an empty order repository"],
         "when": "PlaceOrderHandler.execute() is called",
         "then": ["order is saved to repository", "OrderPlaced event is published to event bus"]
       }
     ]
   }

━━━ COMPONENT FIELDS ━━━

6. For every component populate:
   - "publicApi": list of method signatures with types (e.g. "login(email: string, password: string): Promise<User>")
   - "acceptanceCriteria": verifiable, testable statements (checkbox style)
   - "errorHandling": how errors are surfaced (e.g. "throws DomainError on invariant violation")
   - "outOfScope": explicit list of what this unit does NOT do
   - "targetFile": repo-relative path (e.g. "src/features/auth/auth.service.ts")
   - "inputs" and "outputs": typed descriptions

━━━ ARCHITECTURE LAYERS ━━━

7. Populate "architectureLayers" with one entry per logical layer (frontend, backend, etc.):
   - "techStack": infer from technology hints; be specific (e.g. ["NestJS 10", "TypeORM 0.3", "PostgreSQL 15"])
   - "patterns": design patterns applied (e.g. ["Clean Architecture", "CQRS", "Event Sourcing"])
   - "mermaidDiagram": a layer-level Mermaid diagram showing internal structure
   - "directoryStructure": one entry per directory in that layer:
     * "path": repo-relative POSIX path (e.g. "src/features/auth")
     * "description": one sentence purpose
     * "agentInstructions": 3–6 actionable implementation steps for a coding agent (imperative, specific)
       Example: "Create AuthService injectable with login(email, password): Observable<User> — hash password comparison with bcrypt, emit UserLoggedIn domain event on success, throw UnauthorizedException on failure"

━━━ PER-LAYER ARCHITECTURE PLAN (spec-kit) ━━━

Each entry in "architectureLayers" MUST be a self-contained plan document following the GitHub spec-kit 'plan-template.md' structure (https://github.com/github/spec-kit). The renderer emits one document per layer (docs/10-architecture/frontend-architecture.md and backend-architecture.md) and the Architecture tab renders every named Mermaid diagram by name.

For each layer populate every field below. Use "NEEDS CLARIFICATION" inside a string value (never a blank) when information is genuinely missing.

  a) "summary": 1–3 sentences — primary requirement + technical approach for this layer.

b) "technicalContext": an object with EXACTLY these five keys, each a non-empty string:
      - "storage": e.g. "N/A", "PostgreSQL 15 via SQLAlchemy 2 async", or "localStorage only"
      - "targetPlatform": e.g. "Browser (Chrome 110+, Firefox 110+, Safari 16+)" or "Linux server, Python 3.11"
      - "performanceGoals": e.g. "<200ms p95 for read endpoints" or "TTI under 3s on a cold cache"
      - "constraints": e.g. "No direct framework imports in the domain layer"
      - "scaleScope": e.g. "50k MAU, 5k articles/day"

     Do NOT emit "languageVersion", "primaryDependencies", "testing", or "projectType" — those fields are not part of the schema. Use the layer's "techStack" array for that information.

  c) "constitutionCheck": array of bullet strings — gates passed for this layer (e.g. "Strict TypeScript", "Unit + integration tests per component", "Domain layer has zero framework imports", "All HTTP responses validated with Zod"). At minimum 3 entries.

  d) "projectStructureTree": a fenced 'text' block of the directory tree, real POSIX paths, ≤ 30 lines. Show the directories that will exist in this layer (mirror directoryStructure).

  e) "complexityTracking": array of { "violation", "whyNeeded", "simplerAlternativeRejected" }. Use [] if there are no violations; otherwise one row per violation that justifies a deliberate complexity tax.

  The existing "mermaidDiagram" remains the per-layer OVERVIEW diagram (top-down graph of the layer's structure) and is the only Mermaid diagram the editor renders for each layer in the Layers tab.

━━━ DIAGRAMS ━━━

8. All Mermaid strings must be valid syntax. Each diagram MUST declare its type on the first line. Allowed types: 'flowchart', 'graph', 'sequenceDiagram', 'classDiagram', 'stateDiagram-v2', 'erDiagram'. Avoid 'C4Context' / 'C4Container' for per-layer diagrams (use them only on the top-level systemOverview.c4.* fields). Before returning, mentally parse every diagram — invalid syntax will fail to render. Sequence-diagram message text after ":" must not contain ';' (Mermaid treats it as a Note delimiter) — either rephrase the message or use the entity '&#59;'. The other punctuation chars '{', '}', '[', ']', '<', '>', '?', '"' and '\'' are all rendered fine raw inside a message and must NOT be entity-encoded (entity-encoding them produces broken output like 'HTTP&amp;/JSON').

   Diagram placement:
   - systemOverview.c4.contextDiagram: Architecture Blueprint system context diagram
   - systemOverview.c4.containerDiagram: Architecture Blueprint container diagram
   - systemOverview.boundedContextMap: context relationships
   - architectureLayers[*].mermaidDiagram: per-layer overview diagram (the only per-layer Mermaid the editor renders)

━━━ USER STORIES (spec-kit) ━━━

Populate the top-level "userStories" array with 3–8 stories that drive the spec-kit deliverable shape. Every story MUST have:

   - "id": id matching US followed by 3+ digits, e.g. "US001", "US002", …
   - "title": short imperative title (≤ 80 chars)
   - "priority": exactly one of "P1", "P2", "P3" — P1 is the most critical (MVP), P2 next, P3 last
   - "description": a plain-language user journey (NOT a tech-stack choice)
   - "whyThisPriority": one sentence
   - "independentTest": a sentence describing how the story is verifiable in isolation
   - "acceptanceScenarios": array of at least 1 Given/When/Then triplet, each { id (FR-NNN / SC-NNN / AS-NNN), given, when, then }
   - "boundedContextIds": array of bounded-context ids the story touches

Order the array by priority (P1 first, P3 last).

━━━ FUNCTIONAL REQUIREMENTS & SUCCESS CRITERIA (spec-kit) ━━━

Populate the top-level "functionalRequirements" array with 4–12 numbered \`FR-NNN\` entries. Each entry: { id (FR-NNN), text (a clear, testable requirement), needsClarification (boolean), clarificationNote (optional) }. Whenever information is genuinely missing, set needsClarification: true and embed a \`NEEDS CLARIFICATION: …\` note in the clarificationNote — do NOT guess. Leave the array empty if and only if the plan has no functional surface.

Populate the top-level "successCriteria" array with 3–6 numbered \`SC-NNN\` entries. Each entry: { id (SC-NNN), text (a measurable, technology-agnostic outcome, e.g. "p95 home feed render under 1.5s on a warm cache") }.

━━━ PROJECT CONSTITUTION (spec-kit — 9 articles) ━━━

Populate the top-level "constitution" object with EXACTLY nine articles, in this order. Each article: { articleNumber: 1..9, title, content }. The titles MUST match (case-insensitive):

   1. Library-First
   2. CLI Interface
   3. Test-First (or Test-First (TDD))
   4. Integration Testing
   5. Observability
   6. Versioning & Breaking Changes (or Versioning)
   7. Simplicity
   8. Anti-Abstraction
   9. Integration-First Delivery (or Integration-First)

The constitution object: { projectName, version, ratifiedAt (ISO), lastAmendedAt (ISO), articles: [9 entries] }. Fill the article "content" strings from autoArchitect's stack (Standalone Angular, signalStore, JSZip, Vitest/Jasmine, DOMPurify, Zod, LangChain, no SSR) and from the plan's constraints and NFRs. Do NOT invent stack choices outside autoArchitect defaults.

Hard rule: do NOT include any mermaid content for user stories or constitution — those live in "Plan.userStories" and "Plan.constitution" only. The renderer emits them as plain Markdown in \`spec.md\` and \`.specify/memory/constitution.md\`.

━━━ AGENT TASKS — USER STORY LINKAGE ━━━

Each entry in "agentTasks" MAY carry a "userStoryIds": string[] referencing the \`USNNN\` ids the task advances. Leave the array empty when no story is associated.

━━━ OUTPUT RULES ━━━

- Return ONLY the JSON object. Start with { on line 1.
- Do not wrap in markdown fences or add any text before/after the JSON.
- Return the Plan object itself as the top-level JSON value. Do NOT wrap it in another object (no {plan: ...}, no {result: ...}, no {output: ...}).
- Do NOT echo or repeat the JSON schema below in your response. The schema is for your reference only — output the data object, not the schema definition.
- Do NOT wrap your response in a JSON array. Return a top-level JSON object { ... }, never [ ... ].
- All string arrays must have at least 1 item where not marked optional.
- domains array must have at least 1 entry.
- Every domain must have a "layer" field set to a kebab-case id matching one of the architectureLayerIds above.

JSON schema (for reference only — do NOT include in your response):
{schema}

{retryContext}`;

/**
 * @deprecated The single-shot PDF prompt is superseded by the section-stitching
 * pipeline (PDF_HEADER_SYSTEM_PROMPT + PDF_SECTION_SYSTEM_PROMPT). Kept exported
 * for backward compat with `src/app/core/prompt-builder.service.spec.ts:643`.
 */
export const PDF_CREATOR_SYSTEM_PROMPT = `You are the PDF Creator Agent for an architecture planner. Your task is to read an existing architecture plan and produce a single, technical, explanatory PDF document — distilled from the plan, grounded in its fields, never invented.

The output MUST conform exactly to the provided JSON schema (PdfDocument). Return ONLY the JSON object — no markdown fences, no prose outside the JSON.

━━━ INPUT INTERPRETATION ━━━

- You receive the active Plan JSON in the human message. The plan is authoritative: every claim you make must be grounded in a field present in the plan. Do not invent APIs, frameworks, integrations, domains, or ADRs that do not appear in the plan.
- Do not invent Mermaid diagrams. Every Mermaid string the PDF will display must already exist on the plan. Reference diagrams by their canonical location using a mermaidRef block.
- If the plan is missing information needed for a section, OMIT that section entirely rather than fabricating content. A shorter, accurate PDF is always preferable to a longer, hallucinated one.

━━━ TONE ━━━

Universal and technical throughout. One rendering per section, no parallel business / engineering columns, no audience discriminator. Prose is technical by default — preserve framework versions, file paths, and idiomatic terms verbatim from the plan; do not paraphrase technical detail into plain English. A short one-sentence user-impact line is allowed only inside sections where the reader genuinely needs it (Workflows, NFR-driven Constraints). Keep it to ≤ 1 such sentence per section.

━━━ DOCUMENT SHAPE ━━━

- title — short plan title (copy from plan.meta.title).
- subtitle — a one-sentence tagline derived from plan.meta.summary.
- generatedAt — set to the current ISO timestamp.
- executiveSummary — exactly 2–4 sentences, ~40–400 characters. State what the system does, who the primary actors are, and the headline architectural shape. Must be grounded in plan.systemOverview and plan.boundedContexts.
- sections — between 3 and 12 sections. Each section has a heading and one or more typed blocks. Recommended section list, in order:

  1. "Executive Summary" — a single paragraph (5–8 sentences) covering purpose, primary actors, headline architectural shape, and key tech-stack decisions.

  2. "System Overview" — a paragraph (purpose + context), a keyValueTable of keyActors / constraints / NFRs, AS THE VERY FIRST DIAGRAM in this section a mermaidRef for blueprint (the synthesized system-wide Blueprint diagram — actors → contexts → domains components), then a mermaidRef for system.c4.contextDiagram, an explanatory paragraph walking the reader through that diagram, a mermaidRef for system.c4.containerDiagram, and another explanatory paragraph. The Blueprint mermaidRef MUST come before the C4 mermaidRefs in this section.

  3. "Bounded Contexts" — a bullets list of name + description for each context, a mermaidRef for system.boundedContextMap, then per context: a glossary built from ubiquitousLanguage plus a paragraph explaining how that context relates to its layer and neighbours.

  4. "Architecture Layers" — per layer: AS THE VERY FIRST BLOCK of this layer's sub-section a mermaidRef for tech-stack.<id> (the synthesized per-layer Tech Stack diagram — only emit it when the layer has a non-empty techStack; omit the block entirely otherwise), then a keyValueTable (name / tech stack / patterns / description), a mermaidRef for layer.<id>.mermaidDiagram, a paragraph explaining the diagram, and optional mermaidRefs for any of the other per-layer diagrams (componentTreeDiagram, moduleDependenciesDiagram, stateManagementDiagram, apiContractDiagram) — only when populated. Do NOT reference dataFlowDiagram — the per-layer data-flow diagrams use sequence-diagram syntax that does not render legibly at PDF scale.

  5. "Per-Layer Spec Kit Highlights" — a matrix whose rows are the five layer-distinct technicalContext fields (storage, targetPlatform, performanceGoals, constraints, scaleScope) and whose columns are the layer ids. Then a bullets list of constitutionCheck per layer. Then a matrix of complexityTracking violations vs layers (omit the matrix entirely if every layer has an empty complexityTracking). OMIT this section entirely when no layer has a populated \u0060technicalContext\u0060 AND no layer has a non-empty \u0060complexityTracking\u0060; the matrix has nothing to show and the bullets are empty.

  6. "Domain Deep Dive" — per domain: a bullets list of responsibilities, a glossary of aggregate roots + one-line invariants, and a bullets list of domainEvents with triggeredBy / handledBy.

  7. "Key Workflows" — per workflow: a numbered list of steps, then a one-sentence user-impact paragraph ("A user sees this as …"), then a bullets list of domainIds involved. Skip this section entirely when plan.workflows is empty.

  8. "Architecture Decisions (ADRs)" — per ADR: a paragraph of context, a paragraph of decision, a bullets list of consequences. A callout per ADR whose status === 'proposed' (tone 'info') or status === 'deprecated' (tone 'warning').

  9. "Glossary & Appendix" — a consolidated glossary of any domain term used earlier (drawing from ubiquitousLanguage and any glossary introduced in Section 3).

Skip any section whose underlying plan fields are empty (preserve current "omit rather than fabricate" rule). If a section's underlying plan fields are empty — including "Per-Layer Spec Kit Highlights" when no layer has spec-kit data, "Key Workflows" when \u0060plan.workflows\u0060 is empty, and "Architecture Decisions (ADRs)" when \u0060plan.adrs\u0060 is empty — OMIT the section entirely. A shorter, accurate PDF is always preferable to a longer, hallucinated one.

━━━ BLOCKS ━━━

Use any of these typed blocks (kind field is the discriminator):

- paragraph — { kind: "paragraph", text: string }
- bullets — { kind: "bullets", items: string[] } (max 12 items)
- numbered — { kind: "numbered", items: string[] } (max 12 items)
- keyValueTable — { kind: "keyValueTable", rows: [string, string][] } — every row MUST be exactly two strings: a key and a value. Never put 3+ elements in a row; if you need to combine multiple facts, fold them into the value string with commas or use a separate row.
- mermaidRef — { kind: "mermaidRef", ref: { kind: "system" | "layer" | "blueprint" | "tech-stack", field | (layerId, field) | (layerId) }, caption: string }
- callout — { kind: "callout", tone: "info" | "success" | "warning" | "risk", title?: string, text: string }
- glossary — { kind: "glossary", entries: [string, string][] } — every entry MUST be exactly two strings: a term and its definition.
- matrix — { kind: "matrix", columns: string[], rows: [{ label: string, cells: string[] }], caption?: string }

When to use each:
- Use callout to highlight risk, warning, success, or a callout-style info aside. tone="risk" for architectural risks, tone="warning" for deprecated / deprecation, tone="success" for confirmed benefits, tone="info" (default) for neutral callouts and pointers back to the plan.
- Use glossary for term → definition pairs (e.g. ubiquitousLanguage entries).
- Use matrix for cross-cutting comparisons (technicalContext fields × layers, complexityTracking violations × layers).

━━━ DIAGRAM REFERENCES ━━━

Use a mermaidRef block to embed a diagram. The ref encodes the canonical location on the plan:

- system.<field> — one of "c4.contextDiagram", "c4.containerDiagram", "boundedContextMap". The renderer reads it from plan.systemOverview.
- layer.<layerId>.<field> — layerId is the kebab-case id of an architectureLayer. field is one of "mermaidDiagram", "componentTreeDiagram", "moduleDependenciesDiagram", "stateManagementDiagram", "apiContractDiagram". The renderer reads it from plan.architectureLayers[*]. Skip dataFlowDiagram — it does not render legibly at PDF scale.
- blueprint (no payload) — the synthesized system-wide Architecture Blueprint diagram (actors → bounded contexts → domains & components). Render this from the same plan fields the editor's Blueprint tab uses; do not invent content.
- tech-stack.<layerId> — the synthesized per-layer Tech Stack diagram for the layer whose id is <layerId>. Only emit this when the layer has a non-empty techStack — omit it otherwise so the renderer skips it cleanly.

Only reference a diagram that is available on the plan. If the plan has no frontend layer, do not reference layer.frontend.* or tech-stack.frontend. Every diagram you reference will be rendered and embedded as a vector image.

Always include a caption (one short sentence) on each mermaidRef so the PDF remains readable when the diagram is missing or fails to render.

━━━ OUTPUT DISCIPLINE (HARD RULE) ━━━

The response MUST start with { on line 1 and end with } as the final character. Any prose, planning notes, "let me plan the PDF", section-by-section block counts (e.g. "blocks 8. Architecture Decisions (ADRs): 3 blocks × 3 ADRs + 1 callout = 10 blocks"), chain-of-thought, commentary, markdown fences, backticks, or \u0060<think>...\u0060 / \u0060<thinking>...\u0060 reasoning blocks BEFORE, AFTER, or AROUND the JSON will cause a hard parse failure and waste tokens. The parser strips standard thinking tags but cannot recover a JSON truncated mid-write. Disable any "thinking" / "reasoning" output mode for this call if your provider supports it. Plan silently; emit only the JSON object.

- The response root MUST be a single PdfDocument object — NOT a single PdfSection ({heading, blocks}) and NOT an array of headings. Two common wrong shapes to avoid:
  (a) A bare {heading, blocks} object — this is a single section, not a document. Always wrap with at minimum {title, generatedAt, executiveSummary, sections: [ …at least 3 entries… ]}.
  (b) An array of headings like ["Section A", "Section B", …] — this has no body. Always emit the full object with body blocks per section.
  Both shapes will be repaired into placeholders and the user will see a degraded PDF.

━━━ TOKEN & LENGTH BUDGETS ━━━

- Target 5–8 sections total. Hard ceiling: 8 sections. Skip any section whose underlying plan field is empty.
- Per-block caps (upper bounds, not targets — go shorter when the section is light on source material):
  - paragraph text: ≤ 2 sentences, ≤ 220 characters.
  - bullets / numbered items: ≤ 6 items, each ≤ 100 characters.
  - keyValueTable / glossary rows: ≤ 6 rows.
  - callout text: ≤ 2 sentences, ≤ 220 characters.
  - matrix: ≤ 6 rows, ≤ 4 columns. Max 1 matrix per section.
  - mermaidRef: ≤ 1 per section for light sections; heavy sections (System Overview, Architecture Layers) MAY include up to 3 mermaidRefs each — System Overview uses the Blueprint + the two C4 diagrams; Architecture Layers uses the per-layer Tech Stack + the per-layer mermaidDiagram + at most one additional optional per-layer diagram.
- Domain Deep Dive (Section 6) — for each domain list at most 3 events, each event as one bullets entry of the form \`event.id — short description (triggered by X, handled by Y, Y)\`. If a domain has more than 3 events, list the 3 with the broadest impact and append \`(and N more events omitted)\`.
- Heavy sections (System Overview, Architecture Layers, Domain Deep Dive) MAY include 3–4 blocks. Light sections MAY include 1–2 blocks.
- Total document size MUST stay under 24 KB of JSON. Anything larger risks truncation and a failed export. When in doubt, fold two adjacent light sections together and prefer bullets over prose. If your model caps outputs below 16 384 tokens, target 5–6 sections instead of 8 and trim heavy sections (Domain Deep Dive, Architecture Layers) to 2 blocks each.
- If you cannot fit every event / aggregate / ADR, prefer omitting the least-impact entries to dropping entire sections.
- Preserve framework versions and file paths verbatim from the plan; do not paraphrase them. Do NOT pad with restatements of plan fields the reader can see in the source.

━━━ OUTPUT RULES ━━━

- Start with { on line 1. No markdown fences. No commentary before or after the JSON.
- Every string array must be non-empty where the schema requires it (bullets, numbered, keyValueTable rows, glossary entries).
- mermaidRef blocks must use the exact kind/field names from the schema (case-sensitive). Do not include the raw Mermaid source inside the block — only the ref.
- executiveSummary must be at least 40 characters.
- Do not invent content: if a plan field is absent, omit the section / block rather than fabricating.
- Every string value MUST be wrapped in straight double-quotes. Any literal double-quote character INSIDE a string MUST be escaped as \\". Never emit an unescaped " inside a string value — this is the most common reason your previous responses failed to parse.
- The response must END with } as the final character. Do not append reasoning, summaries, or prose after the closing brace.

JSON schema to conform to:
{schema}

{retryContext}`;

export const PDF_HEADER_SYSTEM_PROMPT = `You are the PDF Creator Agent for an architecture planner. This is the HEADER call of a section-stitching pipeline. Your task is to emit the document header AND the FIRST TWO sections of the canonical 9-section skeleton.

The output MUST conform exactly to the provided JSON schema (PdfDocument). Return ONLY the JSON object — no markdown fences, no prose outside the JSON.

━━━ INPUT INTERPRETATION ━━━

- You receive the active Plan JSON in the human message. The plan is authoritative: every claim you make must be grounded in a field present in the plan. Do not invent APIs, frameworks, integrations, domains, or ADRs that do not appear in the plan.
- Do not invent Mermaid diagrams. Every Mermaid string the PDF will display must already exist on the plan. Reference diagrams by their canonical location using a mermaidRef block.

━━━ TONE ━━━

Universal and technical throughout. Preserve framework versions, file paths, and idiomatic terms verbatim from the plan; do not paraphrase technical detail into plain English.

━━━ DOCUMENT SHAPE ━━━

- title — short plan title (copy from plan.meta.title).
- subtitle — a one-sentence tagline derived from plan.meta.summary (may be null).
- generatedAt — set to the current ISO timestamp.
- executiveSummary — exactly 2–4 sentences, ~40–400 characters. State what the system does, who the primary actors are, and the headline architectural shape. Must be grounded in plan.systemOverview and plan.boundedContexts.
- sections — EXACTLY TWO sections for this call: "Executive Summary" (a single 5–8 sentence paragraph block covering purpose, primary actors, headline architectural shape, key tech-stack decisions) AND "System Overview" (paragraph + keyValueTable of keyActors/constraints/NFRs, a mermaidRef for blueprint first, then a mermaidRef for system.c4.contextDiagram with explanatory paragraph, then a mermaidRef for system.c4.containerDiagram with explanatory paragraph).

━━━ BLOCKS (use any of these typed kinds) ━━━

- paragraph — { kind: "paragraph", text: string }
- bullets — { kind: "bullets", items: string[] } (max 12 items)
- numbered — { kind: "numbered", items: string[] } (max 12 items)
- keyValueTable — { kind: "keyValueTable", rows: [string, string][] } — every row MUST be exactly two strings.
- mermaidRef — { kind: "mermaidRef", ref: { kind: "system" | "layer" | "blueprint" | "tech-stack", field | (layerId, field) | (layerId) }, caption: string }
- callout — { kind: "callout", tone: "info" | "success" | "warning" | "risk", title?: string, text: string }
- glossary — { kind: "glossary", entries: [string, string][] }
- matrix — { kind: "matrix", columns: string[], rows: [{ label: string, cells: string[] }], caption?: string }

━━━ DIAGRAM REFERENCES ━━━

Use a mermaidRef block to embed a diagram. The ref encodes the canonical location on the plan:
- system.<field> — "c4.contextDiagram" | "c4.containerDiagram" | "boundedContextMap"
- layer.<layerId>.<field> — never call this from the header call (it goes in subsequent calls)
- blueprint — the synthesized system-wide Architecture Blueprint
- tech-stack.<layerId> — the synthesized per-layer Tech Stack

Always include a caption (one short sentence) on each mermaidRef.

━━━ OUTPUT DISCIPLINE ━━━

- The response MUST start with { on line 1 and end with } as the final character.
- The response root MUST be a single PdfDocument object — NOT a single PdfSection ({heading, blocks}) and NOT an array of headings.
- Executive Summary is rendered on the cover page by the renderer; do not put it in \`sections\`. The \`sections\` array starts with the "Executive Summary" content section AND the "System Overview" section.
- Disable any "thinking" / "reasoning" output mode for this call.

━━━ TOKEN & LENGTH BUDGETS ━━━

- This call produces TWO sections plus a header — target ≤ 6 KB of JSON.
- Per-block caps: paragraph text ≤ 220 chars, bullets/numbered ≤ 6 items × 100 chars, keyValueTable/glossary ≤ 6 rows, callout text ≤ 220 chars, matrix ≤ 6 rows × 4 columns.

━━━ OUTPUT RULES ━━━

- Start with { on line 1. No markdown fences. No commentary before or after the JSON.
- Every string array must be non-empty where required.
- mermaidRef blocks must use the exact kind/field names from the schema.
- executiveSummary must be at least 40 characters and at most 600.
- Do not invent content: if a plan field is absent, omit the section / block rather than fabricating.
- Every string value MUST be wrapped in straight double-quotes. Any literal double-quote character INSIDE a string MUST be escaped as \\".

JSON schema to conform to:
{schema}

{retryContext}`;

export const PDF_SECTION_SYSTEM_PROMPT = `You are the PDF Creator Agent for an architecture planner. This is a SECTION-PAIR call of a section-stitching pipeline. The orchestrator has already produced the document header and all prior sections verbatim; your task is to emit the NEXT TWO sections (or fewer, for the last call) as a partial PdfDocument — \`{sections: [...]}\`. Do NOT re-emit title, subtitle, generatedAt, or executiveSummary.

The output MUST conform exactly to the partial PdfDocument shape below — sections is an array of PdfSection objects, each with \`heading\` and \`blocks\` (≥ 1 block each).

━━━ INPUT INTERPRETATION ━━━

- The orchestrator gives you the EXACT section headings to emit via the \`targetSectionKinds\` placeholder. Do not invent new sections; do not skip any.
- You receive the full Plan summary AND the verbatim JSON of all prior sections. Treat the prior sections as authoritative: do not contradict their facts, do not duplicate them.
- Every claim you make must be grounded in a field present on the plan.
- Do not invent Mermaid diagrams. Reference diagrams by their canonical location on the plan using a mermaidRef block.

━━━ TONE ━━━

Universal and technical throughout. Preserve framework versions, file paths, and idiomatic terms verbatim from the plan; do not paraphrase technical detail into plain English.

━━━ SECTION GUIDE BY KIND ━━━

You will be asked to emit one or more of these kinds. Use the recommended block pattern:

- "Bounded Contexts" — bullets list of name + description for each context, a mermaidRef for system.boundedContextMap, then per context: a glossary built from ubiquitousLanguage plus a paragraph explaining how that context relates to its layer and neighbours.
- "Architecture Layers" — per layer: AS THE VERY FIRST BLOCK of this layer's sub-section a mermaidRef for tech-stack.<id> (only when the layer has a non-empty techStack; omit the block otherwise), then a keyValueTable (name / tech stack / patterns / description), a mermaidRef for layer.<id>.mermaidDiagram, a paragraph explaining the diagram, and optional mermaidRefs for any of the other per-layer diagrams (componentTreeDiagram, moduleDependenciesDiagram, stateManagementDiagram, apiContractDiagram) — only when populated. Do NOT reference dataFlowDiagram.
- "Per-Layer Spec Kit Highlights" — a matrix whose rows are the five layer-distinct technicalContext fields (storage, targetPlatform, performanceGoals, constraints, scaleScope) and whose columns are the layer ids. Then a bullets list of constitutionCheck per layer. Then a matrix of complexityTracking violations vs layers (omit the matrix entirely if every layer has an empty complexityTracking). Only emitted when at least one layer has populated technicalContext OR non-empty complexityTracking.
- "Domain Deep Dive" — per domain: a bullets list of responsibilities, a glossary of aggregate roots + one-line invariants, and a bullets list of domainEvents with triggeredBy / handledBy.
- "Key Workflows" — per workflow: a numbered list of steps, then a one-sentence user-impact paragraph, then a bullets list of domainIds involved. Only emitted when plan.workflows is non-empty.
- "Architecture Decisions (ADRs)" — per ADR: a paragraph of context, a paragraph of decision, a bullets list of consequences. A callout per ADR whose status === 'proposed' (tone 'info') or status === 'deprecated' (tone 'warning'). Only emitted when plan.adrs is non-empty.
- "Glossary & Appendix" — a consolidated glossary of any domain term used earlier (drawing from ubiquitousLanguage and any glossary introduced in the prior Bounded Contexts section).

━━━ BLOCKS ━━━

Use any of these typed blocks (kind field is the discriminator):

- paragraph — { kind: "paragraph", text: string }
- bullets — { kind: "bullets", items: string[] } (max 12 items)
- numbered — { kind: "numbered", items: string[] } (max 12 items)
- keyValueTable — { kind: "keyValueTable", rows: [string, string][] } — every row MUST be exactly two strings.
- mermaidRef — { kind: "mermaidRef", ref: { kind: "system" | "layer" | "blueprint" | "tech-stack", field | (layerId, field) | (layerId) }, caption: string }
- callout — { kind: "callout", tone: "info" | "success" | "warning" | "risk", title?: string, text: string }
- glossary — { kind: "glossary", entries: [string, string][] }
- matrix — { kind: "matrix", columns: string[], rows: [{ label: string, cells: string[] }], caption?: string }

When to use each:
- callout to highlight risk, warning, success, or info aside.
- glossary for term → definition pairs.
- matrix for cross-cutting comparisons.

━━━ DIAGRAM REFERENCES ━━━

Use a mermaidRef block to embed a diagram. The ref encodes the canonical location on the plan:
- system.<field> — "c4.contextDiagram" | "c4.containerDiagram" | "boundedContextMap"
- layer.<layerId>.<field> — "mermaidDiagram" | "componentTreeDiagram" | "moduleDependenciesDiagram" | "stateManagementDiagram" | "apiContractDiagram" (skip dataFlowDiagram).
- blueprint — the synthesized system-wide Architecture Blueprint.
- tech-stack.<layerId> — the synthesized per-layer Tech Stack.

Only reference a diagram that is available on the plan. Every diagram you reference will be rendered and embedded as a vector image.

━━━ OUTPUT DISCIPLINE ━━━

The response MUST start with { on line 1 and end with } as the final character. Any prose, planning notes, "let me plan", section-by-section block counts, chain-of-thought, commentary, markdown fences, backticks, or \`<think>...\` / \`...\` reasoning blocks BEFORE, AFTER, or AROUND the JSON will cause a hard parse failure and waste tokens. Disable any "thinking" / "reasoning" output mode for this call if your provider supports it. Plan silently; emit only the JSON object.

- The response root MUST be \`{sections: [...]}\` — NOT a single PdfSection ({heading, blocks}) and NOT an array of headings. Two common wrong shapes to avoid:
  (a) A bare {heading, blocks} object — wrap as \`{sections: [<your-section>]}\`.
  (b) An array of headings like ["Section A", "Section B", …] — always emit the full \`{sections: [...]}\` shape with body blocks per section.

━━━ TOKEN & LENGTH BUDGETS ━━━

- This call produces ONE OR TWO sections — target ≤ 4–6 KB of JSON.
- Per-block caps: paragraph text ≤ 220 chars, bullets/numbered ≤ 6 items × 100 chars, keyValueTable/glossary ≤ 6 rows, callout text ≤ 220 chars, matrix ≤ 6 rows × 4 columns. Domain Deep Dive (when one of the target kinds) — for each domain list at most 3 events.

━━━ OUTPUT RULES ━━━

- Start with { on line 1. No markdown fences. No commentary before or after the JSON.
- Every string array must be non-empty where required.
- mermaidRef blocks must use the exact kind/field names from the schema (case-sensitive).
- Do not invent content: if a plan field is absent, omit the section / block rather than fabricating.
- Every string value MUST be wrapped in straight double-quotes. Any literal double-quote character INSIDE a string MUST be escaped as \\".
- The response must END with } as the final character.

JSON schema to conform to:
{schema}

{retryContext}`;

export const PDF_SECTION_USER_TEMPLATE = `Produce the next sections of the PDF based on the prior context.

Plan summary (only fields relevant to the PDF — diagram strings are kept verbatim so you can reference them by location):
{planJson}

Prior sections already emitted (verbatim — do not duplicate, do not contradict):
{priorSectionsJson}

Target sections for THIS call (you MUST emit EXACTLY these headings, in this order, as the entries in the top-level \`sections\` array):
{targetSectionKinds}

Return ONLY a single JSON object shaped as \`{{"sections": [...]}}\` and nothing else. Do not include title, subtitle, generatedAt, or executiveSummary — those live in earlier calls. Start with {{ on line 1.`;

const SCAFFOLD_SYSTEM_PROMPT = `You are a principal software architect producing the SCAFFOLD of an architecture plan. Your task is to return a single valid JSON object — no markdown fences, no prose outside the JSON.

The scaffold establishes the top-level shape of the plan: the meta header, the system overview, the bounded contexts, and the identifiers the planner will use to fan out per-layer and per-domain expansion prompts.

The output MUST conform exactly to this shape:

{shape}

━━━ INPUT INTERPRETATION ━━━

- Treat the application idea, optional detail fields, and context files as unstructured source material.
- Extract and reconcile every explicit product requirement, technical constraint, quality attribute, integration, and technology preference found anywhere in the user input.
- Explicit user requirements take precedence over inferred choices. Infer only decisions that do not conflict with supplied information.
- When optional input is blank or incomplete, infer sensible constraints, measurable non-functional requirements, architecture patterns, and a specific technology stack from the application idea.

━━━ SCAFFOLD CONTENT ━━━

Populate these fields on the scaffold object:

1. "meta" — title (≤ 80 chars), summary (≤ 200 chars), generatedAt (current ISO timestamp), model (the model name you are running on).

2. "systemOverview" — purpose (1–3 sentences), context (1–3 sentences), keyActors (array, CAP ≤ 3 entries), constraints (array, CAP ≤ 3 entries), nfrs (array, CAP ≤ 3 entries).
   - "boundedContextMap": a Mermaid 'graph LR' or 'flowchart' string showing how the bounded contexts relate (relationships like "uses", "conforms to", "anti-corruption layer"). First line must declare the diagram type.
   - "c4.contextDiagram" and "c4.containerDiagram": Mermaid strings; first line must declare the diagram type.

3. "boundedContexts" — 2–4 bounded contexts (CAP at 4). Each one needs:
   - id (kebab-case), name, description (≤ 120 chars)
   - layer ("frontend" | "backend" | "shared")
   - "ubiquitousLanguage": a non-empty map of domain terms → plain-English definitions; CAP at ≤ 4 terms per context; each definition ≤ 60 chars.

4. "architectureLayerIds" — an array listing which architecture layers the plan will include. Use kebab-case ids that fit your project (e.g. "frontend"+"backend" for a web app, "cli"+"core" for a CLI, "worker"+"shared" for a backend-only service, "ingest"+"transform"+"sink" for a pipeline). Order them in the order they will appear in the final plan. At least one entry is required.

5. "domainIds" — an array of planned domain identifiers (kebab-case strings) corresponding to the bounded contexts. One domain per major backend/shared bounded context is typical. Frontend-only projects can still declare one frontend domain. At least one entry is required.

6. "includeTail" — set to true when the plan will need workflows, ADRs, or agent tasks. Set to false for tiny plans where the tail section would just be empty arrays.

━━━ DIAGRAMS ━━━

- All Mermaid strings MUST be valid syntax. Declare the diagram type on the first line (e.g. 'flowchart', 'graph', 'sequenceDiagram', 'classDiagram').
- Before returning, mentally parse every diagram — invalid syntax will fail to render.
- Sequence-diagram message text after ":" must not contain ';' (Mermaid's Note delimiter) — either rephrase the message or use the entity '&#59;'. Other punctuation ('{', '}', '[', ']', '<', '>', '?', '"', '\'') is fine raw and must NOT be entity-encoded (entity-encoding it produces broken output).
- Keep each Mermaid diagram to ≤ 6 lines. The scaffold stage is not the place for detailed per-layer diagrams.

━━━ OUTPUT RULES ━━━

- Return ONLY the JSON object. Start with { on line 1.
- Do not wrap in markdown fences or add any text before/after the JSON.
- Return the scaffold object itself as the top-level JSON value. Do NOT wrap it in another object (no {scaffold: {...}}, no {result: {...}}, no {plan: [...]}).
- Do NOT echo or repeat the shape description below in your response.
- Do NOT wrap your response in a JSON array. Return a top-level JSON object { ... }, never [ ... ].
- All string arrays must have at least 1 item where not marked optional.
- Token budget: keep the scaffold under ~2.5k completion tokens. Trim any optional content you do not need. Truncation fails validation — if you would exceed the cap, merge low-priority bounded contexts, shorten ubiquitousLanguage entries, or drop optional fields rather than running long.

{complexityGuidance}

{retryContext}`;

const SCAFFOLD_COMPLEXITY_BLOCK = `━━━ COMPLEXITY GUIDANCE ━━━

Idea complexity: {tier}. Target ≤ {maxLayers} architectureLayerIds and ≤ {maxDomains} domainIds. The plan covers the core; further layers can be added later via "Regenerate stubs". Truncate or merge low-priority layers and domains so the scaffold fits within the cap.`;

const LAYER_CHUNK_SYSTEM_PROMPT = `You are a principal software architect expanding a SINGLE architecture layer for an existing plan scaffold. Your task is to return a single valid JSON object — no markdown fences, no prose outside the JSON.

The scaffold established the meta, system overview, and bounded contexts for the plan. You are responsible for ONE architecture layer (or for a single shared batch of layers). The full plan will be assembled by the planner from multiple per-layer chunks like this one.

The output MUST conform exactly to this shape:

{shape}

━━━ INPUT ━━━

You receive:
- The application idea, technical constraints, NFRs, hints, and context files.
- The scaffold summary including the bounded-context list (id + name only — do not duplicate the bounded context details).
- The specific "layerId(s)" you must populate: {layerIds}.
- The architecture context (one sentence per layer) for each requested layer.

━━━ CONTENT ━━━

For each requested layerId, populate the full ArchitectureLayer object:

a) "id" — one of "frontend", "backend", "shared", "infrastructure".
b) "name", "description", "techStack" (≤ 8), "patterns" (≤ 6) — concrete, specific (e.g. "NestJS 10", "TypeORM 0.3", "PostgreSQL 15"). techStack and patterns must each have at least one entry.
c) "mermaidDiagram" — a Mermaid string (declare type on first line) showing the layer's high-level internal structure. ≤ 15 lines.
d) "directoryStructure" — 1–4 entries, one per top-level directory under that layer:
   - path (POSIX), description, agentInstructions (3–6 imperative steps per entry)

━━━ SPEC-KIT SECTIONS (per layer) ━━━

For each layer populate every field below. Use "NEEDS CLARIFICATION" inside a string value (never a blank) when information is genuinely missing.

e) "summary" — 1–3 sentences: primary requirement + technical approach for this layer.

f) "technicalContext" — an object with EXACTLY these five keys, each a non-empty string:
   - storage, targetPlatform, performanceGoals, constraints, scaleScope

   Do NOT emit "languageVersion", "primaryDependencies", "testing", or "projectType" — those fields are not part of the schema. Use the layer's "techStack" array for that information.

g) "constitutionCheck" — array of bullet strings (≥ 3 entries) listing gates passed for this layer.

h) "projectStructureTree" — a fenced 'text' block of the directory tree, real POSIX paths, ≤ 30 lines.

i) "complexityTracking" — array of { violation, whyNeeded, simplerAlternativeRejected }. Use [] when there are no violations.

━━━ OUTPUT RULES ━━━

- Return ONLY the JSON object. Start with { on line 1.
- Do not wrap in markdown fences or add any text before/after the JSON.
- Either a single layer object or an array of layer objects is acceptable — the planner handles both shapes. Return ALL requested layerIds in one response.
- Token budget: keep this stage under ~5k completion tokens. Keep directoryStructure to ≤ 4 entries. If your mermaidDiagram / projectStructureTree would each exceed 12 / 30 lines respectively, abbreviate the diagram body, not the field list. Truncation fails validation.

━━━ EXAMPLE SHAPE ━━━

For layerId "backend" the JSON must look like:

{
  "id": "backend",
  "name": "Backend",
  "description": "API and orchestration layer.",
  "techStack": ["NestJS 10", "PostgreSQL 15"],
  "patterns": ["Clean Architecture"],
  "mermaidDiagram": "graph TD\\nAPI-->DB",
  "directoryStructure": [
    {
      "path": "backend/src",
      "description": "Backend source root.",
      "agentInstructions": [
        "Step one.",
        "Step two.",
        "Step three."
      ]
    }
  ],
  "summary": "1-3 sentences describing the layer.",
  "technicalContext": {
    "storage": "PostgreSQL 15",
    "targetPlatform": "Linux server, Node 20",
    "performanceGoals": "<200ms p95",
    "constraints": "Domain layer has zero framework imports",
    "scaleScope": "50k MAU"
  },
  "constitutionCheck": ["Strict TypeScript", "Domain layer framework-free"],
  "projectStructureTree": "‹text-block›\nbackend/src\n├── core\n└── features\n‹/text-block›",
  "complexityTracking": []
}

(Note: in the actual response, projectStructureTree is a single string with literal newlines; the ‹text-block› markers above are just for clarity and are NOT part of the value.)

Every required key must be present. techStack, patterns, directoryStructure require non-empty arrays.

{retryContext}`;

const DOMAIN_CHUNK_SYSTEM_PROMPT = `You are a principal software architect expanding a SINGLE domain (or a small batch of domains) for an existing plan scaffold. Your task is to return a single valid JSON object — no markdown fences, no prose outside the JSON.

The scaffold established the meta, system overview, and bounded contexts. You are responsible for ONE domain (or a small batch — see the requested "domainIds" below). The full plan will be assembled from multiple per-domain chunks like this one.

The output MUST conform exactly to this shape:

{shape}

━━━ INPUT ━━━

You receive:
- The application idea, technical constraints, NFRs, hints, and context files.
- The bounded-context list (id + name only — these are the contexts the domains live in).
- The specific "domainId(s)" you must populate: {domainIds}.

━━━ CONTENT ━━━

For each requested domainId, populate a Domain object with:

a) "id" (kebab-case), "name", "description", "layer" ("frontend" | "backend" | "shared").
b) "responsibilities" — array of plain strings (1–6).
c) "aggregates" — array of Aggregate objects (backend/shared only; frontend domains may use []). CAP at ≤ 3 entries — pick the highest-value state transitions, do not enumerate every CRUD op. For each: id, name, rootEntity, description, invariants (1–4), valueObjects (1–4), commands (1–6), domainEvents (1–6)
d) "domainEvents" — array of DomainEvent objects (0–4 entries). For each: id, name, description, payload (default [], ≤ 6), triggeredBy, handledBy (default [], ≤ 4)
e) "directoryPath" — repo-relative POSIX path for this domain's code.
f) "components" — array of 1–4 Component objects. For each:
   - id, name, description, type (one of "ui-component","service","store","repository","aggregate","domain-service","use-case","controller","utility"), layer ("domain","application","infrastructure","presentation")
   - responsibilities (1–4), inputs (1–6), outputs (1–6), dependencies (default [], ≤ 8), publicApi (1–6), errorHandling, acceptanceCriteria (1–5), outOfScope (1–4), targetFile
   - "tddSpec": { unitTests (2–3), integrationTests (1–2) } where every test case is { description, given: string[] (1–3), when: string, then: string[] (1–3) }. Keep test descriptions ≤ 80 chars each.

━━━ OUTPUT RULES ━━━

- Return ONLY the JSON object. Start with { on line 1.
- Do not wrap in markdown fences or add any text before/after the JSON.
- Either a single domain object or an array of domain objects is acceptable — the planner handles both shapes. Return ALL requested domainIds in one response.
- Token budget: keep under ~4k completion tokens; cap aggregates at 3, components at 4, events at 4, test descriptions at 80 chars. Truncation fails validation.

{retryContext}`;

const TAIL_SYSTEM_PROMPT = `You are a principal software architect producing the TAIL section of an architecture plan. The scaffold, per-layer, and per-domain stages already populated everything else. Your task is to return ONLY the workflows, ADRs, agent tasks, user stories, functional requirements, success criteria, and the project constitution as a single valid JSON object — no markdown fences, no prose outside the JSON.

The output MUST conform exactly to this shape:

{shape}

━━━ INPUT ━━━

You receive:
- The application idea, technical constraints, NFRs, hints, and context files.
- The bounded-context summary from the scaffold.
- A list of domain ids already declared on the plan.

━━━ CONTENT ━━━

a) "workflows" — array of Workflow objects, each { id, name, description, steps: string[], domainIds: string[] }. Skip the workflow entirely if no multi-step business flows are warranted. When the scaffold's "includeTail" is false, return [].

b) "adrs" — array of ADR objects, each { id, title, status ("proposed" | "accepted" | "deprecated"), context, decision, consequences: string[] }. Include 1–3 ADRs covering the highest-impact architectural decisions.

c) "agentTasks" — array of AgentTask objects, each { id, title, description, acceptanceCriteria: string[], fileHints: string[], userStoryIds: string[] }. Include 1–3 agent tasks for the highest-value starter work. When a task advances one of the user stories below, list its USNNN id in userStoryIds.

d) "userStories" — REQUIRED. Array of 3–8 User Story objects that drive the spec-kit deliverable shape. Each entry: { id (matching USNNN, e.g. "US001"), title (≤ 80 chars), priority ("P1" | "P2" | "P3" — P1 is MVP), description (plain-language user journey, NOT a tech-stack choice), whyThisPriority (one sentence), independentTest (how the story is verifiable in isolation), acceptanceScenarios: [{ id (FR-NNN / SC-NNN / AS-NNN), given, when, then }] (≥ 1), boundedContextIds: string[] (ids from the scaffold that this story touches). Order the array by priority (P1 first, P3 last).

e) "functionalRequirements" — array of 4–12 FR objects, each { id (matching FR-NNN), text (clear, testable requirement), needsClarification (boolean, default false), clarificationNote (optional) }. Whenever information is genuinely missing, set needsClarification: true and embed a NEEDS CLARIFICATION note in the clarificationNote — do NOT guess. Leave the array empty if and only if the plan has no functional surface.

f) "successCriteria" — array of 3–6 SC objects, each { id (matching SC-NNN), text (a measurable, technology-agnostic outcome, e.g. "p95 home feed render under 1.5s on a warm cache") }.

g) "constitution" — REQUIRED. The project constitution as an object: { projectName (use the plan title), version (start at "1.0.0"), ratifiedAt (ISO timestamp), lastAmendedAt (ISO timestamp, same as ratifiedAt on first generation), articles: [EXACTLY 9 entries] }. Articles MUST be in this order with these titles (case-insensitive):

   1. Library-First
   2. CLI Interface
   3. Test-First (or Test-First (TDD))
   4. Integration Testing
   5. Observability
   6. Versioning & Breaking Changes (or Versioning)
   7. Simplicity
   8. Anti-Abstraction
   9. Integration-First Delivery (or Integration-First)

   Each article: { articleNumber: 1..9, title, content (one or more sentences) }. Fill the article "content" strings from autoArchitect's stack (Standalone Angular, signalStore, JSZip, Vitest/Jasmine, DOMPurify, Zod, LangChain, no SSR) and from the plan's constraints / NFRs / bounded contexts. Do NOT invent stack choices outside autoArchitect defaults.

Hard rule: do NOT include any mermaid content for user stories or constitution — those live in "Plan.userStories" and "Plan.constitution" only. The renderer emits them as plain Markdown in spec.md and .specify/memory/constitution.md.

━━━ OUTPUT RULES ━━━

- Return ONLY the JSON object. Start with { on line 1.
- Do not wrap in markdown fences or add any text before/after the JSON.
- Empty arrays are valid for workflows / adrs only. userStories, successCriteria, and constitution MUST always be populated on first generation.
- Token budget: keep this stage under ~4k completion tokens. Trim verbose article content if you are at risk of truncation.

{retryContext}`;

export function escapeBraces(text: string): string {
  return text.replace(/\{/g, '{{').replace(/\}/g, '}}');
}

const SCAFFOLD_SHAPE = `One top-level JSON object with EXACTLY these keys:
- meta: { title: string (≤ 80 chars), summary: string (≤ 200 chars), generatedAt: ISO timestamp, model: string }
- systemOverview: { purpose: string (1–3 sentences), context: string (1–3 sentences), keyActors: string[] (1–3), constraints: string[] (1–3), nfrs: string[] (1–3), boundedContextMap?: string (Mermaid, first line = type, ≤ 6 lines), c4: { contextDiagram: Mermaid string (≤ 6 lines), containerDiagram: Mermaid string (≤ 6 lines) } }
- boundedContexts: array of 2–4 entries, each { id (kebab-case), name, description (≤ 120 chars), layer: "frontend" | "backend" | "shared", ubiquitousLanguage: non-empty record<string, string> (≤ 4 terms, each ≤ 60 chars) }
- architectureLayerIds: kebab-case string[] (≥ 1) — kebab-case ids the planner will use to fan out per-layer jobs
- domainIds: kebab-case string[] (≥ 1) — one per backend/shared bounded context
- includeTail: boolean (true when workflows / ADRs / agent tasks are needed)`;

const LAYER_SHAPE = `One top-level JSON object containing ONE layer OR an array of layers. Each layer is:
- id (kebab-case), name, description (all strings, ≥ 1 char)
- techStack: string[] (1–8, e.g. ["NestJS 10", "PostgreSQL 15"])
- patterns: string[] (1–6, e.g. ["Clean Architecture", "CQRS"])
- mermaidDiagram: Mermaid string (declare type on first line, ≤ 15 lines)
- directoryStructure: array of { path (POSIX), description, agentInstructions: string[] (3–6 imperative steps) } (1–4 entries)
- summary: string (1–3 sentences)
- technicalContext: { storage, targetPlatform, performanceGoals, constraints, scaleScope } — every value non-empty
- constitutionCheck: string[] (≥ 3 gates passed, ≤ 8)
- projectStructureTree: string (fenced 'text' block, real POSIX paths, ≤ 30 lines)
- complexityTracking: array of { violation, whyNeeded, simplerAlternativeRejected } (use [] when none, ≤ 8 entries)
- mermaidDiagram: Mermaid string (declare type on first line, ≤ 15 lines) — the only per-layer Mermaid the editor renders`;

const DOMAIN_SHAPE = `One top-level JSON object containing ONE domain OR an array of domains. Each domain is:
- id (kebab-case), name, description (strings, ≥ 1 char)
- layer: kebab-case id matching an architectureLayer id
- responsibilities: string[] (1–6)
- aggregates: array of { id, name, rootEntity, description, invariants: string[] (1–4), valueObjects: string[] (1–4), commands: string[] (1–6), domainEvents: string[] (1–6) } (≤ 3 entries; use [] for frontend-only domains)
- domainEvents: array of { id, name, description, payload: string[] (default [], ≤ 6), triggeredBy, handledBy: string[] (default [], ≤ 4) } (≤ 4 entries)
- directoryPath: repo-relative POSIX string
- components: array of 1–4 entries, each:
    { id, name, description, type: "ui-component" | "service" | "store" | "repository" | "aggregate" | "domain-service" | "use-case" | "controller" | "utility",
      layer: "domain" | "application" | "infrastructure" | "presentation",
      responsibilities: string[] (1–4), inputs: string[] (1–6), outputs: string[] (1–6), dependencies: string[] (default [], ≤ 8),
      publicApi: string[] (1–6), errorHandling, acceptanceCriteria: string[] (1–5), outOfScope: string[] (1–4), targetFile,
      tddSpec: { unitTests: array of { description, given: string[] (1–3), when, then: string[] (1–3) } (2–3 entries),
                 integrationTests: array of same shape (1–2 entries) } }`;

const TAIL_SHAPE = `One top-level JSON object containing ONLY these seven keys:
- workflows: array of { id, name, description, steps: string[] (default []), domainIds: string[] (default []) } (use [] when scaffold.includeTail was false)
- adrs: array of { id, title, status: "proposed" | "accepted" | "deprecated", context, decision, consequences: string[] (default []) } (1–3 entries)
- agentTasks: array of { id, title, description, acceptanceCriteria: string[] (≥ 1), fileHints: string[] (≥ 1), userStoryIds: string[] (default []) } (1–3 entries)
- userStories: array of { id (US001+), title (≤ 80 chars), priority ("P1" | "P2" | "P3"), description, whyThisPriority, independentTest, acceptanceScenarios: [{ id (FR-NNN / SC-NNN / AS-NNN), given, when, then }], boundedContextIds: string[] (default []) } (3–8 entries, ordered P1 → P3)
- functionalRequirements: array of { id (FR-NNN), text, needsClarification (boolean, default false), clarificationNote (string, optional) } (4–12 entries; embed NEEDS CLARIFICATION in clarificationNote when information is genuinely missing)
- successCriteria: array of { id (SC-NNN), text } (3–6 entries, measurable, technology-agnostic outcomes)
- constitution: { projectName, version, ratifiedAt (ISO), lastAmendedAt (ISO), articles: [9 entries] } — EXACTLY nine articles, in this order:
    1. Library-First
    2. CLI Interface
    3. Test-First (or Test-First (TDD))
    4. Integration Testing
    5. Observability
    6. Versioning & Breaking Changes (or Versioning)
    7. Simplicity
    8. Anti-Abstraction
    9. Integration-First Delivery (or Integration-First)
  Each article: { articleNumber: 1..9, title, content (1+ sentence) }`;

const BOUNDED_CONTEXTS_SHAPE = `One top-level JSON object containing ONE bounded context OR an array of bounded contexts (1–12 entries). Each entry is:
- id (kebab-case string, ≥ 1 char, must NOT collide with any existing id unless you are explicitly keeping that entry)
- name (string, ≥ 1 char)
- description (string, ≤ 120 chars)
- layer: kebab-case id matching an architectureLayer id
- ubiquitousLanguage: non-empty record<string, string> (≤ 4 terms, each ≤ 60 chars)`;

const SYSTEM_OVERVIEW_SHAPE = `One top-level JSON object with EXACTLY these three keys:
- boundedContextMap: Mermaid string that declares the diagram type on the first line and lists every bounded context (existing AND new) as a node. Keep under ~6 lines.
- c4.contextDiagram: Mermaid string (C4 Context syntax, ≤ 6 lines) showing how each bounded context (existing AND new) interacts with external actors and upstream/downstream systems.
- c4.containerDiagram: Mermaid string (C4 Container syntax, ≤ 8 lines) showing the major deployable units (apps, services, datastores) grouped by bounded context.`;

const REFINEMENT_PRECEDENCE_RULE = [
  "- AUTHORITATIVE REFINEMENT: if the user message contains a `## Refinement Instruction` block (optionally with `### User's Original Request`, `### Collected Clarifications`, and `## Refinement Chat History`), treat it as the source of truth for what must change in the plan. The block is HIGHER priority than the USER-EDIT DIGEST and the \"stay conservative\" rule above. Apply the refinement in this layer / domain / tail, even if it means rewriting fields the user previously did not change.",
  "- If the refinement asks for a NEW element (component, responsibility, aggregate, technology entry, workflow step, ADR, etc.), you MUST include it in the JSON you return. Returning the input unchanged when the refinement asks for new content is a failure.",
  "- If the refinement asks to MODIFY an existing field, you MUST produce a value that visibly differs from the input on that field.",
].join('\n');

const STRUCTURAL_ADDITIONS_RULE = "- You MAY and SHOULD add new components, responsibilities, aggregates, mermaid nodes, technology entries, workflows, ADRs, and agent tasks needed to satisfy the `## Refinement Instruction` and `## Refinement Chat History` blocks above. You MUST keep existing ids you do not explicitly remove. Adding new structural elements is REQUIRED whenever the refinement asks for them — do not silently drop them.";

const REGENERATE_BOUNDED_CONTEXTS_SYSTEM_PROMPT = `You are a principal software architect regenerating the FULL bounded contexts list for an EXISTING architecture plan. Your task is to return a single valid JSON object — no markdown fences, no prose outside the JSON.

The plan has already been generated once. The user has since made edits — some markdown file edits are preserved verbatim and do not need to be reproduced here, and some structural changes (added / removed / modified elements) are described in the digest below. You are responsible for the ENTIRE boundedContexts[] array.

The output MUST conform exactly to this shape:

{shape}

━━━ INPUT ━━━

You receive:
- The original plan title and idea context.
- The existing bounded contexts array (each entry: id, name, description, layer, ubiquitousLanguage).
- The existing architecture layer ids (bounded contexts must reference a known layer id).
- The current systemOverview.boundedContextMap (reference only — do not echo back verbatim if you add new contexts).
- A digest of every change the user made since generation.

{addedClause}

{removedClause}

━━━ TREATMENT RULES ━━━

- Existing ids you do not explicitly remove MUST be returned verbatim (id, name, layer, description). You MAY expand ubiquitousLanguage terms but you MUST NOT remove any.
- When the Refinement Instruction or Refinement Chat History requests a NEW bounded context, you MUST append a fresh entry with a new kebab-case id that does not collide with any existing id. Do not silently drop or rename existing entries.
- Layer reference: each bounded context's "layer" MUST be one of the existing architecture layer ids listed in the input. If you propose a new bounded context, it MUST reference an existing layer id; do not invent layer ids here.
- UbiquitousLanguage: every entry MUST be a non-empty object (≥ 1 term, ≤ 4 terms). Terms ≤ 60 chars.
- Total entries (existing + new) MUST NOT exceed 12.
${REFINEMENT_PRECEDENCE_RULE}
${STRUCTURAL_ADDITIONS_RULE}

━━━ OUTPUT RULES ━━━

- Return ONLY the JSON object. Start with {{ on line 1.
- Do not wrap in markdown fences or add any text before/after the JSON.
- Token budget: keep under ~3k completion tokens.

━━━ USER-EDIT DIGEST ━━━

The following is the digest of user changes since the plan was generated:

{editSummary}

JSON schema (for reference only — do NOT include in your response):
{schema}

{retryContext}`;

const REGENERATE_SYSTEM_OVERVIEW_SYSTEM_PROMPT = `You are a principal software architect regenerating the systemOverview diagram block (boundedContextMap + C4 Context + C4 Container diagrams) for an EXISTING architecture plan. Your task is to return a single valid JSON object — no markdown fences, no prose outside the JSON.

The plan has already been generated once. The user has since made structural changes (added or removed bounded contexts, layers, domains). You are responsible for refreshing the three diagram strings so they reflect the current plan.

The output MUST conform exactly to this shape:

{shape}

━━━ INPUT ━━━

You receive:
- The original plan title and idea context.
- The full boundedContexts[] array (existing AND any new entries added during regeneration).
- The full architectureLayers[] and domains[] arrays.
- The current systemOverview.boundedContextMap / c4.contextDiagram / c4.containerDiagram (reference only — you will overwrite all three).

{addedClause}

━━━ TREATMENT RULES ━━━

- Every entry in boundedContexts[] (existing AND new) MUST appear as a node / participant in the three diagrams.
- boundedContextMap: Mermaid string. First line declares the diagram type (e.g. "graph LR" or "flowchart LR"). Keep under ~6 lines.
- c4.contextDiagram: C4 Context diagram in Mermaid syntax (≤ 6 lines).
- c4.containerDiagram: C4 Container diagram in Mermaid syntax (≤ 8 lines).
- Do NOT include external actor or system names that are not in the boundedContexts[] / domains[] inputs.
${REFINEMENT_PRECEDENCE_RULE}
${STRUCTURAL_ADDITIONS_RULE}

━━━ OUTPUT RULES ━━━

- Return ONLY the JSON object. Start with {{ on line 1.
- Do not wrap in markdown fences or add any text before/after the JSON.
- Token budget: keep under ~2k completion tokens.

━━━ USER-EDIT DIGEST ━━━

The following is the digest of user changes since the plan was generated:

{editSummary}

JSON schema (for reference only — do NOT include in your response):
{schema}

{retryContext}`;

const REGENERATE_ADDITIONS_SHAPE = `One top-level JSON object with EXACTLY these three OPTIONAL keys:
- newLayers: array of architecture layers (same shape as a layer chunk — each layer is an object with id, name, description, techStack, patterns, mermaidDiagram, directoryStructure, summary, technicalContext, etc.). Use [] (or omit the key) when no new layer is implied.
- newDomains: array of domains (same shape as a domain chunk — each domain is an object with id, name, description, layer, responsibilities, aggregates, domainEvents, directoryPath, components). Use [] (or omit the key) when no new domain is implied.
- newBoundedContexts: array of bounded contexts (1–12 entries, each with id, name, description, layer, ubiquitousLanguage). Use [] (or omit the key) when no new bounded context is implied.

Each entry in newLayers / newDomains / newBoundedContexts MUST include an "id" field. Do NOT include any keys beyond these three.`;

const REGENERATE_ADDITIONS_SYSTEM_PROMPT = `You are a principal software architect augmenting an EXISTING architecture plan in response to a user refinement request. Your task is to return a single valid JSON object — no markdown fences, no prose outside the JSON.

The plan has already been generated once. The user has since asked (via the chat) for new structural elements to be added — e.g. "add a banking domain", "we need a separate admin frontend layer", "introduce a notifications bounded context". Your output is the list of NEW structural elements that must be appended to the existing plan.

The output MUST conform exactly to this shape:

{shape}

━━━ MINIMUM FIELD REQUIREMENTS (the validator WILL reject anything less) ━━━

Each new domain MUST include: id (kebab-case, non-empty), name, description, layer (one of the EXISTING layer ids — never invent a new layer here unless you ALSO declare it under newLayers), responsibilities (array of ≥1 short strings), directoryPath (POSIX path like "src/app/<id>/"), AND components (array of ≥1 component — see below). aggregates and domainEvents can be [].

Each new domain's components MUST each include: id (kebab-case, non-empty), name, description, type (one of "ui-component", "service", "store", "repository", "aggregate", "domain-service", "use-case", "controller", "utility"), layer (one of "domain", "application", "infrastructure", "presentation"), responsibilities (≥1), inputs (≥1), outputs (≥1), publicApi (≥1), errorHandling (non-empty string), acceptanceCriteria (≥1), outOfScope (≥1), tddSpec ({{ unitTests: ≥2, integrationTests: ≥1 }} each with description/given/when/then), targetFile (POSIX path).

Each new architectureLayer MUST include: id (kebab-case matching /^[a-z0-9]+(?:-[a-z0-9]+)*$/), name, description, techStack (≥1), patterns (≥1), mermaidDiagram (Mermaid string starting with "graph TD" or similar), directoryStructure (≥1 entry with path/description/agentInstructions).

Each new boundedContext MUST include: id (kebab-case, non-empty), name, description, layer (one of the EXISTING or NEW layer ids), ubiquitousLanguage (non-empty record of ≥1 term).

━━━ INPUT ━━━

You receive:
- The original plan title and idea context.
- The existing architectureLayers[], domains[], and boundedContexts[] arrays (use the ids of these so you do NOT propose duplicates).
- The Refinement Instruction / Refinement Chat History blocks (the authoritative reason for this regeneration — apply them literally).

━━━ TREATMENT RULES ━━━

- Return ONLY the elements that are genuinely NEW. Do NOT echo back the existing layers, domains, or boundedContexts.
- Every new entry's "id" MUST be a kebab-case string that does NOT collide with any existing id (across layers, domains, AND boundedContexts). Mismatched casing or punctuation is treated as collision.
- Every new domain's "layer" field MUST reference an existing architectureLayer id — if the user request implies a new layer, declare both the new layer AND the new domains under it.
- Omit any of newLayers / newDomains / newBoundedContexts (omit the key entirely) when the refinement does not imply new entries of that kind.
- If the refinement implies nothing new, return an empty object: {{}}. No "explanation" keys, no markdown.
- Prefer declaring ONE complete new domain over MANY incomplete ones — partial entries are dropped.
- If the Refinement Chat History shows the user explicitly asked to ADD or INTRODUCE a domain/layer/bounded context (even vaguely, e.g. "add a banking domain", "we need an admin layer"), prefer proposing at least one reasonable, fully-formed entry that matches the user's stated intent over returning an empty object. Vague user prompts (e.g. "add functionality") still warrant at least one concrete domain proposal — interpret generously rather than refusing. Only return {{}} when the chat transcript has no actionable user request at all.
- DOMAIN KEYWORDS ARE LOAD-BEARING. Whenever the user's chat request contains the word "domain", "domains", "bounded context", "feature area", "module", or "subdomain" (case-insensitive), you MUST populate the 'newDomains' key with at least ONE fully-formed domain entry that satisfies the schema below. Do NOT silently interpret a "domain" mention as a workflow tweak, an extra layer, or a component addition — the user is asking for a new domain. If the request mentions multiple keywords (e.g. "add a functionality and a domain"), you MUST populate every key implied by those keywords (domain -> newDomains, layer -> newLayers, bounded context -> newBoundedContexts).
- A 'newLayers' entry alone is NEVER sufficient when the user mentions "domain". If you declare a new layer to host a new domain, you MUST ALSO declare the new domain under 'newDomains' referencing that layer.
${REFINEMENT_PRECEDENCE_RULE}
${STRUCTURAL_ADDITIONS_RULE}

━━━ OUTPUT RULES ━━━

- Return ONLY the JSON object. Start with {{ on line 1.
- Do not wrap in markdown fences or add any text before/after the JSON.
- Token budget: keep under ~3k completion tokens.

JSON schema (for reference only — do NOT include in your response):
{schema}

{retryContext}`;

const REGENERATE_LAYER_SYSTEM_PROMPT = `You are a principal software architect regenerating a SINGLE architecture layer for an EXISTING architecture plan. Your task is to return a single valid JSON object — no markdown fences, no prose outside the JSON.


The plan has already been generated once. The user has since made edits — some markdown file edits are preserved verbatim and do not need to be reproduced here, and some structural changes (added / removed / modified elements) are described in the digest below. You are responsible for ONE architecture layer.

The output MUST conform exactly to this shape:

{shape}

━━━ INPUT ━━━

You receive:
- The original plan title and idea context.
- The existing layer JSON (id, name, description, techStack, patterns, mermaidDiagram, directoryStructure, summary, technicalContext, constitutionCheck, projectStructureTree, complexityTracking).
- The specific layerId to regenerate: {layerId} (name: {layerName}).
- A digest of every change the user made since generation. Markdown files the user edited are preserved verbatim by the planner and do not need to be reproduced in the layer output.

{addedClause}

━━━ TREATMENT RULES ━━━

- The "id" field MUST remain "{layerId}" verbatim — never rename it.
- Treat the user's modifications as guidance. You MAY rewrite the layer for coherence, but stay conservative on the fields the user did not change.
${REFINEMENT_PRECEDENCE_RULE}
- Stay within the schema constraints (techStack ≤ 8, patterns ≤ 6, directoryStructure 1–4 entries, mermaidDiagram ≤ 15 lines, projectStructureTree ≤ 30 lines, constitutionCheck ≥ 3 entries, complexityTracking ≤ 8 entries).
${STRUCTURAL_ADDITIONS_RULE}

━━━ OUTPUT RULES ━━━

- Return ONLY the JSON object. Start with {{ on line 1.
- Do not wrap in markdown fences or add any text before/after the JSON.
- Token budget: keep under ~5k completion tokens. If mermaidDiagram / projectStructureTree would exceed 12 / 30 lines respectively, abbreviate the diagram body, not the field list. Truncation fails validation.

━━━ USER-EDIT DIGEST ━━━

The following is the digest of user changes since the plan was generated:

{editSummary}

JSON schema (for reference only — do NOT include in your response):
{schema}

{retryContext}`;

const REGENERATE_DOMAIN_SYSTEM_PROMPT = `You are a principal software architect regenerating a SINGLE domain for an EXISTING architecture plan. Your task is to return a single valid JSON object — no markdown fences, no prose outside the JSON.

The plan has already been generated once. The user has since made edits — some markdown file edits are preserved verbatim and do not need to be reproduced here, and some structural changes (added / removed / modified elements) are described in the digest below. You are responsible for ONE domain.

The output MUST conform exactly to this shape:

{shape}

━━━ INPUT ━━━

You receive:
- The original plan title and idea context.
- The existing domain JSON (id, name, description, layer, responsibilities, aggregates, domainEvents, directoryPath, components).
- The specific domainId to regenerate: {domainId} (name: {domainName}).
- A digest of every change the user made since generation.

{addedClause}

━━━ TREATMENT RULES ━━━

- The "id" field MUST remain "{domainId}" verbatim — never rename it.
- Treat the user's modifications as guidance. You MAY rewrite the domain for coherence, but stay conservative on the fields the user did not change.
${REFINEMENT_PRECEDENCE_RULE}
- Stay within the schema constraints (responsibilities 1–6, aggregates ≤ 3, domainEvents ≤ 4, components 1–4). Test descriptions ≤ 80 chars each.
${STRUCTURAL_ADDITIONS_RULE}

━━━ OUTPUT RULES ━━━

- Return ONLY the JSON object. Start with {{ on line 1.
- Do not wrap in markdown fences or add any text before/after the JSON.
- Token budget: keep under ~4k completion tokens. Truncation fails validation.

━━━ USER-EDIT DIGEST ━━━

The following is the digest of user changes since the plan was generated:

{editSummary}

JSON schema (for reference only — do NOT include in your response):
{schema}

{retryContext}`;

const REGENERATE_TAIL_SYSTEM_PROMPT = `You are a principal software architect regenerating the TAIL section (workflows, ADRs, agent tasks, user stories, functional requirements, success criteria, and project constitution) of an EXISTING architecture plan. Your task is to return ONLY the tail keys listed in the shape below as a single valid JSON object — no markdown fences, no prose outside the JSON.

The plan has already been generated once. The user has since made edits — some markdown file edits are preserved verbatim, and some structural changes (added / removed / modified elements) are described in the digest below.

The output MUST conform exactly to this shape:

{shape}

━━━ INPUT ━━━

You receive:
- The original plan title.
- The existing workflows, ADRs, agentTasks, userStories, functionalRequirements, successCriteria, and constitution arrays / object (the existing tail JSON).
- A digest of every change the user made since generation.

{addedClause}

{removedClause}

━━━ TREATMENT RULES ━━━

- For workflows / ADRs / agent tasks / user stories / functional requirements / success criteria the user ADDED: keep id (or USNNN / FR-NNN / SC-NNN) verbatim; you may expand or improve other fields.
- For workflows / ADRs / agent tasks / user stories / functional requirements / success criteria the user REMOVED: omit from output; do not re-add in any form.
- For workflows / ADRs / agent tasks / user stories / functional requirements / success criteria the user MODIFIED: treat as guidance; you may rewrite for coherence but stay conservative on the fields the user did not change.
${REFINEMENT_PRECEDENCE_RULE}
- For all other workflows / ADRs / agent tasks / user stories / functional requirements / success criteria (unchanged by the user): you may rewrite for coherence with the rest of the plan.
- For the project constitution: preserve the existing article titles and articleNumber values verbatim. You MAY amend article "content" strings to reflect updated constraints / NFRs, and bump the constitution "version" when content changes. Articles 1..9 must remain in the same order and titles.
${STRUCTURAL_ADDITIONS_RULE}

━━━ OUTPUT RULES ━━━

- Return ONLY the JSON object. Start with {{ on line 1.
- Do not wrap in markdown fences or add any text before/after the JSON.
- Empty arrays are valid for workflows / adrs only. userStories, successCriteria, and constitution MUST always be populated.
- Token budget: keep under ~4k completion tokens.

━━━ USER-EDIT DIGEST ━━━

The following is the digest of user changes since the plan was generated:

{editSummary}

JSON schema (for reference only — do NOT include in your response):
{schema}

{retryContext}`;

const REPAIR_SHAPE_SCAFFOLD = `Repair prompt for a previous scaffold attempt. Output a single JSON object with the same shape as the original scaffold prompt:
${SCAFFOLD_SHAPE}`;
const REPAIR_SHAPE_LAYER = `Repair prompt for a previous layer-chunk attempt. Output a single JSON object or array of layers with the same shape as the original layer prompt:
${LAYER_SHAPE}`;
const REPAIR_SHAPE_DOMAIN = `Repair prompt for a previous domain-chunk attempt. Output a single JSON object or array of domains with the same shape as the original domain prompt:
${DOMAIN_SHAPE}`;
const REPAIR_SHAPE_TAIL = `Repair prompt for a previous tail attempt. Output a single JSON object with the same shape as the original tail prompt:
${TAIL_SHAPE}`;

function formatOptionalInput(value: string, inferenceInstruction: string): string {
  return value.trim() || `No additional input was provided. ${inferenceInstruction}`;
}

export const DEFAULT_SKILL_REGISTRY: Readonly<
  Record<string, { agentId: string; skillId: string }>
> = {
  scaffold: { agentId: 'agent-1', skillId: 'skill-1' },
  layers: { agentId: 'agent-1', skillId: 'skill-1' },
  domains: { agentId: 'agent-1', skillId: 'skill-2' },
  tail: { agentId: 'agent-1', skillId: 'skill-1' },
  pdf: { agentId: 'agent-4', skillId: 'skill-8' },
  'audit-repair': { agentId: 'agent-1', skillId: 'skill-1' },
} as const;

export const PDF_ADDITIONAL_SKILLS: ReadonlyArray<{
  agentId: string;
  skillId: string;
}> = [
  { agentId: 'agent-4', skillId: 'skill-13' },
  { agentId: 'agent-4', skillId: 'skill-14' },
  { agentId: 'agent-4', skillId: 'skill-15' },
];

export function resolveSkillForStage(
  agents: { resolveSkill: (agentId: string, skillId: string) => ResolvedSkill | null },
  stage: string,
): ResolvedSkill | null {
  const ref = DEFAULT_SKILL_REGISTRY[stage];
  if (!ref) return null;
  return agents.resolveSkill(ref.agentId, ref.skillId);
}

export function resolveSkillsForStage(
  agents: {
    resolveSkill: (agentId: string, skillId: string) => ResolvedSkill | null;
  },
  stage: string,
): ResolvedSkill[] {
  if (stage === 'pdf') {
    const primary = resolveSkillForStage(agents, 'pdf');
    const extras: ResolvedSkill[] = [];
    for (const ref of PDF_ADDITIONAL_SKILLS) {
      const resolved = agents.resolveSkill(ref.agentId, ref.skillId);
      if (resolved) {
        extras.push(resolved);
      }
    }
    return primary ? [primary, ...extras] : extras;
  }
  const single = resolveSkillForStage(agents, stage);
  return single ? [single] : [];
}

export function appendSkillPrompt(safeBase: string, skillPrompt: string | undefined): string {
  if (!skillPrompt || !skillPrompt.trim()) {
    return safeBase;
  }







  const unescapedBase = safeBase.replace(/\{\{/g, '{').replace(/\}\}/g, '}');
  const escapedSuffix = escapeBraces(skillPrompt);
  return escapeBraces(unescapedBase + '\n\n' + escapedSuffix);
}

export function formatRefinementContext(answers: RefinementAnswer[] | undefined): string {
  const answered = (answers ?? []).filter((answer) => !answer.skipped && answer.value.trim());
  if (answered.length === 0) {
    return '';
  }
  return [
    '## User Clarifications',
    ...answered.map((answer) => `- Q: ${answer.questionId} A: ${answer.value.trim()}`),
  ].join('\n');
}

export interface RefinementChatTranscriptTurn {
  role: 'user' | 'assistant';
  text: string;
  at?: string;
}

export interface RefinementInstructionBlock {
  instruction: string;
  answers: { questionId: string; value: string }[];
  userPrompt?: string;
  chatTranscript?: RefinementChatTranscriptTurn[];
}

export const RefinementAdditionsResponseSchema = z
  .object({
    newLayers: z.array(LayerChunkSchema).optional(),
    newDomains: z.array(DomainChunkSchema).optional(),
    newBoundedContexts: z.array(BoundedContextChunkSchema).optional(),
  })
  .passthrough();

export type RefinementAdditionsResponse = z.infer<typeof RefinementAdditionsResponseSchema>;

const TRANSCRIPT_TURN_CHAR_CAP = 300;

function capTurnText(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length <= TRANSCRIPT_TURN_CHAR_CAP) return trimmed;
  return `${trimmed.slice(0, TRANSCRIPT_TURN_CHAR_CAP)}…`;
}

export function formatRefinementInstruction(
  block: RefinementInstructionBlock | undefined,
): string {
  if (!block) {
    return '';
  }
  const instruction = block.instruction.trim();
  const hasTranscript = (block.chatTranscript ?? []).some((turn) => turn.text.trim().length > 0);
  if (!instruction && block.answers.length === 0 && !block.userPrompt?.trim() && !hasTranscript) {
    return '';
  }
  const answerLines = block.answers
    .filter((answer) => answer.value.trim())
    .map((answer) => `- Q: ${answer.questionId} A: ${answer.value.trim()}`);
  const transcriptLines = hasTranscript
    ? (block.chatTranscript ?? [])
        .filter((turn) => turn.text.trim().length > 0)
        .map((turn) => {
          const label = turn.role === 'user' ? 'USER' : 'ASSISTANT';
          return `- ${label}: ${capTurnText(turn.text)}`;
        })
    : [];
  return [
    '## Refinement Instruction',
    instruction || '(no additional instruction — apply the clarifications below)',
    ...(block.userPrompt?.trim() ? ['', "### User's Original Request", block.userPrompt.trim()] : []),
    ...(answerLines.length > 0 ? ['', '### Collected Clarifications', ...answerLines] : []),
    ...(transcriptLines.length > 0
      ? ['', '## Refinement Chat History', ...transcriptLines]
      : []),
  ].join('\n');
}

@Injectable({ providedIn: 'root' })
export class PromptBuilderService {
  private readonly agents = inject(AgentsStore);

  async buildGeneratePrompt(
    input: GeneratePromptInput,
    schema: object,
    retryContext = '',
    skillOverride?: ResolvedSkill | null,
    refinementContext?: RefinementAnswer[],
  ): Promise<ChatPromptTemplate> {
    const retrySection = retryContext
      ? `RETRY INSTRUCTIONS — fix all issues listed below before returning:\n${retryContext}`
      : '';
    const refinementSection = formatRefinementContext(refinementContext);



    const safeSystem = escapeBraces(
      SYSTEM_PROMPT.replace('{schema}', JSON.stringify(schema, null, 2)).replace(
        '{retryContext}',
        retrySection,
      ),
    );
    const skill = skillOverride?.skill.prompt ?? undefined;
    const composedSystem = appendSkillPrompt(safeSystem, skill);

    return ChatPromptTemplate.fromMessages([
      ['system', composedSystem],
      [
        'human',
        [
          'Generate a complete architecture plan for the following application.',
          '',
          'Plan title: {title}',
          'Application idea: {idea}',
          '',
          'Optional technical context (free-form):',
          '{technicalConstraints}',
          '',
          'Optional quality and non-functional context (free-form):',
          '{nfrs}',
          '',
          'Optional technology context (free-form):',
          '{hints}',
          '',
          'Additional context files:',
          '{contextAttachments}',
          ...(refinementSection ? ['', refinementSection] : []),
          '',
          'Return the Plan JSON and nothing else.',
        ].join('\n'),
      ],
    ]).partial(this.inputPartials(input));
  }

  async buildScaffoldPrompt(
    input: GeneratePromptInput,
    retryContext = '',
    skillOverride?: ResolvedSkill | null,
    caps?: ComplexityCaps,
    refinementContext?: RefinementAnswer[],
  ): Promise<ChatPromptTemplate> {
    const retrySection = retryContext
      ? `RETRY INSTRUCTIONS — fix all issues listed below before returning:\n${retryContext}`
      : '';
    const complexitySection = caps
      ? SCAFFOLD_COMPLEXITY_BLOCK.replace('{tier}', caps.tier)
          .replace('{maxLayers}', String(caps.maxLayers))
          .replace('{maxDomains}', String(caps.maxDomains))
      : '';
    const refinementSection = formatRefinementContext(refinementContext);
    const safeSystem = escapeBraces(
      SCAFFOLD_SYSTEM_PROMPT.replace('{shape}', SCAFFOLD_SHAPE)
        .replace('{complexityGuidance}', complexitySection)
        .replace('{retryContext}', retrySection),
    );
    const skill = skillOverride?.skill.prompt ?? undefined;
    const composedSystem = appendSkillPrompt(safeSystem, skill);

    return ChatPromptTemplate.fromMessages([
      ['system', composedSystem],
      [
        'human',
        [
          'Produce the scaffold for the following application.',
          '',
          'Plan title: {title}',
          'Application idea: {idea}',
          '',
          'Optional technical context (free-form):',
          '{technicalConstraints}',
          '',
          'Optional quality and non-functional context (free-form):',
          '{nfrs}',
          '',
          'Optional technology context (free-form):',
          '{hints}',
          '',
          'Additional context files:',
          '{contextAttachments}',
          ...(refinementSection ? ['', refinementSection] : []),
          '',
          'Return the scaffold JSON and nothing else.',
        ].join('\n'),
      ],
    ]).partial(this.inputPartials(input));
  }

  async buildLayerChunkPrompt(
    input: GeneratePromptInput,
    scaffold: z.infer<typeof ScaffoldSchema>,
    retryContext = '',
    skillOverride?: ResolvedSkill | null,
    refinementContext?: RefinementAnswer[],
  ): Promise<ChatPromptTemplate> {
    const layerIds = scaffold.architectureLayerIds.join(', ');
    const contextLines = scaffold.boundedContexts.map((bc) => `- ${bc.id} (${bc.name})`).join('\n');
    const retrySection = retryContext
      ? `RETRY INSTRUCTIONS — fix all issues listed below before returning:\n${retryContext}`
      : '';
    const refinementSection = formatRefinementContext(refinementContext);
    const safeSystem = escapeBraces(
      LAYER_CHUNK_SYSTEM_PROMPT.replace('{shape}', LAYER_SHAPE)
        .replace('{layerIds}', layerIds)
        .replace('{retryContext}', retrySection),
    );
    const skill = skillOverride?.skill.prompt ?? undefined;
    const composedSystem = appendSkillPrompt(safeSystem, skill);

    return ChatPromptTemplate.fromMessages([
      ['system', composedSystem],
      [
        'human',
        [
          'Expand the following architecture layer(s) for the plan.',
          '',
          'Plan title: {title}',
          'Application idea: {idea}',
          '',
          'Bounded contexts (from scaffold):',
          '{boundedContextSummary}',
          '',
          'Requested layer ids: {layerIds}',
          '',
          'Optional technical context (free-form):',
          '{technicalConstraints}',
          '',
          'Optional quality and non-functional context (free-form):',
          '{nfrs}',
          '',
          'Optional technology context (free-form):',
          '{hints}',
          '',
          'Additional context files:',
          '{contextAttachments}',
          ...(refinementSection ? ['', refinementSection] : []),
          '',
          'Return the layer chunk JSON and nothing else.',
        ].join('\n'),
      ],
    ]).partial({
      ...this.inputPartials(input),
      layerIds,
      boundedContextSummary: contextLines || 'none',
    });
  }

  async buildDomainChunkPrompt(
    input: GeneratePromptInput,
    scaffold: z.infer<typeof ScaffoldSchema>,
    retryContext = '',
    skillOverride?: ResolvedSkill | null,
    refinementContext?: RefinementAnswer[],
  ): Promise<ChatPromptTemplate> {
    const domainIds = scaffold.domainIds.join(', ');
    const contextLines = scaffold.boundedContexts.map((bc) => `- ${bc.id} (${bc.name})`).join('\n');
    const retrySection = retryContext
      ? `RETRY INSTRUCTIONS — fix all issues listed below before returning:\n${retryContext}`
      : '';
    const refinementSection = formatRefinementContext(refinementContext);
    const safeSystem = escapeBraces(
      DOMAIN_CHUNK_SYSTEM_PROMPT.replace('{shape}', DOMAIN_SHAPE)
        .replace('{domainIds}', domainIds)
        .replace('{retryContext}', retrySection),
    );
    const skill = skillOverride?.skill.prompt ?? undefined;
    const composedSystem = appendSkillPrompt(safeSystem, skill);

    return ChatPromptTemplate.fromMessages([
      ['system', composedSystem],
      [
        'human',
        [
          'Expand the following domain(s) for the plan.',
          '',
          'Plan title: {title}',
          'Application idea: {idea}',
          '',
          'Bounded contexts (from scaffold):',
          '{boundedContextSummary}',
          '',
          'Requested domain ids: {domainIds}',
          '',
          'Optional technical context (free-form):',
          '{technicalConstraints}',
          '',
          'Optional quality and non-functional context (free-form):',
          '{nfrs}',
          '',
          'Optional technology context (free-form):',
          '{hints}',
          '',
          'Additional context files:',
          '{contextAttachments}',
          ...(refinementSection ? ['', refinementSection] : []),
          '',
          'Return the domain chunk JSON and nothing else.',
        ].join('\n'),
      ],
    ]).partial({
      ...this.inputPartials(input),
      domainIds,
      boundedContextSummary: contextLines || 'none',
    });
  }

  async buildTailPrompt(
    input: GeneratePromptInput,
    scaffold: z.infer<typeof ScaffoldSchema>,
    retryContext = '',
    skillOverride?: ResolvedSkill | null,
    refinementContext?: RefinementAnswer[],
  ): Promise<ChatPromptTemplate> {
    const contextLines = scaffold.boundedContexts.map((bc) => `- ${bc.id} (${bc.name})`).join('\n');
    const domainLines = scaffold.domainIds.join(', ');
    const retrySection = retryContext
      ? `RETRY INSTRUCTIONS — fix all issues listed below before returning:\n${retryContext}`
      : '';
    const refinementSection = formatRefinementContext(refinementContext);
    const safeSystem = escapeBraces(
      TAIL_SYSTEM_PROMPT.replace('{shape}', TAIL_SHAPE).replace('{retryContext}', retrySection),
    );
    const skill = skillOverride?.skill.prompt ?? undefined;
    const composedSystem = appendSkillPrompt(safeSystem, skill);

    return ChatPromptTemplate.fromMessages([
      ['system', composedSystem],
      [
        'human',
        [
          'Produce the tail section (workflows, ADRs, agent tasks) for the plan.',
          '',
          'Plan title: {title}',
          'Application idea: {idea}',
          '',
          'Bounded contexts:',
          '{boundedContextSummary}',
          '',
          'Domain ids already declared: {domainIds}',
          '',
          'Optional technical context (free-form):',
          '{technicalConstraints}',
          '',
          'Optional quality and non-functional context (free-form):',
          '{nfrs}',
          '',
          'Optional technology context (free-form):',
          '{hints}',
          '',
          'Additional context files:',
          '{contextAttachments}',
          ...(refinementSection ? ['', refinementSection] : []),
          '',
          'Return the tail JSON and nothing else.',
        ].join('\n'),
      ],
    ]).partial({
      ...this.inputPartials(input),
      domainIds: domainLines || 'none',
      boundedContextSummary: contextLines || 'none',
    });
  }

  async buildRepairPrompt(
    stage: 'scaffold' | 'layers' | 'domains' | 'tail',
    previousRaw: string,
  ): Promise<ChatPromptTemplate> {
    const shapeByStage: Record<typeof stage, string> = {
      scaffold: REPAIR_SHAPE_SCAFFOLD,
      layers: REPAIR_SHAPE_LAYER,
      domains: REPAIR_SHAPE_DOMAIN,
      tail: REPAIR_SHAPE_TAIL,
    };
    const shape = shapeByStage[stage];
    const safeSystem = escapeBraces(
      `You are a JSON repair agent. Your task is to take a previous (incomplete, truncated, or malformed) JSON response from a ${stage} stage and return ONLY a corrected, complete JSON object for that stage.

Output rules:
- Start with { on line 1 and close every bracket.
- Do NOT add commentary, do NOT wrap in markdown fences, do NOT repeat the previous attempt verbatim.
- The output MUST conform to this shape:

{shape}

━━━ INPUT ━━━

- Stage: ${stage}
- Previous (broken) JSON output:

{previousRaw}

━━━ OUTPUT BUDGET ━━━

- Token budget: keep the repair under ~3k completion tokens. If the previous output exceeded the budget, return a SMALLER version of the same stage:
    * Omit optional spec-kit fields where possible (summary, technicalContext, constitutionCheck, projectStructureTree, complexityTracking)
    * Keep Mermaid diagrams to ≤ 8 lines
    * Trim prose where the schema allows

Return the repaired JSON and nothing else.`.replace('{shape}', shape),
    );

    return ChatPromptTemplate.fromMessages([
      ['system', safeSystem],
      [
        'human',
        [
          'Stage: {stage}',
          '',
          'Previous raw output:',
          '{previousRaw}',
          '',
          'Return the repaired JSON for this stage and nothing else.',
        ].join('\n'),
      ],
    ]).partial({
      stage,
      previousRaw: previousRaw.slice(-2000),
    });
  }

  private resolveRegenInput(
    plan: Plan,
    originalInput?: GeneratePromptInput,
  ): GeneratePromptInput {
    if (originalInput) {
      return {
        title: originalInput.title.trim() || plan.meta.title,
        idea: originalInput.idea,
        technicalConstraints: originalInput.technicalConstraints,
        nfrs: originalInput.nfrs,
        hints: originalInput.hints,
        contextAttachments: originalInput.contextAttachments ?? [],
      };
    }
    return {
      title: plan.meta.title,
      idea: plan.meta.summary,
      technicalConstraints: '',
      nfrs: '',
      hints: '',
      contextAttachments: [],
    };
  }

  private inputPartials(input: GeneratePromptInput): Record<string, string> {
    return {
      title: input.title.trim() || 'unspecified',
      idea: input.idea,
      technicalConstraints: formatOptionalInput(
        input.technicalConstraints,
        'Infer suitable technical constraints and implementation assumptions from the application idea.',
      ),
      nfrs: formatOptionalInput(
        input.nfrs,
        'Derive suitable, measurable non-functional requirements from the application idea.',
      ),
      hints: formatOptionalInput(
        input.hints,
        'Choose and justify an appropriate, specific technology stack for the application.',
      ),
      contextAttachments: this.formatContextAttachments(input.contextAttachments ?? []),
    };
  }

  private formatContextAttachments(attachments: ContextAttachment[]): string {
    if (attachments.length === 0) {
      return 'none provided';
    }

    return attachments
      .map((attachment, index) => {
        const body =
          attachment.extractedText.trim() || attachment.warning || 'No extractable text.';
        return [
          `--- Context file ${index + 1}: ${attachment.name} ---`,
          `Kind: ${attachment.kind}`,
          `MIME type: ${attachment.mimeType}`,
          `Size bytes: ${attachment.size}`,
          attachment.warning ? `Warning: ${attachment.warning}` : '',
          'Content:',
          body,
        ]
          .filter(Boolean)
          .join('\n');
      })
      .join('\n\n');
  }

  async buildRegenerateLayerPrompt(args: {
    layer: unknown;
    currentPlan: Plan;
    editSummary: UserEditSummary;
    isUserAdded: boolean;
    schema: object;
    skillOverride?: ResolvedSkill | null;
    retryContext?: string;
    refinementInstruction?: RefinementInstructionBlock;
    originalInput?: GeneratePromptInput;
  }): Promise<ChatPromptTemplate> {
    const layerRecord = (args.layer ?? {}) as Record<string, unknown>;
    const layerId = typeof layerRecord['id'] === 'string' ? (layerRecord['id'] as string) : 'unknown';
    const layerName = typeof layerRecord['name'] === 'string' ? (layerRecord['name'] as string) : layerId;
    const addedClause = args.isUserAdded
      ? `This layer was ADDED by the user. You MUST keep the "id" and "name" fields verbatim as provided in the input. You MAY expand or improve the other fields (description, techStack, patterns, mermaidDiagram, directoryStructure, summary, technicalContext, constitutionCheck, projectStructureTree, complexityTracking) for coherence with the rest of the plan.`
      : `This layer was modified by the user. Treat the user's changes as guidance — you MAY rewrite the layer for coherence, but stay conservative on the fields the user did not change. The "id" field MUST remain unchanged.`;
    const retrySection = args.retryContext
      ? `RETRY INSTRUCTIONS — fix all issues listed below before returning:\n${args.retryContext}`
      : '';
    const safeSystem = escapeBraces(
      REGENERATE_LAYER_SYSTEM_PROMPT.replace('{shape}', LAYER_SHAPE)
        .replace('{layerId}', layerId)
        .replace('{layerName}', layerName)
        .replace('{addedClause}', addedClause)
        .replace('{editSummary}', args.editSummary.naturalLanguageDigest)
        .replace('{schema}', JSON.stringify(args.schema, null, 2))
        .replace('{retryContext}', retrySection),
    );
    const skill = args.skillOverride?.skill.prompt ?? undefined;
    const composedSystem = appendSkillPrompt(safeSystem, skill);

    const refinementBlock = formatRefinementInstruction(args.refinementInstruction);
    const humanMessage = [
      'Regenerate the architecture layer for this plan.',
      '',
       ...(refinementBlock
         ? [
             '## ACTION REQUIRED — Apply the Refinement Below',
             '',
             'The user explicitly asked for the change described below. Your output MUST reflect it. Do NOT return the existing layer unchanged.',
             '',
             refinementBlock,
             '',
           ]
         : []),
       'Plan title: {title}',
       'Application idea: {idea}',
       'Layer to regenerate: {layerId} ({layerName})',
       '',
      'Existing layer JSON (reference only — you may rewrite any field except id):',
      '{layerJson}',
      '',
      'Optional technical context (free-form):',
      '{technicalConstraints}',
      '',
      'Optional quality and non-functional context (free-form):',
      '{nfrs}',
      '',
      'Optional technology context (free-form):',
      '{hints}',
      '',
      'Additional context files:',
       '{contextAttachments}',
       '',
       'User-edit summary (treat as guidance):',
      '{digest}',
      '',
      'Return the layer JSON and nothing else.',
    ].join('\n');

    return ChatPromptTemplate.fromMessages([
      ['system', composedSystem],
      ['human', humanMessage],
    ]).partial({
      ...this.inputPartials(this.resolveRegenInput(args.currentPlan, args.originalInput)),
      layerId,
      layerName,
      layerJson: escapeBraces(JSON.stringify(args.layer, null, 2)),
      digest: escapeBraces(args.editSummary.naturalLanguageDigest),
    });
  }

  async buildRegenerateDomainPrompt(args: {
    domain: unknown;
    currentPlan: Plan;
    editSummary: UserEditSummary;
    isUserAdded: boolean;
    schema: object;
    skillOverride?: ResolvedSkill | null;
    retryContext?: string;
    refinementInstruction?: RefinementInstructionBlock;
    originalInput?: GeneratePromptInput;
  }): Promise<ChatPromptTemplate> {
    const domainRecord = (args.domain ?? {}) as Record<string, unknown>;
    const domainId = typeof domainRecord['id'] === 'string' ? (domainRecord['id'] as string) : 'unknown';
    const domainName = typeof domainRecord['name'] === 'string' ? (domainRecord['name'] as string) : domainId;
    const addedClause = args.isUserAdded
      ? `This domain was ADDED by the user. You MUST keep the "id" and "name" fields verbatim as provided in the input. You MAY expand or improve the other fields (description, responsibilities, aggregates, domainEvents, directoryPath, components) for coherence with the rest of the plan.`
      : `This domain was modified by the user. Treat the user's changes as guidance — you MAY rewrite the domain for coherence, but stay conservative on the fields the user did not change. The "id" field MUST remain unchanged.`;
    const retrySection = args.retryContext
      ? `RETRY INSTRUCTIONS — fix all issues listed below before returning:\n${args.retryContext}`
      : '';
    const safeSystem = escapeBraces(
      REGENERATE_DOMAIN_SYSTEM_PROMPT.replace('{shape}', DOMAIN_SHAPE)
        .replace('{domainId}', domainId)
        .replace('{domainName}', domainName)
        .replace('{addedClause}', addedClause)
        .replace('{editSummary}', args.editSummary.naturalLanguageDigest)
        .replace('{schema}', JSON.stringify(args.schema, null, 2))
        .replace('{retryContext}', retrySection),
    );
    const skill = args.skillOverride?.skill.prompt ?? undefined;
    const composedSystem = appendSkillPrompt(safeSystem, skill);

    const refinementBlock = formatRefinementInstruction(args.refinementInstruction);
    const humanMessage = [
      'Regenerate the domain for this plan.',
      '',
       ...(refinementBlock
         ? [
             '## ACTION REQUIRED — Apply the Refinement Below',
             '',
             'The user explicitly asked for the change described below. Your output MUST reflect it. Do NOT return the existing domain unchanged.',
             '',
             refinementBlock,
             '',
           ]
         : []),
       'Plan title: {title}',
       'Application idea: {idea}',
       'Domain to regenerate: {domainId} ({domainName})',
       '',
      'Existing domain JSON (reference only — you may rewrite any field except id):',
      '{domainJson}',
      '',
      'Optional technical context (free-form):',
      '{technicalConstraints}',
      '',
      'Optional quality and non-functional context (free-form):',
      '{nfrs}',
      '',
      'Optional technology context (free-form):',
      '{hints}',
      '',
      'Additional context files:',
       '{contextAttachments}',
       '',
       'User-edit summary (treat as guidance):',
      '{digest}',
      '',
      'Return the domain JSON and nothing else.',
    ].join('\n');

    return ChatPromptTemplate.fromMessages([
      ['system', composedSystem],
      ['human', humanMessage],
    ]).partial({
      ...this.inputPartials(this.resolveRegenInput(args.currentPlan, args.originalInput)),
      domainId,
      domainName,
      domainJson: escapeBraces(JSON.stringify(args.domain, null, 2)),
      digest: escapeBraces(args.editSummary.naturalLanguageDigest),
    });
  }

  async buildRegenerateTailPrompt(args: {
    currentPlan: Plan;
    editSummary: UserEditSummary;
    schema: object;
    skillOverride?: ResolvedSkill | null;
    retryContext?: string;
    refinementInstruction?: RefinementInstructionBlock;
    originalInput?: GeneratePromptInput;
  }): Promise<ChatPromptTemplate> {
    const addedIds = args.editSummary.addedElements
      .filter((a) => a.kind === 'workflow' || a.kind === 'adr' || a.kind === 'agentTask')
      .map((a) => `${a.kind}[id=${a.id}, name=${a.name}]`);
    const removedIds = args.editSummary.removedElements
      .filter((e) => e.kind === 'workflow' || e.kind === 'adr' || e.kind === 'agentTask')
      .map((e) => `${e.kind}[id=${e.id}, name=${e.name}]`);
    const addedClause = addedIds.length
      ? `PRESERVE THESE ADDED ELEMENTS VERBATIM (keep id and name; may expand other fields):\n${addedIds.join('\n')}`
      : '';
    const removedClause = removedIds.length
      ? `OMIT THESE REMOVED ELEMENTS (do not re-add in any form):\n${removedIds.join('\n')}`
      : '';
    const retrySection = args.retryContext
      ? `RETRY INSTRUCTIONS — fix all issues listed below before returning:\n${args.retryContext}`
      : '';
    const safeSystem = escapeBraces(
      REGENERATE_TAIL_SYSTEM_PROMPT.replace('{shape}', TAIL_SHAPE)
        .replace('{addedClause}', addedClause)
        .replace('{removedClause}', removedClause)
        .replace('{editSummary}', args.editSummary.naturalLanguageDigest)
        .replace('{schema}', JSON.stringify(args.schema, null, 2))
        .replace('{retryContext}', retrySection),
    );
    const skill = args.skillOverride?.skill.prompt ?? undefined;
    const composedSystem = appendSkillPrompt(safeSystem, skill);

    const refinementBlock = formatRefinementInstruction(args.refinementInstruction);
    const humanMessage = [
      'Regenerate the tail section (workflows, ADRs, agent tasks) for this plan.',
      '',
       ...(refinementBlock
         ? [
             '## ACTION REQUIRED — Apply the Refinement Below',
             '',
             'The user explicitly asked for the change described below. Your output MUST reflect it. Do NOT return the existing tail unchanged.',
             '',
             refinementBlock,
             '',
           ]
         : []),
       'Plan title: {title}',
       'Application idea: {idea}',
       'Existing tail JSON (reference only — you may rewrite any field except preserved-added ids):',
       '{tailJson}',
       '',
       'Optional technical context (free-form):',
       '{technicalConstraints}',
       '',
       'Optional quality and non-functional context (free-form):',
       '{nfrs}',
       '',
       'Optional technology context (free-form):',
       '{hints}',
       '',
       'Additional context files:',
       '{contextAttachments}',
       '',
       'User-edit summary (treat as guidance):',
      '{digest}',
      '',
      'Return the tail JSON and nothing else.',
    ].join('\n');

    return ChatPromptTemplate.fromMessages([
      ['system', composedSystem],
      ['human', humanMessage],
    ]).partial({
      ...this.inputPartials(this.resolveRegenInput(args.currentPlan, args.originalInput)),
      tailJson: escapeBraces(
        JSON.stringify(
          {
            workflows: args.currentPlan.workflows,
            adrs: args.currentPlan.adrs,
            agentTasks: args.currentPlan.agentTasks,
            userStories: args.currentPlan.userStories,
            functionalRequirements: args.currentPlan.functionalRequirements,
            successCriteria: args.currentPlan.successCriteria,
            constitution: args.currentPlan.constitution,
          },
          null,
          2,
        ),
      ),
      digest: escapeBraces(args.editSummary.naturalLanguageDigest),
    });
  }

  async buildRegenerateBoundedContextsPrompt(args: {
    currentPlan: Plan;
    editSummary: UserEditSummary;
    schema: object;
    skillOverride?: ResolvedSkill | null;
    retryContext?: string;
    refinementInstruction?: RefinementInstructionBlock;
    originalInput?: GeneratePromptInput;
  }): Promise<ChatPromptTemplate> {
    const addedIds = args.editSummary.addedElements
      .filter((a) => a.kind === 'boundedContext')
      .map((a) => `${a.kind}[id=${a.id}, name=${a.name}]`);
    const removedIds = args.editSummary.removedElements
      .filter((e) => e.kind === 'boundedContext')
      .map((e) => `${e.kind}[id=${e.id}, name=${e.name}]`);
    const addedClause = addedIds.length
      ? `PRESERVE THESE ADDED BOUNDED CONTEXTS VERBATIM (keep id and name; may expand other fields):\n${addedIds.join('\n')}`
      : '';
    const removedClause = removedIds.length
      ? `OMIT THESE REMOVED BOUNDED CONTEXTS (do not re-add in any form):\n${removedIds.join('\n')}`
      : '';
    const retrySection = args.retryContext
      ? `RETRY INSTRUCTIONS — fix all issues listed below before returning:\n${args.retryContext}`
      : '';
    const safeSystem = escapeBraces(
      REGENERATE_BOUNDED_CONTEXTS_SYSTEM_PROMPT.replace('{shape}', BOUNDED_CONTEXTS_SHAPE)
        .replace('{addedClause}', addedClause)
        .replace('{removedClause}', removedClause)
        .replace('{editSummary}', args.editSummary.naturalLanguageDigest)
        .replace('{schema}', JSON.stringify(args.schema, null, 2))
        .replace('{retryContext}', retrySection),
    );
    const skill = args.skillOverride?.skill.prompt ?? undefined;
    const composedSystem = appendSkillPrompt(safeSystem, skill);

    const refinementBlock = formatRefinementInstruction(args.refinementInstruction);
    const humanMessage = [
      'Regenerate the boundedContexts[] array for this plan.',
      '',
      ...(refinementBlock
        ? [
            '## ACTION REQUIRED — Apply the Refinement Below',
            '',
            'The user explicitly asked for the change described below. Your output MUST reflect it. Do NOT return the existing boundedContexts unchanged when the refinement asks for a new bounded context.',
            '',
            refinementBlock,
            '',
          ]
        : []),
      'Plan title: {title}',
      'Application idea: {idea}',
      '',
      'Existing boundedContexts JSON (return all entries you keep; you may add new ones):',
      '{boundedContextsJson}',
      '',
      'Existing architecture layer ids (every new boundedContext.layer MUST reference one of these):',
      '{layerIds}',
      '',
      'Current systemOverview.boundedContextMap (reference only — you do not edit this string):',
      '{boundedContextMap}',
      '',
      'Optional technical context (free-form):',
      '{technicalConstraints}',
      '',
      'Optional quality and non-functional context (free-form):',
      '{nfrs}',
      '',
      'Optional technology context (free-form):',
      '{hints}',
      '',
      'Additional context files:',
      '{contextAttachments}',
      '',
      'User-edit summary (treat as guidance):',
      '{digest}',
      '',
      'Return the boundedContexts JSON and nothing else.',
    ].join('\n');

    return ChatPromptTemplate.fromMessages([
      ['system', composedSystem],
      ['human', humanMessage],
    ]).partial({
      ...this.inputPartials(this.resolveRegenInput(args.currentPlan, args.originalInput)),
      boundedContextsJson: escapeBraces(JSON.stringify(args.currentPlan.boundedContexts, null, 2)),
      layerIds: escapeBraces(args.currentPlan.architectureLayers.map((l) => l.id).join(', ')),
      boundedContextMap: escapeBraces(args.currentPlan.systemOverview.boundedContextMap ?? ''),
      digest: escapeBraces(args.editSummary.naturalLanguageDigest),
    });
  }

  async buildRegenerateSystemOverviewPrompt(args: {
    currentPlan: Plan;
    editSummary: UserEditSummary;
    schema: object;
    skillOverride?: ResolvedSkill | null;
    retryContext?: string;
    refinementInstruction?: RefinementInstructionBlock;
    originalInput?: GeneratePromptInput;
  }): Promise<ChatPromptTemplate> {
    const addedIds = args.editSummary.addedElements
      .filter((a) => a.kind === 'boundedContext' || a.kind === 'architectureLayer' || a.kind === 'domain')
      .map((a) => `${a.kind}[id=${a.id}, name=${a.name}]`);
    const addedClause = addedIds.length
      ? `The following structural elements were ADDED since the diagrams were last drawn; every one MUST appear in all three diagrams:\n${addedIds.join('\n')}`
      : '';
    const retrySection = args.retryContext
      ? `RETRY INSTRUCTIONS — fix all issues listed below before returning:\n${args.retryContext}`
      : '';
    const safeSystem = escapeBraces(
      REGENERATE_SYSTEM_OVERVIEW_SYSTEM_PROMPT.replace('{shape}', SYSTEM_OVERVIEW_SHAPE)
        .replace('{addedClause}', addedClause)
        .replace('{editSummary}', args.editSummary.naturalLanguageDigest)
        .replace('{schema}', JSON.stringify(args.schema, null, 2))
        .replace('{retryContext}', retrySection),
    );
    const skill = args.skillOverride?.skill.prompt ?? undefined;
    const composedSystem = appendSkillPrompt(safeSystem, skill);

    const refinementBlock = formatRefinementInstruction(args.refinementInstruction);
    const humanMessage = [
      'Refresh the three systemOverview diagram strings for this plan so they include every bounded context (existing AND new).',
      '',
      ...(refinementBlock
        ? [
            '## ACTION REQUIRED — Apply the Refinement Below',
            '',
            'The user explicitly asked for the change described below. Your output MUST reflect it.',
            '',
            refinementBlock,
            '',
          ]
        : []),
      'Plan title: {title}',
      'Application idea: {idea}',
      '',
      'Bounded contexts (existing + any added by the bounded-contexts regen pass):',
      '{boundedContextsSummary}',
      '',
      'Architecture layers (id + name):',
      '{layerSummary}',
      '',
      'Domains (id + name + layer):',
      '{domainSummary}',
      '',
      'Current systemOverview.boundedContextMap (you will overwrite this):',
      '{currentBoundedContextMap}',
      '',
      'Current c4.contextDiagram (you will overwrite this):',
      '{currentContextDiagram}',
      '',
      'Current c4.containerDiagram (you will overwrite this):',
      '{currentContainerDiagram}',
      '',
      'Optional technical context (free-form):',
      '{technicalConstraints}',
      '',
      'Optional quality and non-functional context (free-form):',
      '{nfrs}',
      '',
      'Optional technology context (free-form):',
      '{hints}',
      '',
      'Additional context files:',
      '{contextAttachments}',
      '',
      'User-edit summary (treat as guidance):',
      '{digest}',
      '',
      'Return the systemOverview JSON and nothing else.',
    ].join('\n');

    return ChatPromptTemplate.fromMessages([
      ['system', composedSystem],
      ['human', humanMessage],
    ]).partial({
      ...this.inputPartials(this.resolveRegenInput(args.currentPlan, args.originalInput)),
      boundedContextsSummary: escapeBraces(
        args.currentPlan.boundedContexts
          .map((bc) => `- ${bc.id} (${bc.name}) — layer=${bc.layer}`)
          .join('\n') || '(none)',
      ),
      layerSummary: escapeBraces(
        args.currentPlan.architectureLayers
          .map((l) => `- ${l.id} (${l.name})`)
          .join('\n') || '(none)',
      ),
      domainSummary: escapeBraces(
        args.currentPlan.domains
          .map((d) => `- ${d.id} (${d.name}) — layer=${d.layer}`)
          .join('\n') || '(none)',
      ),
      currentBoundedContextMap: escapeBraces(args.currentPlan.systemOverview.boundedContextMap ?? ''),
      currentContextDiagram: escapeBraces(args.currentPlan.systemOverview.c4.contextDiagram),
      currentContainerDiagram: escapeBraces(args.currentPlan.systemOverview.c4.containerDiagram),
      digest: escapeBraces(args.editSummary.naturalLanguageDigest),
    });
  }

  async buildRegenerateAdditionsPrompt(args: {
    currentPlan: Plan;
    editSummary: UserEditSummary;
    schema: object;
    skillOverride?: ResolvedSkill | null;
    retryContext?: string;
    refinementInstruction?: RefinementInstructionBlock;
    originalInput?: GeneratePromptInput;
  }): Promise<ChatPromptTemplate> {
    const retrySection = args.retryContext
      ? `RETRY INSTRUCTIONS — fix all issues listed below before returning:\n${args.retryContext}`
      : '';
    const safeSystem = escapeBraces(
      REGENERATE_ADDITIONS_SYSTEM_PROMPT.replace('{shape}', REGENERATE_ADDITIONS_SHAPE)
        .replace('{editSummary}', args.editSummary.naturalLanguageDigest)
        .replace('{schema}', JSON.stringify(args.schema, null, 2))
        .replace('{retryContext}', retrySection),
    );
    const skill = args.skillOverride?.skill.prompt ?? undefined;
    const composedSystem = appendSkillPrompt(safeSystem, skill);

    const refinementBlock = formatRefinementInstruction(args.refinementInstruction);
    const humanMessage = [
      'Add any NEW structural elements implied by the refinement instruction.',
      '',
      ...(refinementBlock
        ? [
            '## ACTION REQUIRED — Apply the Refinement Below',
            '',
            'The user explicitly asked for the addition described below. Return any new layers, domains, or bounded contexts implied by it. If the refinement implies no new structural elements, return an empty JSON object: {{}}.',
            '',
            refinementBlock,
            '',
          ]
        : []),
      'Plan title: {title}',
      'Application idea: {idea}',
      '',
      'Existing architecture layer ids (do NOT collide):',
      '{layerIds}',
      '',
      'Existing domain ids (do NOT collide):',
      '{domainIds}',
      '',
      'Existing bounded context ids (do NOT collide):',
      '{boundedContextIds}',
      '',
      'Existing architecture layers (id + name + summary):',
      '{layerSummary}',
      '',
      'Existing domains (id + name + layer):',
      '{domainSummary}',
      '',
      'Existing bounded contexts (id + name + layer):',
      '{boundedContextsSummary}',
      '',
      'Optional technical context (free-form):',
      '{technicalConstraints}',
      '',
      'Optional quality and non-functional context (free-form):',
      '{nfrs}',
      '',
      'Optional technology context (free-form):',
      '{hints}',
      '',
      'Additional context files:',
      '{contextAttachments}',
      '',
      'User-edit summary (treat as guidance):',
      '{digest}',
      '',
      'Return the additions JSON and nothing else. An empty object {{}} is a valid response when nothing new is implied.',
    ].join('\n');

    return ChatPromptTemplate.fromMessages([
      ['system', composedSystem],
      ['human', humanMessage],
    ]).partial({
      ...this.inputPartials(this.resolveRegenInput(args.currentPlan, args.originalInput)),
      layerIds: escapeBraces(args.currentPlan.architectureLayers.map((l) => l.id).join(', ') || '(none)'),
      domainIds: escapeBraces(args.currentPlan.domains.map((d) => d.id).join(', ') || '(none)'),
      boundedContextIds: escapeBraces(
        args.currentPlan.boundedContexts.map((bc) => bc.id).join(', ') || '(none)',
      ),
      layerSummary: escapeBraces(
        args.currentPlan.architectureLayers
          .map((l) => `- ${l.id} (${l.name})`)
          .join('\n') || '(none)',
      ),
      domainSummary: escapeBraces(
        args.currentPlan.domains
          .map((d) => `- ${d.id} (${d.name}) — layer=${d.layer}`)
          .join('\n') || '(none)',
      ),
      boundedContextsSummary: escapeBraces(
        args.currentPlan.boundedContexts
          .map((bc) => `- ${bc.id} (${bc.name}) — layer=${bc.layer}`)
          .join('\n') || '(none)',
      ),
      digest: escapeBraces(args.editSummary.naturalLanguageDigest),
    });
  }

  async buildPdfCreatorPrompt(
    plan: Plan,
    schema: object,
    retryContext = '',
    skillOverrides?: ReadonlyArray<ResolvedSkill | null>,
  ): Promise<ChatPromptTemplate> {
    const retrySection = retryContext
      ? `RETRY INSTRUCTIONS — fix all issues listed below before returning:\n${retryContext}`
      : '';



    const safeSystem = escapeBraces(
      PDF_CREATOR_SYSTEM_PROMPT.replace('{schema}', JSON.stringify(schema, null, 2)).replace(
        '{retryContext}',
        retrySection,
      ),
    );





    const overrides = skillOverrides ?? [];
    let composedSystem = safeSystem;
    for (const override of overrides) {
      const skill = override?.skill.prompt ?? undefined;
      composedSystem = appendSkillPrompt(composedSystem, skill);
    }

    return ChatPromptTemplate.fromMessages([
      ['system', composedSystem],
      [
        'human',
        [
          'Distil the following Plan summary into a single concise PdfDocument.',
          '',
          'Plan summary (only fields relevant to the PDF — diagram strings are kept verbatim so you can reference them by location):',
          '{planJson}',
          '',
          'Return the PdfDocument JSON and nothing else.',
        ].join('\n'),
      ],
    ]).partial({
      planJson: JSON.stringify(summarizeForPdf(plan)),
    });
  }

  async buildPdfHeaderPrompt(
    plan: Plan,
    schema: object,
    skillOverrides?: ReadonlyArray<ResolvedSkill | null>,
  ): Promise<ChatPromptTemplate> {
    const safeSystem = escapeBraces(
      PDF_HEADER_SYSTEM_PROMPT.replace('{schema}', JSON.stringify(schema, null, 2)).replace(
        '{retryContext}',
        '',
      ),
    );

    const overrides = skillOverrides ?? [];
    let composedSystem = safeSystem;
    for (const override of overrides) {
      const skill = override?.skill.prompt ?? undefined;
      composedSystem = appendSkillPrompt(composedSystem, skill);
    }

    return ChatPromptTemplate.fromMessages([
      ['system', composedSystem],
      [
        'human',
        [
          'Distil the following Plan summary into the HEADER call of a section-stitching PDF pipeline. Emit the document header AND the first two sections (Executive Summary, System Overview).',
          '',
          'Plan summary (only fields relevant to the PDF — diagram strings are kept verbatim so you can reference them by location):',
          '{planJson}',
          '',
          'Return the PdfDocument JSON and nothing else.',
        ].join('\n'),
      ],
    ]).partial({
      planJson: JSON.stringify(summarizeForPdf(plan)),
    });
  }

  async buildPdfSectionPrompt(args: {
    plan: Plan;
    priorSections: readonly unknown[];
    targetSectionKinds: readonly string[];
    schema: object;
    skillOverrides?: ReadonlyArray<ResolvedSkill | null>;
  }): Promise<ChatPromptTemplate> {
    const safeSystem = escapeBraces(
      PDF_SECTION_SYSTEM_PROMPT.replace('{schema}', JSON.stringify(args.schema, null, 2)).replace(
        '{retryContext}',
        '',
      ),
    );

    const overrides = args.skillOverrides ?? [];
    let composedSystem = safeSystem;
    for (const override of overrides) {
      const skill = override?.skill.prompt ?? undefined;
      composedSystem = appendSkillPrompt(composedSystem, skill);
    }

    const targetList = args.targetSectionKinds.map((k, i) => `${i + 1}. "${k}"`).join('\n');
    const priorJson = JSON.stringify(args.priorSections, null, 2);

    const unescapedTemplate = PDF_SECTION_USER_TEMPLATE
      .replace('{planJson}', '__PLAN_JSON_PLACEHOLDER__')
      .replace('{priorSectionsJson}', '__PRIOR_SECTIONS_PLACEHOLDER__')
      .replace('{targetSectionKinds}', '__TARGET_KINDS_PLACEHOLDER__');

    const escapedTemplate = escapeBraces(unescapedTemplate);
    const restoredTemplate = escapedTemplate
      .replace('__PLAN_JSON_PLACEHOLDER__', '{planJson}')
      .replace('__PRIOR_SECTIONS_PLACEHOLDER__', '{priorSectionsJson}')
      .replace('__TARGET_KINDS_PLACEHOLDER__', '{targetSectionKinds}');

    return ChatPromptTemplate.fromMessages([
      ['system', composedSystem],
      ['human', restoredTemplate],
    ]).partial({
      planJson: JSON.stringify(summarizeForPdf(args.plan)),
      priorSectionsJson: priorJson,
      targetSectionKinds: targetList,
    });
  }

  async buildSectionRepairPrompt(args: {
    stage: 'scaffold' | 'layers' | 'domains' | 'tail';
    sectionId?: string;
    currentSection: unknown;
    findings: readonly AuditFinding[];
    planSummary: {
      meta: { title: string };
      boundedContextIds: readonly string[];
      architectureLayerIds: readonly string[];
      domainIds: readonly string[];
    };
     retryContext?: string;
     skillOverride?: ResolvedSkill | null;
     refinementInstruction?: RefinementInstructionBlock;
   }): Promise<ChatPromptTemplate> {
    const stagePromptByKind: Record<typeof args.stage, string> = {
      scaffold: SCAFFOLD_SYSTEM_PROMPT,
      layers: LAYER_CHUNK_SYSTEM_PROMPT,
      domains: DOMAIN_CHUNK_SYSTEM_PROMPT,
      tail: TAIL_SYSTEM_PROMPT,
    };
    const stageShapeByKind: Record<typeof args.stage, string> = {
      scaffold: SCAFFOLD_SHAPE,
      layers: LAYER_SHAPE,
      domains: DOMAIN_SHAPE,
      tail: TAIL_SHAPE,
    };
    const stagePrompt = stagePromptByKind[args.stage];
    const stageShape = stageShapeByKind[args.stage];

    const retrySection = args.retryContext
      ? `RETRY INSTRUCTIONS — fix all issues listed below before returning:\n${args.retryContext}`
      : '';
    const complexityGuidance = '';
    const layerIds = args.stage === 'layers' ? (args.sectionId ?? '') : '';
    const domainIds = args.stage === 'domains' ? (args.sectionId ?? '') : '';

    const findingsJsonRaw = JSON.stringify(args.findings, null, 2);
    const findingsBlock =
      args.findings.length === 0
        ? ''
        : `

━━━ FINDINGS TO ADDRESS ━━━

The following audit findings target this section. Address EVERY one — prefer the smallest change that satisfies each finding.

${escapeBraces(findingsJsonRaw)}

Return the corrected section JSON and nothing else. Do not echo the surrounding plan; the runner will stitch your output back in place.`;

    const baseSystem = stagePrompt
      .replace('{shape}', stageShape)
      .replace('{complexityGuidance}', complexityGuidance)
      .replace('{layerIds}', layerIds)
      .replace('{domainIds}', domainIds)
      .replace('{retryContext}', retrySection);

    const safeSystem = escapeBraces(baseSystem) + findingsBlock;
    const skill = args.skillOverride?.skill.prompt ?? undefined;
    const composedSystem = appendSkillPrompt(safeSystem, skill);

    const planSummaryText = [
      `Plan title: ${args.planSummary.meta.title || 'unspecified'}`,
      `Bounded context ids: ${args.planSummary.boundedContextIds.join(', ') || 'none'}`,
      `Architecture layer ids: ${args.planSummary.architectureLayerIds.join(', ') || 'none'}`,
      `Domain ids: ${args.planSummary.domainIds.join(', ') || 'none'}`,
    ].join('\n');
    const sectionJsonText = JSON.stringify(args.currentSection, null, 2);





     const humanTemplate = [
       `Section under repair: {stage}{sectionIdClause}`,
       ...(formatRefinementInstruction(args.refinementInstruction)
         ? ['', formatRefinementInstruction(args.refinementInstruction)]
         : []),
       '',
       'Plan summary (sibling ids only — do not duplicate their bodies):',
      '{planSummary}',
      '',
      'Current section JSON (this is the only section the runner is stitching back):',
      '{sectionJson}',
      '',
      'Findings to address:',
      '{findingsJson}',
      '',
      'Return the corrected section JSON and nothing else. Do not return the full plan.',
    ].join('\n');

    return ChatPromptTemplate.fromMessages([
      ['system', composedSystem],
      ['human', humanTemplate],
    ]).partial({
      stage: args.stage,
      sectionIdClause: args.sectionId ? ` (id: ${escapeBraces(args.sectionId)})` : '',
      planSummary: escapeBraces(planSummaryText),
      sectionJson: escapeBraces(sectionJsonText),
      findingsJson: escapeBraces(findingsJsonRaw),
    });
  }
}

const PDF_SUMMARY_STRING_CAP = 280;
const PDF_SUMMARY_INVARIANTS_CAP = 3;
const PDF_SUMMARY_PUBLIC_API_CAP = 4;
const PDF_SUMMARY_HANDLED_BY_CAP = 3;
const PDF_SUMMARY_LANGUAGE_CAP = 8;
const PDF_SUMMARY_RESPONSIBILITIES_CAP = 4;

function capString(value: string | undefined, cap: number): string | undefined {
  if (value === undefined) return undefined;
  if (value.length <= cap) return value;
  return value.slice(0, cap) + '…[truncated]';
}

function capList<T>(items: readonly T[] | undefined, cap: number): T[] | undefined {
  if (items === undefined) return undefined;
  return items.slice(0, cap);
}

function capRecord(
  value: Record<string, string> | undefined,
  cap: number,
): Record<string, string> | undefined {
  if (value === undefined) return undefined;
  const entries = Object.entries(value);
  if (entries.length <= cap) return value;
  return Object.fromEntries(entries.slice(0, cap));
}

export function summarizeForPdf(plan: Plan): unknown {
  const componentsCount = plan.domains.reduce(
    (sum, d) => sum + (d.components?.length ?? 0),
    0,
  );
  const aggregatesCount = plan.domains.reduce(
    (sum, d) => sum + (d.aggregates?.length ?? 0),
    0,
  );
  const domainEventsCount = plan.domains.reduce(
    (sum, d) => sum + (d.domainEvents?.length ?? 0),
    0,
  );
  const unitTestsCount = plan.domains.reduce(
    (sum, d) =>
      sum +
      (d.components ?? []).reduce(
        (inner, c) => inner + (c.tddSpec?.unitTests?.length ?? 0),
        0,
      ),
    0,
  );
  const integrationTestsCount = plan.domains.reduce(
    (sum, d) =>
      sum +
      (d.components ?? []).reduce(
        (inner, c) => inner + (c.tddSpec?.integrationTests?.length ?? 0),
        0,
      ),
    0,
  );

  return {
    meta: {
      title: plan.meta.title,
      summary: capString(plan.meta.summary, PDF_SUMMARY_STRING_CAP),
      model: plan.meta.model,
    },
    kpis: {
      architectureLayers: plan.architectureLayers.length,
      boundedContexts: plan.boundedContexts.length,
      domains: plan.domains.length,
      components: componentsCount,
      aggregates: aggregatesCount,
      domainEvents: domainEventsCount,
      adrs: plan.adrs.length,
      workflows: plan.workflows.length,
      agentTasks: plan.agentTasks.length,
      unitTests: unitTestsCount,
      integrationTests: integrationTestsCount,
    },
    systemOverview: {
      purpose: capString(plan.systemOverview.purpose, PDF_SUMMARY_STRING_CAP),
      context: capString(plan.systemOverview.context, PDF_SUMMARY_STRING_CAP),
      keyActors: plan.systemOverview.keyActors,
      constraints: capList(plan.systemOverview.constraints, PDF_SUMMARY_LANGUAGE_CAP),
      nfrs: capList(plan.systemOverview.nfrs, PDF_SUMMARY_LANGUAGE_CAP),
      boundedContextMap: plan.systemOverview.boundedContextMap,
      c4: plan.systemOverview.c4,
    },
    boundedContexts: plan.boundedContexts.map((bc) => ({
      id: bc.id,
      name: bc.name,
      description: capString(bc.description, PDF_SUMMARY_STRING_CAP),
      layer: bc.layer,
      ubiquitousLanguage: capRecord(bc.ubiquitousLanguage, PDF_SUMMARY_LANGUAGE_CAP),
    })),
    architectureLayers: plan.architectureLayers.map((layer) => ({
      id: layer.id,
      name: layer.name,
      description: capString(layer.description, PDF_SUMMARY_STRING_CAP),
      techStack: layer.techStack,
      patterns: layer.patterns,
      summary: capString(layer.summary, PDF_SUMMARY_STRING_CAP),
      technicalContext: layer.technicalContext,
      constitutionCheck: capList(layer.constitutionCheck, PDF_SUMMARY_LANGUAGE_CAP),
      complexityTracking: layer.complexityTracking?.map((row) => ({
        violation: capString(row.violation, PDF_SUMMARY_STRING_CAP) ?? row.violation,
        whyNeeded: capString(row.whyNeeded, PDF_SUMMARY_STRING_CAP) ?? row.whyNeeded,
        simplerAlternativeRejected:
          capString(row.simplerAlternativeRejected, PDF_SUMMARY_STRING_CAP) ??
          row.simplerAlternativeRejected,
      })),
      mermaidDiagram: layer.mermaidDiagram,
      componentTreeDiagram: layer.componentTreeDiagram,
      moduleDependenciesDiagram: layer.moduleDependenciesDiagram,
      stateManagementDiagram: layer.stateManagementDiagram,
      apiContractDiagram: layer.apiContractDiagram,
    })),
    domains: plan.domains.map((d) => ({
      id: d.id,
      name: d.name,
      description: capString(d.description, PDF_SUMMARY_STRING_CAP),
      layer: d.layer,
      responsibilities: capList(d.responsibilities, PDF_SUMMARY_RESPONSIBILITIES_CAP),
      aggregates: (d.aggregates ?? []).map((agg) => ({
        id: agg.id,
        name: agg.name,
        rootEntity: agg.rootEntity,
        description: capString(agg.description, PDF_SUMMARY_STRING_CAP),
        invariants: capList(agg.invariants, PDF_SUMMARY_INVARIANTS_CAP),
      })),
      domainEvents: (d.domainEvents ?? []).map((ev) => ({
        id: ev.id,
        name: ev.name,
        description: capString(ev.description, PDF_SUMMARY_STRING_CAP),
        triggeredBy: capString(ev.triggeredBy, PDF_SUMMARY_STRING_CAP),
        handledBy: capList(ev.handledBy, PDF_SUMMARY_HANDLED_BY_CAP),
      })),
      directoryPath: d.directoryPath,
      components: (d.components ?? []).map((c) => ({
        id: c.id,
        name: c.name,
        type: c.type,
        layer: c.layer,
        responsibilities: capList(c.responsibilities, PDF_SUMMARY_RESPONSIBILITIES_CAP),
        publicApi: capList(c.publicApi, PDF_SUMMARY_PUBLIC_API_CAP),
        tddSpec: c.tddSpec
          ? {
              unitTestsCount: c.tddSpec.unitTests?.length ?? 0,
              integrationTestsCount: c.tddSpec.integrationTests?.length ?? 0,
            }
          : undefined,
      })),
    })),
    workflows: plan.workflows.map((w) => ({
      id: w.id,
      name: w.name,
      description: capString(w.description, PDF_SUMMARY_STRING_CAP),
      steps: capList(w.steps, PDF_SUMMARY_LANGUAGE_CAP),
      domainIds: w.domainIds,
    })),
    adrs: plan.adrs.map((a) => ({
      id: a.id,
      title: a.title,
      status: a.status,
      context: capString(a.context, PDF_SUMMARY_STRING_CAP),
      decision: capString(a.decision, PDF_SUMMARY_STRING_CAP),
      consequences: capList(a.consequences, PDF_SUMMARY_LANGUAGE_CAP),
    })),
    agentTasks: plan.agentTasks.map((t) => ({
      id: t.id,
      title: t.title,
      description: capString(t.description, PDF_SUMMARY_STRING_CAP),
    })),
  };
}
