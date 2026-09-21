import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { vi } from 'vitest';
import { Confirmation, ConfirmationService } from 'primeng/api';
import { ProjectStore } from '../../core/project.store';
import { ClearKeysComponent } from './clear-keys.component';

describe('ClearKeysComponent', () => {
  const initialKeys: Record<string, string> = {
    openrouter: '',
    lmstudio: '',
    claude: '',
    chatgpt: '',
    grok: '',
    minimax: '',
  };

  function setupStore(keys: Record<string, string> = { ...initialKeys }) {
    const providerApiKeysRecord: Record<string, string> = { ...keys };
    const providerApiKeys = signal<Record<string, string>>({ ...providerApiKeysRecord });
    const confirmCalls: Confirmation[] = [];
    let nextAcceptShouldFire = true;



    const confirmation = new ConfirmationService();
    vi.spyOn(confirmation, 'confirm').mockImplementation((call: Confirmation) => {
      confirmCalls.push(call);
      if (nextAcceptShouldFire) {
        call.accept?.();
      }
      return confirmation;
    });

    const store = {
      providerApiKeys: () => providerApiKeys(),
      providerApiKeyFor: (provider: string) => providerApiKeys()[provider] ?? '',
      setApiKey: vi.fn((apiKey: string, provider: string) => {
        providerApiKeys.set({ ...providerApiKeys(), [provider]: apiKey });
      }),
      clearAllApiKeys: vi.fn(() => {
        const cleared: Record<string, string> = {};
        for (const key of Object.keys(providerApiKeys())) {
          cleared[key] = '';
        }
        providerApiKeys.set(cleared);
      }),
    };

    TestBed.configureTestingModule({
      imports: [ClearKeysComponent],
      providers: [
        { provide: ProjectStore, useValue: store },
        { provide: ConfirmationService, useValue: confirmation },
      ],
    })



      .overrideComponent(ClearKeysComponent, {
        remove: { providers: [ConfirmationService] },
      });

    const fixture = TestBed.createComponent(ClearKeysComponent);
    fixture.detectChanges();

    return {
      fixture,
      component: fixture.componentInstance as unknown as ClearKeysComponent,
      store,
      confirmation,
      getKeys: () => providerApiKeys(),
      confirmCalls,
      setAcceptFires: (value: boolean) => {
        nextAcceptShouldFire = value;
      },
    };
  }

  function findClearButton(fixture: { nativeElement: HTMLElement }): HTMLButtonElement | null {
    const host = fixture.nativeElement.querySelector(
      '[data-testid="clear-keys-button"]',
    ) as HTMLElement | null;
    if (!host) return null;
    if (host.tagName === 'BUTTON') return host as HTMLButtonElement;
    return host.querySelector('button') ?? (host as unknown as HTMLButtonElement);
  }

  function findCount(fixture: { nativeElement: HTMLElement }): HTMLElement | null {
    return fixture.nativeElement.querySelector('[data-testid="saved-keys-count"]');
  }

  it('disables the Clear button when no keys are saved', () => {
    const { fixture } = setupStore();
    const button = findClearButton(fixture);
    expect(button).not.toBeNull();
    expect(button!.disabled).toBe(true);
    expect(findCount(fixture)?.textContent).toContain('0 of');
  });

  it('enables the Clear button after a key is saved', () => {
    const { fixture, store } = setupStore();
    store.setApiKey('sk-openai-1234567890', 'openrouter');
    fixture.detectChanges();

    const button = findClearButton(fixture);
    expect(button!.disabled).toBe(false);
    expect(findCount(fixture)?.textContent).toContain('1 of');
  });

  it('counts every non-empty slot across providers', () => {
    const { fixture, store } = setupStore();
    store.setApiKey('sk-openai-1234567890', 'openrouter');
    store.setApiKey('sk-ant-1234567890', 'claude');
    store.setApiKey('sk-gpt-1234567890', 'chatgpt');
    fixture.detectChanges();

    expect(findCount(fixture)?.textContent).toContain('3 of');
  });

  it('opens a confirm dialog with danger copy when the Clear button is clicked', () => {
    const { fixture, store, component, confirmation, confirmCalls } = setupStore();
    store.setApiKey('sk-openai-1234567890', 'openrouter');
    fixture.detectChanges();

    component.onClearClick();

    expect(confirmation.confirm).toHaveBeenCalledTimes(1);
    expect(confirmCalls[0].header).toBe('Clear all API keys?');
    expect(confirmCalls[0].message).toContain('cannot be undone');
    expect(confirmCalls[0].accept).toEqual(expect.any(Function));
  });

  it('calls clearAllApiKeys and renders a success message when the user accepts', () => {
    const { fixture, store, component, getKeys } = setupStore();
    store.setApiKey('sk-openai-1234567890', 'openrouter');
    store.setApiKey('sk-ant-1234567890', 'claude');
    fixture.detectChanges();

    component.onClearClick();
    fixture.detectChanges();

    expect(store.clearAllApiKeys).toHaveBeenCalledTimes(1);
    expect(getKeys()['openrouter']).toBe('');
    expect(getKeys()['claude']).toBe('');
    expect(findCount(fixture)?.textContent).toContain('0 of');

    const buttonAfter = findClearButton(fixture)!;
    expect(buttonAfter.disabled).toBe(true);

    const successMessage = fixture.nativeElement.querySelector('.p-message-success');
    expect(successMessage).not.toBeNull();
    expect(successMessage?.textContent).toContain('cleared');
  });

  it('does not call clearAllApiKeys when the user rejects the confirm dialog', () => {
    const { fixture, store, component, setAcceptFires } = setupStore();
    store.setApiKey('sk-openai-1234567890', 'openrouter');
    fixture.detectChanges();

    setAcceptFires(false);

    component.onClearClick();
    fixture.detectChanges();

    expect(store.clearAllApiKeys).not.toHaveBeenCalled();
    expect(findCount(fixture)?.textContent).toContain('1 of');
  });

  it('does not open the confirm dialog when there are no keys (defensive guard)', () => {
    const { component, confirmation } = setupStore();
    component.onClearClick();

    expect(confirmation.confirm).not.toHaveBeenCalled();
  });
});
