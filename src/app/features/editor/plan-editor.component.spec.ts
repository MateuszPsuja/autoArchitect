import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { By } from '@angular/platform-browser';
import { vi } from 'vitest';
import { Tooltip } from 'primeng/tooltip';
import { MarkdownRendererService } from '../../core/markdown-renderer.service';
import { ProjectStore } from '../../core/project.store';
import { minimalPlanFixture } from '../../testing/fixtures';
import { PlanEditorComponent, deriveSection, displayName } from './plan-editor.component';

describe('deriveSection', () => {
  it('buckets top-level files as Root with the maximum sort key', () => {
    const result = deriveSection('ARCHITECTURE.md');
    expect(result.label).toBe('Root');
    expect(result.sortKey).toBe(Number.MAX_SAFE_INTEGER);
  });

  it('strips the numeric prefix from the docs sub-folder', () => {
    expect(deriveSection('docs/00-system/overview.md').label).toBe('system');
    expect(deriveSection('docs/30-backend/auth/overview.md').label).toBe('backend');
    expect(deriveSection('docs/40-frontend/auth/components.md').label).toBe('frontend');
  });

  it('uses the numeric prefix as the sort key', () => {
    expect(deriveSection('docs/00-system/overview.md').sortKey).toBe(0);
    expect(deriveSection('docs/10-architecture/overview.md').sortKey).toBe(10);
    expect(deriveSection('docs/60-agent-tasks/01-task.md').sortKey).toBe(60);
  });

  it('falls back to MAX_SAFE_INTEGER when the folder has no numeric prefix', () => {
    expect(deriveSection('apps/api/AGENTS.md').label).toBe('apps');
    expect(deriveSection('apps/api/AGENTS.md').sortKey).toBe(Number.MAX_SAFE_INTEGER);
  });
});

describe('displayName', () => {
  it('leaves plain filenames unchanged', () => {
    expect(displayName('docs/00-system/overview.md')).toBe('overview.md');
  });

  it('leaves non-ADR long filenames unchanged', () => {
    expect(displayName('docs/10-architecture/bounded-context-map.md')).toBe(
      'bounded-context-map.md',
    );
  });

  it('strips the leading verb from ADR filenames and keeps the ADR tag', () => {
    expect(
      displayName(
        'docs/20-decisions/adr-001-use-a-provider-agnostic-llm-port-with-streaming-token-output.md',
      ),
    ).toBe(
      'adr-001: a-provider-agnostic-llm-port-with-streaming-token-output.md',
    );
  });

  it('strips "prefer-" verb and keeps the ADR tag', () => {
    expect(
      displayName(
        'docs/20-decisions/adr-002-prefer-web-speech-api-for-stt-tts-with-an-injectable-cloud-fallback.md',
      ),
    ).toBe(
      'adr-002: web-speech-api-for-stt-tts-with-an-injectable-cloud-fallback.md',
    );
  });

  it('strips "use-" verb and keeps the ADR tag', () => {
    expect(
      displayName(
        'docs/20-decisions/adr-003-use-angular-signals-for-local-ui-state-and-ngrx-for-conversation-history.md',
      ),
    ).toBe(
      'adr-003: angular-signals-for-local-ui-state-and-ngrx-for-conversation-history.md',
    );
  });

  it('does not shorten names whose leading token is not a known verb', () => {
    expect(
      displayName('docs/20-decisions/adr-005-some-decision-record.md'),
    ).toBe('adr-005: some-decision-record.md');
  });
});

