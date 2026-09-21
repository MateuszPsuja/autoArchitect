# Auto Architect - Spec-kit planner

> **Revision notes:** This version closes all critical implementation gaps from v1:
> named libraries, full prompt templates, schema validation strategy, state ownership rules,
> and a complete error taxonomy. Sections changed from v1 are marked **[REVISED]** or **[NEW]**.

---

## Table of Contents

0. [Agent Quick-Start](#0-agent-quick-start) **[NEW]**
1. [Overview](#1-overview)
2. [Scope and Non-Goals](#2-scope-and-non-goals)
3. [Tech Stack](#3-tech-stack) **[REVISED]**
4. [High-Level Architecture](#4-high-level-architecture)
5. [OpenRouter Integration](#5-openrouter-integration) **[REVISED]**
6. [Data Model](#6-data-model-client-side)
7. [State Management](#7-state-management) **[NEW]**
8. [User Flows](#8-user-flows)
9. [Markdown Output Structure](#9-markdown-output-structure)
10. [Error Handling](#10-error-handling) **[NEW]**
11. [UI States](#11-ui-states) **[NEW]**
12. [Non-Functional Requirements](#12-non-functional-requirements)
13. [Implementation Order](#13-implementation-order-for-coding-agents) **[REVISED]**
14. [Testing Strategy](#14-testing-strategy) **[NEW]**

---

## 0. Agent Quick-Start [NEW]

> **Read this section before any other.** It contains the rules and conventions that apply to
> every file you create or modify. Refer back to it when in doubt.

### 0.1 Companion File

Create `AGENTS.md` (or `CLAUDE.md` for Claude-based agents) at the repo root. Copy this
entire Section 0 verbatim into that file. Most coding agents auto-load root-level `AGENTS.md`
or `CLAUDE.md`, so rules here apply even when the full spec is not in context.

### 0.2 Stack at a Glance

| Concern | Library / Pattern |
|---|---|
| Framework | Angular 17+ standalone components |
| Reactive state | NgRx `signalStore()` — mutations only via `patchState()` |
| LLM calls | LangChain.js `ChatOpenAI` → OpenRouter base URL |
| Agentic pipeline | LangGraph.js `StateGraph` |
| Schema | Zod — source of truth; TypeScript types inferred via `z.infer` |
| UI components | PrimeNG Aura preset |
| Zip | JSZip |
| Diagrams | mermaid (single init in `AppComponent`) |

### 0.3 File & Symbol Naming Conventions

- Feature components live in `src/app/features/<feature-name>/`.
- Core services and stores live in `src/app/core/`.
- File names use **kebab-case**: `project.store.ts`, `plan-schema.service.ts`.
- Class names use **PascalCase**: `ProjectStore`, `PlanSchemaService`.
- Angular DI token: `providedIn: 'root'` for all core services.
- Unit test files are **co-located**: `plan-schema.service.spec.ts` next to `plan-schema.service.ts`.
- Each step in Section 13 lists its exact target file paths — use those names exactly.

### 0.4 Forbidden Patterns

The following are **hard constraints**. Do not use them anywhere, even if a library suggests it:

| Forbidden | Use instead |
|---|---|
| `NgModule` declarations | Standalone component `imports: []` array |
| `BehaviorSubject` / `ReplaySubject` | `signal()` or NgRx `signalStore()` |
| `innerHTML` without sanitisation | `DOMPurify.sanitize()` then `DomSanitizer.bypassSecurityTrustHtml()` |
| Persisting `apiKey` outside `localStorage` during development | Store the development `apiKey` only in `arc-planner:config`; wipe it on `forgetKey()` |
| Modifying store state directly (e.g. `store.plan = x`) | `patchState(store, { plan: x })` inside `withMethods()` |
| Direct `fetch()` or `XMLHttpRequest` | Angular `HttpClient` for REST; LangChain for LLM |
| Raw `zodToJsonSchema` output embedded in source | Inject via `PlanSchemaService.jsonSchema` |
| Any backend / server-side code | Frontend-only; no Node server, no SSR |
| `console.error` as the sole error path | Always surface errors through `ProjectStore.setError()` |

### 0.5 localStorage Key Registry

| Key | Content | Persisted slices |
|---|---|---|
| `arc-planner:plan` | Active `Plan` JSON | `plan` |
| `arc-planner:config` | `{ apiKey, selectedModel, defaultTemperature, defaultMaxTokens }` | development config, including API key |
| `arc-planner:saved-plans` | `SavedPlanEntry[]` | `savedPlans` |

Development builds persist `apiKey` in `arc-planner:config` so local reloads keep the provider configured. `forgetKey()` must clear it.

### 0.6 Definition of Done (Full App)

The implementation is complete when all of the following pass without error:

- [ ] App loads at `/` and redirects to `/planner` with no console errors.
- [ ] User can enter an API key, select a model, type an idea, and click **Generate Plan**.
- [ ] Streaming tokens appear in the UI during generation; token count updates live.
- [ ] A valid `Plan` is stored and the file tree populates with correct paths.
- [ ] User can edit a markdown file in the editor; the `*` indicator appears on the file tree node.
- [ ] Clicking **Download zip** produces a `.zip` containing `plan.json` and all `docs/**/*.md` files.
- [ ] Saving a plan, navigating to `/plans`, and loading it restores the full plan state.
- [ ] Refreshing the page rehydrates the plan from `localStorage` with no data loss.

---

---

## 1. Overview

A frontend-only Angular tool that calls OpenRouter to generate a detailed architecture plan
for any software application and exports it as a structured set of markdown files.

**Primary users:** Developers and coding agents. They supply an OpenRouter API key and a
high-level idea; they receive granular docs for frontend, backend, and shared
components/services that can be implemented directly.

---

## 2. Scope and Non-Goals

### In Scope

- Single-page Angular 17+ application using standalone components.
- User pastes OpenRouter API key into the UI (no backend; personal tool only).
- User describes the target application (idea, constraints, tech preferences).
- App calls `POST https://openrouter.ai/api/v1/chat/completions` with a structured planning
  prompt and receives a normalized `Plan` JSON object.
- App validates the `Plan` client-side with **Zod**.
- App maps the plan into a `docs/` file tree of markdown strings held in memory.
- User can inspect, edit, and regenerate individual sections without losing the full plan.
- User can download a zip of all `.md` files plus the canonical `plan.json`.

### Out of Scope (v1)

- Any backend, database, or server-side persistence.
- Multi-user, team features, auth, or access control.
- Real-time collaboration or shared editing.
- Automatic Git sync (user handles that manually).

---

## 3. Tech Stack [REVISED]

| Concern | Choice | Notes |
|---|---|---|
| Framework | Angular 17+ | Standalone components only; no NgModules for new code |
| Language | TypeScript 5+ | Strict mode enabled |
| Build | Angular CLI | `ng build` / `ng serve` |
| Reactive state | **NgRx Signals** (`npm install @ngrx/signals`) | `signalStore()` for all feature stores; `withState()`, `withComputed()`, `withMethods()`, `withHooks()` features; use `patchState()` for mutations. Plain `signal()` / `computed()` allowed in components for local-only UI state. No `BehaviorSubject`. |
| HTTP | Angular `HttpClient` | For OpenRouter `/models` fetch only; all generation traffic goes through LangChain |
| LLM client | **LangChain.js** (`npm install @langchain/core @langchain/openai`) | `ChatOpenAI` pointed at OpenRouter base URL; handles message formatting, streaming, and token usage |
| Agentic graph | **LangGraph.js** (`npm install @langchain/langgraph`) | `StateGraph` orchestrates plan generation, validation, and selective domain regeneration as discrete nodes |
| Schema validation | **Zod** (`npm install zod`) | Runtime validation of `Plan` JSON; shared between prompt builder, LangChain structured output, and Zod-derived JSON schema injected into prompts |
| Zip generation | **JSZip** (`npm install jszip`) | `Blob` → `URL.createObjectURL` → `<a download>` |
| Mermaid rendering | **mermaid** (`npm install mermaid`) | Initialise once in `AppComponent`; render per diagram in `MermaidPreviewComponent` using `afterNextRender()` (Angular 17 SSR-safe hook) |
| Markdown editing | `p-textarea` with monospace font | No external editor dependency for v1 |
| Markdown preview | `innerHTML` with sanitisation | Use Angular `DomSanitizer.bypassSecurityTrustHtml` only after sanitising with `DOMPurify` |
| Styling | **PrimeNG** (`npm install primeng`) | Use the `Aura` preset; configure via `providePrimeNG({ theme: { preset: Aura } })` in `app.config.ts`; dark/light mode via PrimeNG's class-based `darkModeSelector` |

---

## 4. High-Level Architecture

### 4.1 Logical Modules

**core/**
- `OpenRouterClientService` — `GET /api/v1/models` model list fetch only
- `PlanSchemaService` — Zod schema, runtime validation, and `zodToJsonSchema` export
- `ProjectStore` — NgRx `signalStore()`: plan, apiKey, models, loading, error, streamBuffer, tokenStats, savedPlans, provider config, markdownOverrides; localStorage sync via `withHooks()`
- `ExportService` — markdown string generation and JSZip packaging
- `PromptBuilderService` — builds LangChain prompt templates and injects Zod-derived schema
- `PlannerGraphService` — LangGraph `StateGraph` for plan generation: nodes `buildPrompt → callLLM → validatePlan → handleError`; conditional retry edges on validation failure (max 2 retries)
- `RegenerateGraphService` — LangGraph `StateGraph` for selective domain regeneration: nodes `buildRegenPrompt → callLLM → validatePlan → mergeDomain`

**features/project-input/**
- `ProjectInputComponent` — API key, model selector, project idea form
- `ConstraintsFormComponent` — non-functional requirements, tech preferences

**features/planner/**
- `GeneratePlanComponent` — orchestrates graph execution and loading state
- `RegenerateSectionComponent` — selective domain regeneration

**features/editor/**
- `PlanEditorComponent` — tabbed editor; file tree on left, editor and preview on right
- `MarkdownPreviewComponent` — rendered markdown with Mermaid diagram support

**features/diagrams/**
- `ArchitectureTreeComponent` — tree/table view of plan structure
- `MermaidPreviewComponent` — live diagram preview

**features/export/**
- `ExportPanelComponent` — file list, zip download, individual file download

**features/provider-config/**
- `ProviderConfigComponent` — API key input, model selector, default temperature and max-token settings, "Forget Key" button; persists development settings to localStorage key `arc-planner:config`

**features/saved-plans/**
- `SavedPlansComponent` — paginated list of all localStorage-persisted plans
- `SavedPlanCardComponent` — card showing plan title, save date, model used, token totals; actions: Load, Delete, Export zip

### 4.2 Component Style

- All components are Angular standalone components, imported directly by other components
  and routes.
- Routing: three top-level routes — `/planner` (main workspace), `/config` (provider
  configuration), `/plans` (saved plans library). `/` redirects to `/planner`.
- Internal workspace sections controlled by tabs (`p-tabview`).
- State is managed via **NgRx SignalStore** (`signalStore()`). No `BehaviorSubject` anywhere.
- Local UI-only state (e.g. dialog open flag) may use plain `signal()` inside the component.

---

## 5. OpenRouter + LangChain + LangGraph Integration [REVISED]

### 5.1 LangChain ChatOpenAI Configuration

All LLM calls are made through **LangChain.js** using `ChatOpenAI` pointed at the
OpenRouter base URL. `OpenRouterClientService` is responsible only for the
`GET /api/v1/models` model-list fetch via Angular `HttpClient`.

`ChatOpenAI` is configured with the user's API key, selected model id, temperature,
max tokens, and `streaming: true`. The `configuration.baseURL` is set to
`https://openrouter.ai/api/v1` with `HTTP-Referer` and `X-Title` default headers
for OpenRouter attribution. A factory function in `PlannerGraphService` constructs
the instance fresh for each graph run, picking values from `ProjectStore`.

### 5.2 Model List

Models are fetched at runtime from `GET https://openrouter.ai/api/v1/models` using the
user's API key via Angular `HttpClient` in `OpenRouterClientService`. Each entry exposes
an `id` (e.g. `openai/gpt-4.1`), a display `name`, and a `contextLength`. This keeps
the list always up to date with what OpenRouter supports.

- While models are loading, the model `p-select` shows a `p-skeleton` placeholder.
- On error (e.g. invalid key), a `p-message` severity `"warn"` is shown and the selector
  stays empty.
- The user can type a free-form model ID into a fallback `p-inputtext` if the fetch fails.
- The fetched list is **not** persisted to localStorage — it is re-fetched each session.

### 5.3 PlannerGraphService — LangGraph StateGraph

The full plan generation pipeline is a **LangGraph `StateGraph`** whose typed state
holds: the original user input, the raw streamed LLM output, the validated `Plan` (or
`null`), a `PlannerError` (or `null`), and a retry counter.

The graph has four nodes:

- **buildPrompt** — uses `PromptBuilderService` to assemble the generation `ChatPromptTemplate` with the Zod-derived JSON schema injected as a variable.
- **callLLM** — invokes `ChatOpenAI.stream()`; each token chunk is appended to `ProjectStore` via `appendStream()` for live UI feedback.
- **validatePlan** — strips any accidental markdown fences from the output, calls `JSON.parse`, then validates with `PlanSchema.safeParse`.
- **handleError** — maps failures to a `PlannerError` and increments the retry counter.

Conditional edges after `validatePlan`:
- Success → END
- Schema validation failure → back to `buildPrompt` with Zod error paths injected into `{retryContext}` (maximum 2 retries)
- Any other error → END (surface to UI)

Graph execution is triggered from `GeneratePlanComponent` via
`PlannerGraphService.run(input)`, which returns an `AsyncIterable` of state snapshots.
The component iterates snapshots using `from()` + `toObservable()` and calls the
appropriate `ProjectStore` methods.

### 5.4 RegenerateGraphService — Domain Regeneration Graph

Selective domain regeneration uses a separate `StateGraph` whose state holds:
the full current plan, the target `domainId`, user instructions, the raw LLM output,
the updated plan (or `null`), an error, and a retry counter.

Nodes: `buildRegenPrompt → callLLM → validatePlan → mergeDomain`. The `mergeDomain`
node replaces only the matching domain in the current plan, then calls
`ProjectStore.clearDomainOverrides()` for all files belonging to that domain.

### 5.5 Prompt Templates

`PromptBuilderService` creates **LangChain `ChatPromptTemplate`** objects. The
Zod-derived JSON schema is injected once at service construction via
`zodToJsonSchema(PlanSchema)`.

#### Generation Template

A two-message template (system + human).

The **system message** instructs the model to act as a senior software architect,
return only a single valid JSON object conforming to the Plan schema, produce valid
Mermaid syntax in every diagram field, include at least one acceptance criterion per
component, use realistic names, and record uncertain decisions as ADRs with status
`proposed`. It accepts a `{retryContext}` variable (empty on the first attempt;
populated with Zod error paths on retries for self-correction) and a `{planSchema}`
variable containing the full JSON schema string.

The **human message** accepts `{userIdea}`, `{techHints}`, `{nfrs}`, and
`{constraints}` variables and asks the model to generate the full Plan JSON.

#### Regeneration Template

A two-message template. The system message instructs the model to return a complete
Plan JSON. The human message passes in the full serialised `{currentPlan}`, the
`{domainId}` to replace, and `{instructions}` from the user, asking for the entire
Plan JSON back with only that domain replaced and no markdown or preamble.

#### 5.5.1 Worked Example (Generation)

Below is a **trimmed** illustration of what `PromptBuilderService` produces. The
`{planSchema}` variable is replaced with the full `zodToJsonSchema` output at runtime.

**System message (condensed):**
```
You are a senior software architect. Return ONLY a single valid JSON object that
conforms exactly to the Plan schema below. Do not wrap it in markdown fences.
Produce valid Mermaid syntax in every mermaidDiagram field.
Include at least one acceptance criterion per component.
Use realistic names. Record uncertain decisions as ADRs with status "proposed".

Retry context (empty on first attempt): {retryContext}

Plan JSON schema:
{planSchema}
```

**Human message:**
```
Generate a complete architecture Plan for the following application.

Idea: {userIdea}
Tech hints: {techHints}
NFRs: {nfrs}
Constraints: {constraints}

Return the Plan JSON and nothing else.
```

**Expected response shape (first ~4 lines):**
```json
{
  "meta": { "title": "...", "shortSummary": "...", "assumptions": [], "risks": [] },
  "system": { ... },
  ...
}
```

> **Key rule:** the LLM must return raw JSON starting with `{` on line 1 — no preamble,
> no markdown fences, no trailing text. The `validatePlan` node in `PlannerGraphService`
> strips accidental fences before calling `JSON.parse`, but zero fences is the goal.



### 5.6 Streaming and Progress

Because `streaming: true` is set on `ChatOpenAI`, token chunks arrive incrementally.
`callLLM` nodes pipe chunks into `ProjectStoreService.streamBuffer` (a `signal<string>`)
which the UI reads to show a live token counter and partial output preview.

### 5.7 Token Budget Guard

Before any regeneration call, the character length of the serialised current plan is
divided by 4 to estimate token count. If the estimate exceeds 80,000 tokens, a
`p-message` severity `"warn"` is displayed showing the estimated token count and asking
the user to confirm before the call is made.

---

## 6. Data Model (Client-Side)

The `Plan` JSON object is the **single source of truth**. Markdown files and diagrams are
pure projections of this model. The Zod schema is the authoritative definition; the
TypeScript interfaces below are derived from it.

### 6.1 Plan Schema (Zod)

`PlanSchemaService` owns a Zod schema defined in `src/core/plan.schema.ts`. The schema
is the authoritative contract; TypeScript types are inferred from it via `z.infer`.

The TypeScript shapes below are **derived from the Zod schema** and shown here as agent anchors.
Do not hand-write these interfaces — use `z.infer<typeof PlanSchema>` and friends.

```typescript
// src/core/plan.schema.ts  (representative stubs — derive actual types via z.infer)

type ComponentLayer = 'page' | 'component' | 'service' | 'store' | 'module' | 'job' | 'repo' | 'utility';
type ContainerType  = 'spa' | 'api' | 'db' | 'service' | 'queue' | 'other';
type AdrStatus      = 'proposed' | 'accepted' | 'rejected' | 'superseded';

interface ComponentSpec {
  id:                 string;        // kebab-case unique within plan
  name:               string;
  layer:              ComponentLayer;
  description:        string;
  inputs:             string[];
  outputs:            string[];
  dependencies:       string[];      // ids of other ComponentSpecs or npm packages
  errorHandling:      string;
  acceptanceCriteria: string[];      // min length 1
  outOfScope:         string[];
}

interface ContainerSpec {
  id:            string;
  name:          string;
  type:          ContainerType;
  techStack:     string[];
  responsibilities: string[];
  externalDeps:  string[];
  components:    ComponentSpec[];
  mermaidDiagram: string;            // valid Mermaid syntax string
}

interface DomainArea {
  id:         string;
  name:       string;
  overview:   string;
  containers: ContainerSpec[];
}

interface WorkflowSpec {
  id:            string;
  name:          string;
  description:   string;
  steps:         string[];
  mermaidDiagram: string;
}

interface AdrRecord {
  id:           string;
  title:        string;
  status:       AdrStatus;
  context:      string;
  decision:     string;
  consequences: string;
}

interface AgentTaskSpec {
  id:                 string;
  title:              string;
  description:        string;
  targetFile:         string;        // repo-relative path
  dependencies:       string[];      // ids of prerequisite AgentTaskSpecs
  acceptanceCriteria: string[];      // min length 1
}

interface PlanMeta {
  title:        string;
  shortSummary: string;
  assumptions:  string[];
  risks:        string[];
}

interface SystemOverview {
  contextDescription:      string;
  keyActors:               string[];
  constraints:             string[];
  nonFunctionalRequirements: string[];
}

// Root type — inferred via z.infer<typeof PlanSchema>
interface Plan {
  meta:      PlanMeta;
  system:    SystemOverview;
  domains:   DomainArea[];
  workflows: WorkflowSpec[];
  decisions: AdrRecord[];
  tasks:     AgentTaskSpec[];
}
```

`PlanSchemaService` also exposes the output of `zodToJsonSchema(PlanSchema)` for
injection into LangChain prompt templates.

**`PlanSchemaService` public API:**

```typescript
class PlanSchemaService {
  readonly schema: ZodType<Plan>;         // the Zod schema object
  readonly jsonSchema: Record<string, unknown>;  // zodToJsonSchema(PlanSchema) output
  validate(raw: unknown): SafeParseReturnType<unknown, Plan>;  // wraps safeParse
}
```

### 6.2 Minimal Valid `Plan` JSON Example

Use this as a fixture in unit tests and as a grounding reference for prompt engineering.
It is intentionally minimal — one domain, one container, one component:

```json
{
  "meta": {
    "title": "Example App",
    "shortSummary": "A single-page to-do manager.",
    "assumptions": ["Users are authenticated externally."],
    "risks": ["LocalStorage quota exceeded on large plans."]
  },
  "system": {
    "contextDescription": "SPA consumed by developers.",
    "keyActors": ["Developer"],
    "constraints": ["No backend."],
    "nonFunctionalRequirements": ["Load in < 2 s on 4G."]
  },
  "domains": [
    {
      "id": "frontend",
      "name": "Frontend",
      "overview": "Angular SPA.",
      "containers": [
        {
          "id": "spa",
          "name": "SPA",
          "type": "spa",
          "techStack": ["Angular 17", "PrimeNG"],
          "responsibilities": ["Render UI", "Manage state"],
          "externalDeps": [],
          "mermaidDiagram": "graph TD\n  A[User] --> B[SPA]",
          "components": [
            {
              "id": "todo-list",
              "name": "TodoListComponent",
              "layer": "component",
              "description": "Displays the list of to-do items.",
              "inputs": ["items: TodoItem[]"],
              "outputs": ["itemDeleted: EventEmitter<string>"],
              "dependencies": [],
              "errorHandling": "Shows empty-state message when items is empty.",
              "acceptanceCriteria": ["Renders one row per TodoItem.", "Emits itemDeleted with correct id on delete click."],
              "outOfScope": ["Editing items inline."]
            }
          ]
        }
      ]
    }
  ],
  "workflows": [],
  "decisions": [],
  "tasks": []
}
```

### 6.3 TokenUsage

Defined in `src/core/token-usage.model.ts`. Fields: `promptTokens`, `completionTokens`,
`totalTokens` (all numbers), `model` (string, the model id used), and `generatedAt`
(ISO timestamp string). Populated from `AIMessage.usage_metadata` after each LangGraph
run completes.

### 6.4 SavedPlanEntry

Defined in `src/core/saved-plan-entry.model.ts`. Fields: `id` (UUID generated with
`crypto.randomUUID()`), `title` (from `plan.meta.title`), `savedAt` (ISO timestamp),
`model` (model id at time of generation), `tokenStats` (`TokenUsage` or `null`), and
`plan` (the full `Plan` object).

Saved plans are stored under localStorage key `arc-planner:saved-plans` as an array.
Each entry is independently restorable as the active plan.

---

## 7. State Management [REVISED]

### 7.1 ProjectStore — NgRx SignalStore

All application state lives in a single **NgRx SignalStore** (`ProjectStore`) defined in
`src/core/project.store.ts` using `signalStore()`. State is mutated exclusively via
`patchState()` inside `withMethods()`. Components inject `ProjectStore` directly and
read state slices as signals.

**State shape** (`withState`):

| Slice | Type | Persisted |
|---|---|---|
| `plan` | `Plan \| null` | `arc-planner:plan` |
| `apiKey` | `string` | `arc-planner:config` during development |
| `availableModels` | `ModelEntry[]` | Never (re-fetched each session) |
| `modelsLoading` | `boolean` | No |
| `selectedModel` | `string` | `arc-planner:config` |
| `isLoading` | `boolean` | No |
| `streamBuffer` | `string` | No |
| `error` | `PlannerError \| null` | No |
| `tokenStats` | `TokenUsage \| null` | No |
| `defaultTemperature` | `number` (default 0.3) | `arc-planner:config` |
| `defaultMaxTokens` | `number` (default 8192) | `arc-planner:config` |
| `savedPlans` | `SavedPlanEntry[]` | `arc-planner:saved-plans` |
| `markdownOverrides` | `Record<string, string>` | No |

**Computed signals** (`withComputed`): `hasActivePlan`, `fileTree` (derived from `plan`
via `buildFileTree`), `dirtyFiles` (keys of `markdownOverrides`).

**Methods** (`withMethods` using `patchState`): `setPlan`, `clearPlan`, `setApiKey`,
`forgetKey`, `setModels`, `setModelsLoading`, `selectModel`, `startGeneration`,
`appendStream`, `finishGeneration`, `setError`, `setConfig`, `setOverride`,
`removeOverride`, `clearDomainOverrides`, `saveCurrentPlan`, `loadSavedPlan`,
`deleteSavedPlan`.

**Hooks** (`withHooks.onInit`): rehydrates all persisted slices from localStorage on
startup; registers `effect()` callbacks to sync `plan`, `savedPlans`, and provider
config back to localStorage on every state change.

### 7.2 Override Map Semantics

| Action | Effect on override map |
|---|---|
| User edits markdown in `PlanEditorComponent` | `overrides.set(filePath, newContent)` |
| "Regenerate from Plan" clicked for a file | `overrides.delete(filePath)` |
| "Regenerate domain via OpenRouter" succeeds | Delete all overrides whose path is under that domain |
| Export | Use override value if present; derive from `Plan` otherwise |

---

## 8. User Flows

### 8.1 Generate New Plan

1. User opens app → sees `ProjectInputComponent` (plan is null).
2. User enters: API key, model, app description, optional tech hints / constraints / NFRs.
3. User clicks **Generate Plan**.
4. `isLoading` → `true`; `streamBuffer` reset to `''`; `p-skeleton` overlay shown on editor area.
5. `GeneratePlanComponent` calls `PlannerGraphService.run(input)` which returns an
   `AsyncIterable` of `PlannerState` snapshots.
6. The component iterates snapshots using `from()` → `toObservable()`:
   - Each `callLLM` chunk updates `ProjectStoreService.streamBuffer` (live token preview).
   - Final snapshot with `plan !== null` → store `Plan`, populate `tokenStats`, show editor.
   - Snapshot with `error !== null` → store `PlannerError`, show error panel with raw output.
7. If `validatePlan` fails, the graph automatically retries `buildPrompt` with error
   feedback injected into `{retryContext}` (max 2 retries before surfacing the error).

### 8.2 Edit and Regenerate Section

**Manual edit:**
- User selects file in tree → editor shows content (override if present, else plan-derived).
- User edits textarea → override stored in `markdownOverrides`.
- File tree shows a `*` indicator on files with active overrides.

**Re-render from plan (no API call):**
- User clicks "Reset to Plan" on a file → override removed → content re-derived from `Plan`.

**Refine via OpenRouter:**
- User selects domain tab → clicks "Refine this domain".
- User types instructions in a `p-dialog` modal.
- Token budget guard runs (Section 5.7); user confirms if over threshold.
- `RegenerateSectionComponent` calls `RegenerateGraphService.run({ currentPlan, domainId, instructions })`.
- Graph streams tokens into `streamBuffer`; on success `mergeDomain` node replaces the
  domain in `Plan` and clears overrides for that domain's files.

### 8.3 Export Files

1. User opens Export panel → sees file tree with override indicators and file sizes.
2. Options:
   - **Download all as .zip** → JSZip bundles all `.md` files + `plan.json` → `Blob` download.
   - **Download individual file** → single `Blob` download for selected file.
3. `ExportService` resolves each file: override → plan-derived → in order.

### 8.4 Provider Configuration

1. User navigates to `/config` via the top navbar.
2. `ProviderConfigComponent` displays:
   - **API key** field (`p-password` with mask toggle) — persisted during development; pre-filled from `ProjectStoreService.apiKey` after reload.
   - Models load automatically on selector start and refresh when the selector opens.
   - **Model selector** (`p-select` bound to `availableModels`; shows `p-skeleton` while loading; falls back to free-form `p-inputtext` on error) — bound to `ProjectStoreService.selectedModel`.
   - **Default temperature** (`p-inputnumber`, 0–2 step 0.05) — persisted to `arc-planner:config`.
   - **Default max tokens** (`p-inputnumber`, 256–32768 step 256) — persisted to `arc-planner:config`.
   - **"Forget Key"** `p-button` (severity `danger`) — calls `ProjectStoreService.forgetKey()`, clears the field and `availableModels`.
3. Development settings (API key, temperature, max tokens, last selected model id) are saved automatically via the store's persistence hook.
4. API key change is applied immediately to the signal and persisted to `arc-planner:config` for development reloads.

### 8.5 Saved Plans Library

1. User navigates to `/plans` via the top navbar.
2. `SavedPlansComponent` loads `ProjectStoreService.savedPlans` and renders a `p-dataview`
   of `SavedPlanCardComponent` items sorted by `savedAt` descending.
3. Each card shows: plan title, save date, model used, `promptTokens` + `completionTokens`
   + `totalTokens` in a `p-chip` row.
4. Card actions:
   - **Load** — calls `ProjectStoreService.loadSavedPlan(id)` then navigates to `/planner`.
   - **Export zip** — calls `ExportService` directly and triggers download without changing
     the active plan.
   - **Delete** — `p-confirmdialog` prompt before calling `ProjectStoreService.deleteSavedPlan(id)`.
5. **"Save current plan"** `p-button` in the planner toolbar snapshots the active plan via
   `ProjectStoreService.saveCurrentPlan()` and shows a `p-toast` confirmation.

---

## 9. Markdown Output Structure

All files are generated under a `docs/` root; paths are stable so coding agents can
target them deterministically.

### 9.1 Directory Layout

All generated files live under a `docs/` root, with `plan.json` at the export root
(sibling to `docs/`, not inside it). Subdirectories:

- `docs/00-system/` — overview, scope and context, non-functional requirements, glossary.
- `docs/10-decisions/` — one file per ADR, named `adr-NNN-<slug>.md`.
- `docs/20-shared/` — domain model, plan JSON schema, API contracts, markdown conventions.
- `docs/30-frontend/` — frontend overview, routing and shell, then subdirectories `pages/`, `components/`, `services/` each containing one file per unit.
- `docs/40-backend/` — backend overview, then per-container files following the same layout as frontend.
- `docs/50-workflows/` — one file per workflow, named `<workflow-slug>.md`.
- `docs/60-agent-tasks/` — implementation order index (`00-implementation-order.md`) plus one task file per step named `<nn>-<task-slug>.md`.

### 9.2 Component / Service File Template

Each implementation-level file follows a strict heading schema to maximise
coding-agent usability. `MarkdownRendererService` generates this format from a
`ComponentSpec`. Required sections in order:

1. **Purpose** — one sentence describing the unit's single responsibility.
2. **Responsibilities** — bullet list; each item must be independently testable.
3. **Inputs** — each parameter with its type and a short description.
4. **Outputs** — return type or emitted event with description.
5. **Dependencies** — injected services or external packages.
6. **Public API** — each public method with signature and one-line description.
7. **Error Handling** — specific error cases and how they are surfaced.
8. **Acceptance Criteria** — checkbox list of verifiable, testable statements.
9. **Out of Scope** — explicit list of what this unit does NOT do.

### 9.3 System-Level Files

System-level files (`docs/00-system/`) include a C4 context diagram rendered with
Mermaid. The diagram shows: the end user, the SPA frontend (Angular), the backend API,
and any external database — with directional relationship labels (Uses, Calls,
Reads/Writes).

---

## 10. Error Handling [NEW]

### 10.1 PlannerError Type

Defined in `src/core/planner-error.model.ts`. The discriminated union `PlannerErrorType`
has six variants: `network` (fetch failed), `auth` (HTTP 401/403), `rate_limit`
(HTTP 429), `invalid_json` (response not parseable as JSON), `schema_validation` (JSON
parsed but fails Zod), and `provider_error` (`finish_reason` is `"error"` or unexpected).

The `PlannerError` interface always carries `type` and `message`. Optional fields:
`raw` (raw model output, present for `invalid_json`), `finishReason` (present for
`provider_error`), `fields` (Zod error paths, present for `schema_validation`), and
`statusCode` (HTTP status when available).

### 10.2 Error Mapping in OpenRouterClientService

The private `mapError` method maps caught errors to `PlannerError`:

- `HttpErrorResponse` with status 401 or 403 → `auth`.
- `HttpErrorResponse` with status 429 → `rate_limit`.
- Any other `HttpErrorResponse` → `network` (status code preserved).
- `SyntaxError` → `invalid_json`, with `rawContent` stored in the `raw` field.
- All other errors → `network` with the stringified error message.

### 10.3 Error UI

- **Inline banner** above the editor for transient errors (rate limit, network).
- **Collapsible debug panel** for `invalid_json` and `schema_validation` errors showing:
  - `PlannerError.message`
  - `PlannerError.fields` (highlighted paths for schema errors)
  - `PlannerError.raw` (raw model response in a scrollable `<pre>`)
- **Auth errors** navigate the user back to `ProjectInputComponent` with the key field
  highlighted in red.

---

## 11. UI States [NEW]

| State | Trigger | UI |
|---|---|---|
| **Empty** | No plan in store | `ProjectInputComponent` only; editor area hidden |
| **Loading** | API call in flight | `p-skeleton` cards over editor; `p-button [loading]="true"` for generate button; form disabled |
| **Success** | Plan validated | Editor/preview visible; generate button resets to idle |
| **Error** | `PlannerError` set | `p-message` severity `"error"` banner; collapsible `p-panel` debug block (see Section 10.3); raw response in `<pre>` |
| **Dirty** | `markdownOverrides` non-empty | File tree shows `*` on modified files; `p-badge` on export button shows modified count |
| **Token warning** | Estimated tokens > 80k | `p-message` severity `"warn"` with estimated token count before regeneration call |

---

## 12. Non-Functional Requirements

### Security

- API key is **never** written to `localStorage`, `sessionStorage`, cookies, or any
  network destination other than OpenRouter.
- API key lives in `ProjectStoreService.apiKey` and is persisted to `arc-planner:config`
  for development reloads.
- Expose a **"Forget Key"** button that calls `ProjectStoreService.forgetKey()` and
  clears the input field.
- All markdown rendered as HTML must be sanitised with `DOMPurify` before passing to
  `DomSanitizer.bypassSecurityTrustHtml`.

### Performance

- Show skeleton loading state immediately on API call start.
- `fileTree` signal is `computed()` — recalculates only when `plan` changes.
- Mermaid diagrams render lazily: only when the preview tab is active
  (use `@defer` with `on viewport` or manual visibility check).
- Display `usage.prompt_tokens`, `usage.completion_tokens` from the OpenRouter response
  in a status bar when available.

### UX

- Layout: two-column workspace using `p-splitter` — left panel for file tree and
  navigation, right panel for editor and `p-tabview` tabs.
- File tree implemented with `p-tree`; collapsible on small viewports via `p-drawer`.
- Buttons use `p-button`; dropdowns use `p-select`; text inputs use `p-inputtext` wrapped
  in `p-floatlabel`; text areas use `p-textarea`; modals use `p-dialog`.
- Keyboard shortcut `Ctrl+S` / `Cmd+S` saves the current override (no-op if unmodified).
- Dark / light theme toggled via PrimeNG's `darkModeSelector`; a `p-togglebutton` in the
  toolbar switches the `dark` class on `<html>`.

---

## 13. Implementation Order (for Coding Agents) [REVISED]

Each step maps to a file in `docs/60-agent-tasks/`. Column key:
- **Deps** — step numbers that must be complete before starting this step (`‖` = can start in parallel with listed steps if resources allow).
- **Acceptance Criteria** — verifiable assertions an agent must pass before marking the step done.

| Step | Task | Target Files | Deps | Acceptance Criteria |
|---|---|---|---|---|
| 01 | Bootstrap Angular standalone app | `src/app/app.component.ts`, `src/app/app.config.ts`, `src/app/app.routes.ts` | — | `ng serve` starts with no errors; navigating to `/` redirects to `/planner`; PrimeNG Aura theme applied (no FOUC) |
| 02 | Zod plan schema | `src/app/core/plan.schema.ts`, `src/app/core/plan-schema.service.ts`, `src/app/core/plan-schema.service.spec.ts` | 01 | `PlanSchema.safeParse(minimalFixture)` returns `{ success: true }`; `zodToJsonSchema(PlanSchema)` returns a non-null object with a `properties` key; invalid input returns `{ success: false }` with populated `error.issues` |
| 03 | Prompt builder | `src/app/core/prompt-builder.service.ts`, `src/app/core/prompt-builder.service.spec.ts` | 02 | `buildGenerationTemplate()` returns a `ChatPromptTemplate` with variables `userIdea`, `techHints`, `nfrs`, `constraints`, `retryContext`, `planSchema`; injecting a mock schema string produces a formatted message without placeholder tokens |
| 04 | LangChain LLM setup | `src/app/core/openrouter-client.service.ts`, `src/app/core/openrouter-client.service.spec.ts` | 01 | `fetchModels()` calls `GET /api/v1/models` via `HttpClient`; HTTP 401 maps to a `PlannerError` with `type: 'auth'`; `ChatOpenAI` factory sets `baseURL` to `https://openrouter.ai/api/v1` |
| 05 | PlannerGraphService | `src/app/core/planner-graph.service.ts`, `src/app/core/planner-graph.service.spec.ts` | 02 ‖ 03 ‖ 04 | `StateGraph` compiles without error; mocking `callLLM` to return valid JSON reaches END state with `plan !== null`; mocking `callLLM` to return invalid JSON triggers retry up to 2 times then sets `error` |
| 06 | RegenerateGraphService | `src/app/core/regenerate-graph.service.ts`, `src/app/core/regenerate-graph.service.spec.ts` | 05 | `mergeDomain` node replaces only the target domain and leaves other domains untouched; `clearDomainOverrides` is called on success |
| 07 | Project store | `src/app/core/project.store.ts`, `src/app/core/project.store.spec.ts` | 02 | All state slices initialise to correct defaults; `patchState` mutations reflect in signals synchronously; `withHooks.onInit` rehydrates `plan` and development `apiKey` from `localStorage` |
| 08 | Project input UI | `src/app/features/project-input/project-input.component.ts`, `src/app/features/project-input/constraints-form.component.ts` | 07 | Form renders API key, model selector, idea textarea, and constraints; submitting with empty idea shows a validation error; submitting with valid data emits a `generate` event with correct payload |
| 09 | Generate plan flow | `src/app/features/planner/generate-plan.component.ts` | 05 ‖ 07 ‖ 08 | `isLoading` becomes `true` on generate click; stream buffer updates progressively; final valid plan snapshot populates file tree; error snapshot shows error banner; loading overlay hidden on completion |
| 10 | Markdown renderer | `src/app/core/markdown-renderer.service.ts`, `src/app/core/markdown-renderer.service.spec.ts` | 02 | Given the minimal Plan fixture (Section 6.2), `buildFileTree()` returns paths matching the Section 9.1 layout; each component file string contains all 9 required headings from Section 9.2 |
| 11 | Plan editor | `src/app/features/editor/plan-editor.component.ts` | 07 ‖ 10 | File tree renders nodes from `fileTree` signal; selecting a node loads its content in the textarea; editing sets the override in `ProjectStore`; `*` indicator appears on modified nodes; "Reset to Plan" removes the override |
| 12 | Mermaid preview | `src/app/features/diagrams/mermaid-preview.component.ts` | 01 | Mermaid initialises exactly once in `AppComponent`; preview renders a supplied diagram string after `afterNextRender()`; no render attempt occurs when the preview tab is inactive |
| 13 | Export | `src/app/core/export.service.ts`, `src/app/features/export/export-panel.component.ts` | 07 ‖ 10 | `buildZip()` produces a JSZip with `plan.json` at root and at least one `.md` file under `docs/`; files with active overrides use override content; files without overrides use plan-derived content |
| 14 | Regenerate section | `src/app/features/planner/regenerate-section.component.ts` | 06 ‖ 07 ‖ 11 | Token budget guard displays warning when estimated tokens > 80k; confirming triggers `RegenerateGraphService.run()`; success replaces only the target domain in the store; domain overrides are cleared |
| 15 | Provider config page | `src/app/features/provider-config/provider-config.component.ts` | 04 ‖ 07 | Route `/config` renders API key input, model selector, temperature, max-tokens; model selector loads and refreshes models automatically; "Forget Key" clears `apiKey` signal and persisted config key |
| 16 | Saved plans library | `src/app/features/saved-plans/saved-plans.component.ts`, `src/app/features/saved-plans/saved-plan-card.component.ts` | 07 ‖ 13 | Plans are sorted by `savedAt` descending; Load navigates to `/planner` with the plan active; Export zip works without changing the active plan; Delete shows `p-confirmdialog` before removing |



---

## 14. Testing Strategy [NEW]

### 14.1 Test Runner

Use **Vitest** via `@analogjs/vitest` (Angular 17 compatible) or Angular CLI's built-in
Jest preset (`ng test`). Pick one at project init; do not mix. Recommended: Vitest for
speed. Configure in `vite.config.ts` / `vitest.config.ts` at repo root.

### 14.2 File Naming & Co-location

Every source file that exports a class or service must have a co-located spec file:

```
src/app/core/plan-schema.service.ts
src/app/core/plan-schema.service.spec.ts   ← same directory
```

Component specs follow the same rule. No separate `__tests__/` directories.

### 14.3 What to Test per Layer

| Layer | Minimum test coverage |
|---|---|
| **Zod schema** (`plan.schema.ts`) | Valid fixture passes `safeParse`; every required field missing causes failure; enum out-of-range fails |
| **Services** (non-graph) | Every public method has at least one happy-path and one error-path test; use `TestBed.configureTestingModule` with `HttpClientTestingModule` for HTTP services |
| **LangGraph services** | Mock `ChatOpenAI` via `jest.fn()` / `vi.fn()`; test each node function in isolation; test conditional edge routing |
| **NgRx SignalStore** | Every `withMethods` action tested: call the action, then read signals to assert state change; `localStorage` persistence tested with `jest.spyOn(localStorage, 'setItem')` |
| **Components** | Test UI state transitions: empty → loading → success → error; test that forbidden patterns (e.g. direct innerHTML) are absent from template |
| **ExportService** | Assert JSZip output contains `plan.json` and all expected `docs/` paths; assert override content takes precedence over plan-derived content |

### 14.4 Fixtures

Maintain a shared test fixture file at `src/testing/fixtures.ts` exporting:

```typescript
export const minimalPlan: Plan = { /* minimal valid Plan from Section 6.2 */ };
export const minimalPlanJson = JSON.stringify(minimalPlan);
```

All spec files import from this file rather than duplicating fixture data.

### 14.5 What NOT to Test in v1

- End-to-end (Playwright/Cypress) tests are **out of scope** for v1.
- Visual regression tests are out of scope.
- Performance benchmarks are out of scope.
- Do not test internal implementation details of LangChain / LangGraph internals; only test the wrapper services.

---

*End of specification.*
