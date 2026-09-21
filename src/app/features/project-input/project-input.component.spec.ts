import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { vi } from 'vitest';
import { GeneratePromptInput } from '../../core/prompt-builder.service';
import { ProjectStore } from '../../core/project.store';
import { ProjectInputComponent } from './project-input.component';

describe('ProjectInputComponent', () => {
  function setup(pendingInput: GeneratePromptInput | null = null) {
    const store = {
      pendingInput: vi.fn(() => pendingInput),
      setPendingInput: vi.fn(),
      plannerResetTick: signal(0),
    };

    TestBed.configureTestingModule({
      imports: [ProjectInputComponent],
      providers: [{ provide: ProjectStore, useValue: store }],
    });

    const fixture = TestBed.createComponent(ProjectInputComponent);
    fixture.detectChanges();

    return { fixture, component: fixture.componentInstance as any, store };
  }

  it('renders the three optional details as accessible free-form textareas', () => {
    const { fixture } = setup();
    const element = fixture.nativeElement as HTMLElement;

    for (const id of ['constraints', 'nfrs', 'hints']) {
      const textarea = element.querySelector(`#${id}`) as HTMLTextAreaElement | null;
      expect(textarea).not.toBeNull();
      expect(textarea?.tagName).toBe('TEXTAREA');
      expect(textarea?.rows).toBe(4);
      expect(textarea?.getAttribute('aria-describedby')).toBe(`${id}-hint`);
      expect(element.querySelector(`#${id}-hint`)?.textContent).toContain('Optional free-form');
    }

    expect(element.textContent).not.toContain('one per line');
    expect(element.textContent).not.toContain('comma-separated');
  });

  it('allows all optional details to remain empty for automatic inference', () => {
    const { component } = setup();
    let emitted: GeneratePromptInput | undefined;
    component.generate.subscribe((value: GeneratePromptInput) => {
      emitted = value;
    });

    component.form.controls.title.setValue('Acme Planner');
    component.form.controls.idea.setValue(
      'Create an architecture planner for internal product and engineering teams.',
    );

    expect(component.form.valid).toBe(true);
    expect(component.form.controls.technicalConstraints.value).toBe('');
    expect(component.form.controls.nfrs.value).toBe('');
    expect(component.form.controls.hints.value).toBe('');

    component.submit();

    expect(emitted).toEqual({
      title: 'Acme Planner',
      idea: 'Create an architecture planner for internal product and engineering teams.',
      technicalConstraints: '',
      nfrs: '',
      hints: '',
      contextAttachments: [],
    });
  });

  it('hydrates unrestricted text without converting it into list items', () => {
    const pendingInput: GeneratePromptInput = {
      title: 'Acme Planner',
      idea: 'Create an architecture planner for internal product teams.',
      technicalConstraints:
        'The browser is the deployment target, but an existing corporate OIDC service is available.\n\nOther implementation choices are open.',
      nfrs: 'Fast for remote teams. Accessibility matters, especially keyboard navigation.',
      hints: 'The team knows Angular and SQL. Recommend the rest of the stack.',
      contextAttachments: [],
    };

    const { fixture } = setup(pendingInput);
    const element = fixture.nativeElement as HTMLElement;

    expect((element.querySelector('#constraints') as HTMLTextAreaElement).value).toBe(
      pendingInput.technicalConstraints,
    );
    expect((element.querySelector('#nfrs') as HTMLTextAreaElement).value).toBe(pendingInput.nfrs);
    expect((element.querySelector('#hints') as HTMLTextAreaElement).value).toBe(pendingInput.hints);
  });

  it('emits arbitrary prose, paragraphs, lists, and commas without restructuring them', () => {
    const { component } = setup();
    let emitted: GeneratePromptInput | undefined;
    component.generate.subscribe((value: GeneratePromptInput) => {
      emitted = value;
    });

    component.form.setValue({
      title: ' Acme Planner ',
      idea: ' Create an architecture planner for internal product and engineering teams. ',
      technicalConstraints:
        '  Browser deployment is preferred, with no server managed by our team.\n\nExisting integration: corporate OIDC.  ',
      nfrs: '  Keep the experience fast for remote users.\n- Accessibility is important\nThe architect should determine measurable targets.  ',
      hints:
        '  We know Angular, PostgreSQL is available, and the architect may select everything else.  ',
    });
    component.submit();

    expect(emitted).toEqual({
      title: 'Acme Planner',
      idea: 'Create an architecture planner for internal product and engineering teams.',
      technicalConstraints:
        'Browser deployment is preferred, with no server managed by our team.\n\nExisting integration: corporate OIDC.',
      nfrs: 'Keep the experience fast for remote users.\n- Accessibility is important\nThe architect should determine measurable targets.',
      hints:
        'We know Angular, PostgreSQL is available, and the architect may select everything else.',
      contextAttachments: [],
    });
  });

  it('resets all fields and context attachments when the store signals a planner reset', () => {
    const pending: GeneratePromptInput = {
      title: 'Old Project',
      idea: 'A long enough description of a previously typed idea.',
      technicalConstraints: 'Browser deployment is preferred.',
      nfrs: 'Fast.',
      hints: 'Angular.',
      contextAttachments: [],
    };
    const { component, fixture, store } = setup(pending);
    expect(component.form.controls.title.value).toBe('Old Project');

    store.plannerResetTick.set(1);
    fixture.detectChanges();

    expect(component.form.controls.title.value).toBe('');
    expect(component.form.controls.idea.value).toBe('');
    expect(component.form.controls.technicalConstraints.value).toBe('');
    expect(component.form.controls.nfrs.value).toBe('');
    expect(component.form.controls.hints.value).toBe('');
    expect(store.setPendingInput).toHaveBeenCalledWith(
      expect.objectContaining({
        title: '',
        idea: '',
        technicalConstraints: '',
        nfrs: '',
        hints: '',
      }),
    );
  });

  it('emits refine when the Refine button is clicked with a valid form', () => {
    const { component, fixture } = setup();
    let generated: GeneratePromptInput | undefined;
    let refined: GeneratePromptInput | undefined;
    component.generate.subscribe((value: GeneratePromptInput) => {
      generated = value;
    });
    component.refine.subscribe((value: GeneratePromptInput) => {
      refined = value;
    });

    component.form.controls.title.setValue('Acme Planner');
    component.form.controls.idea.setValue(
      'Create an architecture planner for internal product and engineering teams.',
    );
    fixture.detectChanges();

    const buttons = (Array.from(fixture.nativeElement.querySelectorAll('button')) as HTMLButtonElement[]);
    const refineButton = buttons.find((b) => b.textContent?.trim().startsWith('Refine'));
    expect(refineButton).toBeDefined();
    refineButton?.click();

    expect(refined).toEqual({
      title: 'Acme Planner',
      idea: 'Create an architecture planner for internal product and engineering teams.',
      technicalConstraints: '',
      nfrs: '',
      hints: '',
      contextAttachments: [],
    });
    expect(generated).toBeUndefined();
  });

  it('does not emit refine when the form is invalid', () => {
    const { component, fixture } = setup();
    let refined: GeneratePromptInput | undefined;
    component.refine.subscribe((value: GeneratePromptInput) => {
      refined = value;
    });

    component.form.controls.title.setValue('');
    component.form.controls.idea.setValue('too short');
    fixture.detectChanges();

    const buttons = (Array.from(fixture.nativeElement.querySelectorAll('button')) as HTMLButtonElement[]);
    const refineButton = buttons.find((b) => b.textContent?.trim().startsWith('Refine'));
    refineButton?.click();

    expect(refined).toBeUndefined();
  });
});
