import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { vi } from 'vitest';
import { ProjectStore, defaultProviderConfigs } from '../../core/project.store';
import { minimalPlanFixture } from '../../testing/fixtures';
import { PlanFieldsEditorComponent } from './plan-fields-editor.component';

describe('PlanFieldsEditorComponent', () => {
  function setup(
    planOverride = minimalPlanFixture,
    options: { lastOriginalInput?: any | null } = {},
  ) {
    const planSig = signal(planOverride);
    const lastInputSig = signal(options.lastOriginalInput ?? null);
    const setPlan = vi.fn((p: any) => {
      planSig.set(p);
    });
    const replacePlanForUserEdit = vi.fn((p: any) => {
      planSig.set(p);
    });
    const setError = vi.fn();
    const clearMarkdownOverrides = vi.fn();

    const providerConfigs = {
      ...defaultProviderConfigs(),
      openrouter: {
        ...defaultProviderConfigs().openrouter,
        selectedModel: 'openai/gpt-4o-mini',
      },
    };

    const store = {
      plan: planSig,
      setPlan,
      replacePlanForUserEdit,
      setError,
      clearMarkdownOverrides,
      isGenerating: signal(false),
      lastOriginalInput: lastInputSig,
      config: signal({
        provider: 'openrouter',
        providerConfigs,
      }),
      apiKey: signal('sk-test'),
    };

    TestBed.configureTestingModule({
      imports: [PlanFieldsEditorComponent],
      providers: [
        { provide: ProjectStore, useValue: store },
      ],
    });

    const fixture = TestBed.createComponent(PlanFieldsEditorComponent);
    fixture.detectChanges();

    return { fixture, store, lastInputSig };
  }

  it('renders four list-grid sections sharing the same grid container for the requested collections', () => {
    const { fixture } = setup();
    const root = fixture.nativeElement as HTMLElement;

    const grids = Array.from(root.querySelectorAll('.list-grid'));
    expect(grids.length).toBe(4);

    const labels = grids.map((grid) => {
      const section = grid.closest('.editor-section');
      return section?.querySelector('.section-title')?.textContent?.trim() ?? '';
    });

    expect(labels.some((label) => label.startsWith('Domains'))).toBe(true);
    expect(labels.some((label) => label.startsWith('Architecture Decision Records'))).toBe(true);
    expect(labels.some((label) => label.startsWith('Workflows'))).toBe(true);
    expect(labels.some((label) => label.startsWith('Agent Tasks'))).toBe(true);
  });

  it('groups each entity card with its edit-mode name/title and description controls', () => {
    const { fixture } = setup();
    const root = fixture.nativeElement as HTMLElement;

    const grids = Array.from(root.querySelectorAll('.list-grid'));
    expect(grids.length).toBe(4);

    for (const grid of grids) {
      const cards = Array.from(grid.querySelectorAll('.list-card'));
      expect(cards.length).toBeGreaterThan(0);

      for (const card of cards) {
        const inputs = card.querySelectorAll('input, textarea');
        expect(inputs.length).toBeGreaterThan(0);
      }
    }

    expect(root.querySelector('p-select')).toBeNull();
  });

  it('does not render a field-grid inside the four collection sections', () => {
    const { fixture } = setup();
    const root = fixture.nativeElement as HTMLElement;

    const grids = Array.from(root.querySelectorAll('.list-grid'));
    for (const grid of grids) {
      expect(grid.querySelector('.field-grid')).toBeNull();
    }

    expect(root.querySelectorAll('.field-grid').length).toBe(3);
  });

  it('shows the + Add ADR / Workflow / Task / Domain buttons in the section footers', () => {
    const { fixture } = setup();
    const root = fixture.nativeElement as HTMLElement;
    const buttons = Array.from(root.querySelectorAll('.section-footer p-button'));

    expect(buttons.length).toBe(4);
    const labels = buttons.map((b) => b.getAttribute('label') ?? '');
    expect(labels).toEqual(
      expect.arrayContaining([
        'Add ADR',
        'Add Workflow',
        'Add Task',
        'Add Domain',
      ]),
    );
  });

  it('reveals the ADR add form when the + Add ADR button is clicked', () => {
    const { fixture } = setup();
    const root = fixture.nativeElement as HTMLElement;

    const before = root.querySelectorAll('.add-form').length;
    expect(before).toBe(0);

    const component = fixture.componentInstance as any;
    component.toggleAddForm('adr');
    fixture.detectChanges();

    const after = root.querySelectorAll('.add-form').length;
    expect(after).toBe(1);
  });

  it('appends a new ADR to the plan when the save action is invoked', () => {
    const { fixture, store } = setup();
    const component = fixture.componentInstance as any;

    component.newAdr = {
      id: 'adr-002',
      title: 'Cache-first reads',
      context: 'Reads dominate.',
      decision: 'Cache aggressively.',
    };
    component.saveAdr();

    expect(store.replacePlanForUserEdit).toHaveBeenCalled();
    const lastCallArg = store.replacePlanForUserEdit.mock.calls.at(-1)![0];
    expect(lastCallArg.adrs).toHaveLength(minimalPlanFixture.adrs.length + 1);
    expect(lastCallArg.adrs.at(-1).id).toBe('adr-002');
  });

  it('refuses to save an ADR whose id collides with an existing one', () => {
    const { fixture, store } = setup();
    const component = fixture.componentInstance as any;

    component.newAdr = { id: 'adr-001', title: 'Dup', context: '', decision: '' };
    component.saveAdr();

    expect(store.setError).toHaveBeenCalled();
    expect(store.replacePlanForUserEdit).not.toHaveBeenCalled();
  });

  it('removes an ADR and clears its markdown override path', () => {
    const { fixture, store } = setup();
    const component = fixture.componentInstance as any;

    component.draft.set(structuredClone(minimalPlanFixture));
    component.removeItem('adr', 'adr-001');

    expect(store.replacePlanForUserEdit).toHaveBeenCalled();
    const lastCallArg = store.replacePlanForUserEdit.mock.calls.at(-1)![0];
    expect(lastCallArg.adrs).toHaveLength(minimalPlanFixture.adrs.length - 1);

    expect(store.clearMarkdownOverrides).toHaveBeenCalled();
    const paths = store.clearMarkdownOverrides.mock.calls.at(-1)![0];
    expect(paths).toContain('docs/20-decisions/adr-001-schema-first-output-contract.md');
  });

  it('renders a Remove button on each Domain card', () => {
    const { fixture } = setup();
    const root = fixture.nativeElement as HTMLElement;

    const domainCards = Array.from(root.querySelectorAll('.domains-list .list-card'));
    expect(domainCards.length).toBeGreaterThan(0);

    for (const card of domainCards) {
      const removeBtn = card.querySelector('p-button[label="Remove"]');
      expect(removeBtn).not.toBeNull();
    }
  });

  it('appends a new domain to the plan when saveDomainManual is invoked with valid input', () => {
    const { fixture, store } = setup();
    const component = fixture.componentInstance as any;

    component.newDomainManual = {
      name: 'Orders',
      description: 'Handles order lifecycle.',
    };
    component.saveDomainManual();

    expect(store.replacePlanForUserEdit).toHaveBeenCalled();
    const last = store.replacePlanForUserEdit.mock.calls.at(-1)![0];
    expect(last.domains.some((d: any) => d.id === 'orders')).toBe(true);
    const appended = last.domains.find((d: any) => d.id === 'orders');
    expect(appended.name).toBe('Orders');
    expect(appended.description).toBe('Handles order lifecycle.');
    expect(Array.isArray(appended.components)).toBe(true);
    expect(appended.components.length).toBeGreaterThan(0);
  });

  it('rejects saveDomainManual when the slugified name collides with an existing domain id', () => {
    const { fixture, store } = setup();
    const component = fixture.componentInstance as any;

    const existingId = structuredClone(minimalPlanFixture).domains[0].id;
    const existingName = structuredClone(minimalPlanFixture).domains[0].name;

    component.draft.set(structuredClone(minimalPlanFixture));
    component.newDomainManual = {
      name: existingName,
      description: 'Should fail',
    };
    component.saveDomainManual();

    expect(store.setError).toHaveBeenCalled();
    expect(store.replacePlanForUserEdit).not.toHaveBeenCalled();
    expect(existingId).toBeTruthy();
  });

  it('renders technology fields in a 2-column grid (memory editor.technology_fields_two_columns)', () => {
    const { fixture } = setup();
    const root = fixture.nativeElement as HTMLElement;

    const fieldGrids = Array.from(root.querySelectorAll('.field-grid'));
    expect(fieldGrids.length).toBeGreaterThan(0);

    for (const grid of fieldGrids) {
      const computed = window.getComputedStyle(grid as HTMLElement);
      const cols = computed.gridTemplateColumns;
      const columnCount = cols
        .trim()
        .split(/\s+/)
        .filter((s) => s.length > 0).length;
      expect(columnCount).toBe(2);
    }
  });

  it('renders the Application Idea field above the Plan Summary section', () => {
    const { fixture } = setup();
    const root = fixture.nativeElement as HTMLElement;

    const sections = Array.from(root.querySelectorAll('fieldset > section.editor-section'));
    expect(sections.length).toBeGreaterThanOrEqual(2);

    const ideaSection = sections[0];
    expect(ideaSection.querySelector('.section-title')?.textContent?.trim()).toBe(
      'Application Idea',
    );
    expect(ideaSection.contains(root.querySelector('textarea'))).toBe(true);

    const planSummaryIndex = sections.findIndex(
      (s) => s.querySelector('.section-title')?.textContent?.trim() === 'Plan Summary',
    );
    expect(planSummaryIndex).toBeGreaterThan(0);
  });

  it('prefers lastOriginalInput.idea over plan.meta.userIdea for the initial Application Idea value', () => {
    const planWithUserIdea = structuredClone(minimalPlanFixture);
    planWithUserIdea.meta.userIdea = 'fallback-from-meta';

    const { fixture } = setup(planWithUserIdea, {
      lastOriginalInput: { idea: 'live-original-idea' },
    });
    const root = fixture.nativeElement as HTMLElement;

    const ideaTextarea = root.querySelector('textarea') as HTMLTextAreaElement;
    expect(ideaTextarea).toBeTruthy();
    expect(ideaTextarea.value).toBe('live-original-idea');
  });

  it('falls back to plan.meta.userIdea when lastOriginalInput is null', () => {
    const planWithUserIdea = structuredClone(minimalPlanFixture);
    planWithUserIdea.meta.userIdea = 'fallback-from-meta';

    const { fixture } = setup(planWithUserIdea, { lastOriginalInput: null });
    const root = fixture.nativeElement as HTMLElement;

    const ideaTextarea = root.querySelector('textarea') as HTMLTextAreaElement;
    expect(ideaTextarea.value).toBe('fallback-from-meta');
  });

  it('on blur with a new value, patches plan.meta.userIdea via replacePlanForUserEdit with trimmed value', () => {
    const { fixture, store } = setup(minimalPlanFixture, {
      lastOriginalInput: { idea: 'live-original-idea' },
    });
    const root = fixture.nativeElement as HTMLElement;
    const component = fixture.componentInstance as any;

    const ideaTextarea = root.querySelector('textarea') as HTMLTextAreaElement;
    ideaTextarea.value = '  edited idea text  ';
    ideaTextarea.dispatchEvent(new Event('blur'));
    fixture.detectChanges();

    expect(store.replacePlanForUserEdit).toHaveBeenCalled();
    const last = store.replacePlanForUserEdit.mock.calls.at(-1)![0];
    expect(last.meta.userIdea).toBe('edited idea text');
  });

  it('on blur with the same value, does not patch the plan (no-op)', () => {
    const planWithUserIdea = structuredClone(minimalPlanFixture);
    planWithUserIdea.meta.userIdea = 'unchanged';

    const { fixture, store } = setup(planWithUserIdea, { lastOriginalInput: null });
    const root = fixture.nativeElement as HTMLElement;

    const ideaTextarea = root.querySelector('textarea') as HTMLTextAreaElement;
    ideaTextarea.value = 'unchanged';
    ideaTextarea.dispatchEvent(new Event('blur'));
    fixture.detectChanges();

    expect(store.replacePlanForUserEdit).not.toHaveBeenCalled();
  });

  it('propagates readonly() to the Application Idea textarea via the [readonly] attribute', () => {
    const { fixture, store } = setup();
    const component = fixture.componentInstance as any;

    store.isGenerating.set(true);
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    const ideaTextarea = root.querySelector('textarea') as HTMLTextAreaElement;
    expect(ideaTextarea.hasAttribute('readonly')).toBe(true);
    expect(component.readonly()).toBe(true);
  });
});