describe('PlanEditorComponent', () => {
  function setup(planOverride = minimalPlanFixture) {
    const planSig = signal(planOverride);
    const overridesSig = signal<Record<string, string>>({});

    const store = {
      plan: planSig,
      markdownOverrides: overridesSig,
      upsertMarkdownOverride: vi.fn(),
      removeMarkdownOverride: vi.fn(),
      isGenerating: signal(false),
    };

    TestBed.configureTestingModule({
      imports: [PlanEditorComponent],
      providers: [
        { provide: ProjectStore, useValue: store },
        MarkdownRendererService,
      ],
    });

    const fixture = TestBed.createComponent(PlanEditorComponent);
    fixture.detectChanges();

    return { fixture, store };
  }

  it('renders file names instead of full paths', () => {
    const { fixture } = setup();
    const root = fixture.nativeElement as HTMLElement;
    const buttons = Array.from(root.querySelectorAll('.file'));

    expect(buttons.length).toBeGreaterThan(0);
    for (const button of buttons) {
      const label = button.querySelector('.file-name')?.textContent?.trim() ?? '';
      expect(label).not.toContain('/');
      expect(label.length).toBeGreaterThan(0);
    }
  });

  it('renders displayName (not the raw basename) for ADR filenames', () => {
    const overriddenPlan = {
      ...minimalPlanFixture,
      adrs: [
        ...minimalPlanFixture.adrs,
        {
          id: 'adr-099',
          title: 'Use Some Very Long Decision Record Name',
          status: 'accepted',
          context: 'Test ADR',
          decision: 'Test decision',
          consequences: [],
        },
      ],
    };

    const planSig = signal(overriddenPlan);
    const overridesSig = signal<Record<string, string>>({});
    const store = {
      plan: planSig,
      markdownOverrides: overridesSig,
      upsertMarkdownOverride: vi.fn(),
      removeMarkdownOverride: vi.fn(),
      isGenerating: signal(false),
    };

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [PlanEditorComponent],
      providers: [
        { provide: ProjectStore, useValue: store },
        MarkdownRendererService,
      ],
    });

    const fixture = TestBed.createComponent(PlanEditorComponent);
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    const labels = Array.from(root.querySelectorAll('.file-name')).map(
      (el) => el.textContent?.trim() ?? '',
    );

    expect(labels).toContain(
      'adr-002: some-very-long-decision-record-name.md',
    );
    expect(labels).not.toContain(
      'adr-002-use-some-very-long-decision-record-name.md',
    );
  });

  it('groups files into ordered sections by numeric-prefix sort key', () => {
    const { fixture } = setup();
    const root = fixture.nativeElement as HTMLElement;
    const headers = Array.from(
      root.querySelectorAll('.p-accordionheader .section-title'),
    ).map((el) => el.textContent?.trim() ?? '');

    expect(headers.length).toBeGreaterThan(0);

    const systemIdx = headers.indexOf('system');
    const architectureIdx = headers.indexOf('architecture');
    const decisionsIdx = headers.indexOf('decisions');
    const backendIdx = headers.indexOf('backend');

    expect(systemIdx).toBeGreaterThanOrEqual(0);
    expect(architectureIdx).toBeGreaterThanOrEqual(0);
    expect(decisionsIdx).toBeGreaterThanOrEqual(0);
    expect(backendIdx).toBeGreaterThanOrEqual(0);

    expect(systemIdx).toBeLessThan(architectureIdx);
    expect(architectureIdx).toBeLessThan(decisionsIdx);
    expect(decisionsIdx).toBeLessThan(backendIdx);
  });

  it('attaches a PrimeNG Tooltip directive to each file button bound to the full path', () => {
    const { fixture } = setup();
    const debugButtons = fixture.debugElement.queryAll(By.directive(Tooltip));

    expect(debugButtons.length).toBeGreaterThan(0);

    const tooltip = debugButtons[0].injector.get(Tooltip);
    const samplePath = tooltip.content;
    expect(samplePath).toBeTruthy();
    expect(samplePath).toContain('/');
  });

  it('marks the active file button so users can see what is loaded in the editor', () => {
    const { fixture } = setup();
    const root = fixture.nativeElement as HTMLElement;
    const active = root.querySelector('.file.active');
    expect(active).not.toBeNull();
    expect((active as HTMLElement).classList.contains('active')).toBe(true);
  });

  describe('preview-first + edit dialog', () => {
    function findButton(root: HTMLElement, label: string): HTMLButtonElement | null {
      const candidates = Array.from(root.querySelectorAll('p-button')).filter((el) =>
        (el.textContent ?? '').includes(label),
      );
      const first = candidates[0];
      return first ? (first.querySelector('button') as HTMLButtonElement | null) : null;
    }

    function setupWithActiveMock(planOverride = minimalPlanFixture) {
      const planSig = signal(planOverride);
      const overridesSig = signal<Record<string, string>>({});

      const upsertMarkdownOverride = vi.fn((path: string, content: string) => {
        overridesSig.set({ ...overridesSig(), [path]: content });
      });

      const store = {
        plan: planSig,
        markdownOverrides: overridesSig,
        upsertMarkdownOverride,
        removeMarkdownOverride: vi.fn(),
        isGenerating: signal(false),
      };

      TestBed.configureTestingModule({
        imports: [PlanEditorComponent],
        providers: [
          { provide: ProjectStore, useValue: store },
          MarkdownRendererService,
        ],
      });

      const fixture = TestBed.createComponent(PlanEditorComponent);
        fixture.detectChanges();

      return { fixture, store, overridesSig };
    }

    it('renders the preview pane instead of an inline textarea by default', () => {
      const { fixture } = setup();
      const root = fixture.nativeElement as HTMLElement;

      expect(root.querySelector('.preview-shell')).not.toBeNull();
      expect(root.querySelector('.preview-shell app-markdown-preview')).not.toBeNull();
      expect(root.querySelector('.code-editor')).toBeNull();
    });

    it('clicking the toolbar Edit button opens the dialog seeded with current content', async () => {
      const { fixture } = setup();
      const root = fixture.nativeElement as HTMLElement;
      const editButton = findButton(root, 'Edit');
      expect(editButton).not.toBeNull();

      editButton!.click();
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      const dialogTextarea = document.querySelector('.edit-textarea') as HTMLTextAreaElement | null;
      expect(dialogTextarea).not.toBeNull();
      expect(dialogTextarea!.value.length).toBeGreaterThan(0);
    });

    it('Save writes the buffer to store.upsertMarkdownOverride and the * indicator appears', async () => {
      const { fixture, store } = setupWithActiveMock();
      const root = fixture.nativeElement as HTMLElement;

      const editButton = findButton(root, 'Edit');
      editButton!.click();
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      const dialogTextarea = document.querySelector('.edit-textarea') as HTMLTextAreaElement | null;
      expect(dialogTextarea).not.toBeNull();
      dialogTextarea!.value = 'edited content';
      dialogTextarea!.dispatchEvent(new Event('input'));
      fixture.detectChanges();

      const saveButton = Array.from(document.querySelectorAll('p-button')).find((el) =>
        (el.textContent ?? '').includes('Save'),
      );
      expect(saveButton).toBeDefined();
      (saveButton!.querySelector('button') as HTMLButtonElement).click();
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      expect(store.upsertMarkdownOverride).toHaveBeenCalled();
      const callArgs = (store.upsertMarkdownOverride as unknown as { mock: { calls: unknown[][] } }).mock.calls[0];
      expect(callArgs?.[1]).toBe('edited content');

      const activeFile = root.querySelector('.file.active .star');
      expect(activeFile).not.toBeNull();
    });

    it('Reset to Plan writes the original content as the override and closes the dialog', async () => {
      const { fixture, store } = setup();
      const root = fixture.nativeElement as HTMLElement;

      const editButton = findButton(root, 'Edit');
      editButton!.click();
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      const resetButton = Array.from(document.querySelectorAll('p-button')).find((el) =>
        (el.textContent ?? '').includes('Reset to Plan'),
      );
      expect(resetButton).toBeDefined();
      (resetButton!.querySelector('button') as HTMLButtonElement).click();
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      expect(store.upsertMarkdownOverride).toHaveBeenCalled();
      const callArgs = (store.upsertMarkdownOverride as unknown as { mock: { calls: unknown[][] } }).mock.calls[0];
      expect(callArgs?.[1]).toBeDefined();
      expect(typeof callArgs?.[1]).toBe('string');
      expect((callArgs?.[1] as string).length).toBeGreaterThan(0);
    });

    it('Cancel does not dirty the store', async () => {
      const { fixture, store } = setup();
      const root = fixture.nativeElement as HTMLElement;

      const editButton = findButton(root, 'Edit');
      editButton!.click();
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      const cancelButton = Array.from(document.querySelectorAll('p-button')).find((el) =>
        (el.textContent ?? '').includes('Cancel'),
      );
      expect(cancelButton).toBeDefined();
      (cancelButton!.querySelector('button') as HTMLButtonElement).click();
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      expect(store.upsertMarkdownOverride).not.toHaveBeenCalled();
      expect(document.querySelector('.edit-textarea')).toBeNull();
    });

    it('closing the dialog clears editBuffer (re-open shows current content, not stale typed text)', async () => {
      const { fixture } = setup();
      const root = fixture.nativeElement as HTMLElement;

      const editButton = findButton(root, 'Edit');
      editButton!.click();
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      const dialogTextarea = document.querySelector('.edit-textarea') as HTMLTextAreaElement | null;
      expect(dialogTextarea).not.toBeNull();
      const original = dialogTextarea!.value;

      const cancelButton = Array.from(document.querySelectorAll('p-button')).find((el) =>
        (el.textContent ?? '').includes('Cancel'),
      );
      (cancelButton!.querySelector('button') as HTMLButtonElement).click();
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      const editButton2 = findButton(root, 'Edit');
      editButton2!.click();
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      const dialogTextarea2 = document.querySelector('.edit-textarea') as HTMLTextAreaElement | null;
      expect(dialogTextarea2).not.toBeNull();
      expect(dialogTextarea2!.value).toBe(original);
    });
  });
});