## 0. Agent Quick-Start [NEW]

> **Read this section before any other.** It contains the rules and conventions that apply to
> every file you create or modify. Refer back to it when in doubt.

### 0.0 Response Format

Every response from the assistant **MUST** use this exact three-part format:

```
-------------
DONE: <short task name>
<details>
```

- Line 1: a line of dashes (`-------------`)
- Line 2: `DONE:` followed by a short, human-readable name of the task just completed
- Line 3: literal word `details`
- Line 4+: the response body, beginning on the line after `details`

This applies to all responses, including trivial acknowledgements and explanations.

### 0.1 Companion File

Create `AGENTS.md` (or `CLAUDE.md` for Claude-based agents) at the repo root. Copy this
entire Section 0 verbatim into that file. Most coding agents auto-load root-level `AGENTS.md`
or `CLAUDE.md`, so rules here apply even when the full spec is not in context.

### 0.2 Stack at a Glance

| Concern | Library / Pattern |
|---|---|
| Framework | Angular 17+ standalone components |
| Reactive state | NgRx `signalStore()` — mutations only via `patchState()` |
| LLM calls | LangChain.js `ChatOpenAI` -> per-provider base URL |
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
| `innerHTML` without sanitisation | `DOMPurify.sanitize()` then `DomSanitizer.bypassSecurityTrustHtml()`. For SVG payloads produced by Mermaid, `DOMPurify.sanitize(..., { USE_PROFILES: { svg: true } })` followed by a direct `element.innerHTML =` assignment is acceptable because Mermaid's inline styles + SVG-specific attributes are out of Angular's built-in sanitizer's vocabulary; document the deviation in the file's header comment. |
| Persisting `apiKey` outside `localStorage` during development | Store the development `apiKey` only in `arc-planner:config`; wipe it on `forgetKey()` |
| Modifying store state directly (e.g. `store.plan = x`) | `patchState(store, { plan: x })` inside `withMethods()` |
| Direct `fetch()` or `XMLHttpRequest` | Angular `HttpClient` for REST; LangChain for LLM |
| Raw `zodToJsonSchema` output embedded in source | Inject via `PlanSchemaService.jsonSchema` |
| Any backend / server-side code | Frontend-only; no Node server, no SSR |
| `console.error` as the sole error path | Always surface errors through `ProjectStore.setError()` |
| Shared streaming counters (chars / tokens / chunk ring / `streamBuffer`) accumulated across retry attempts | Scope per-attempt counters to the `wrappedInvoker` call; commit only the successful attempt's value to the live panel and to `TokenUsage` |

### 0.5 localStorage Key Registry

| Key | Content | Persisted slices |
|---|---|---|
| `arc-planner:plan` | Active `Plan` JSON | `plan` |
| `arc-planner:config` | `{ apiKey, selectedModel, defaultTemperature, defaultMaxTokens }` | development config, including API key |
| `arc-planner:saved-plans` | `SavedPlanEntry[]` | `savedPlans` |
| `arc-planner:agents` | `Agent[]` JSON | `agents` (in `AgentsStore`) |

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
- [ ] **Docs tab.** Selecting a markdown file in the Editor → Docs tab renders the file as sanitised HTML (`marked` + `DOMPurify`) by default. Editing happens via the toolbar **Edit** button which opens a modal containing the full `<textarea>` source; saving persists to `arc-planner:plan → markdownOverrides`, **Cancel** discards, and **Reset to Plan** restores the original `MarkdownRendererService` output. Per AGENTS.md §0.4, the HTML is sanitised (`DOMPurify`) before being injected via `DomSanitizer.bypassSecurityTrustHtml()`.
- [ ] Bundle root contains `.specify/memory/constitution.md` with the 9-article structure.
- [ ] Bundle root zip's `specs/` folder is named `NNN-slug/` (3-digit numeric prefix) and `features.json` reports `branchName`.
- [ ] `spec.md` contains at least one prioritised User Story (`US001`, …) with Given/When/Then acceptance scenarios.
- [ ] `plan.md` contains the 9-row Technical Context table at the top (Language/Version, Primary Dependencies, Storage, Testing, Target Platform, Project Type, Performance Goals, Constraints, Scale/Scope).
- [ ] `tasks.md` phases are organised by User Story priority with a tests-first block inside each story phase.
- [ ] `features.json` reports `version: 3` and includes `branchName` + `constitutionPath`.

### 0.7 Architecture Documents (spec-kit)

Generated plans follow the GitHub
[spec-kit `plan-template.md`](https://github.com/github/spec-kit) structure **per
architecture layer**. Each `docs/10-architecture/<frontend|backend>-architecture.md`
document is a self-contained plan for that layer and contains, in order:

1. **Summary** — 1–3 sentences describing the primary requirement and the
   technical approach for this layer.
2. **Technical Context** — markdown table with the nine spec-kit rows
   (Language / Version, Primary Dependencies, Storage, Testing, Target Platform,
   Project Type, Performance Goals, Constraints, Scale / Scope).
3. **Constitution Check** — bullet list of gates passed for this layer.
4. **Project Structure** — fenced `text` blocks for both the generated
   documentation tree and the layer's source code tree.
5. **Complexity Tracking** — markdown table from `complexityTracking[]`, or a
   blockquote stating no violations.
6. **Domain Areas** — index of the per-domain docs for this layer.

Diagrams are **internal** to the plan, not part of the shipped docs. The
per-layer `mermaidDiagram` (and the legacy `componentTreeDiagram`,
`dataFlowDiagram`, `moduleDependenciesDiagram`, `stateManagementDiagram`,
`apiContractDiagram` fields) live on `ArchitectureLayer` in
`src/app/core/plan.schema.ts` so the Architecture tab can render them with
`<app-mermaid-preview>`; the markdown renderer never embeds their source.
The system prompt in `src/app/core/prompt-builder.service.ts` enforces the
above section ordering on new generations.
