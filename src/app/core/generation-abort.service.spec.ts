import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { GenerationAbortService } from './generation-abort.service';

describe('GenerationAbortService', () => {
  it('aborts the registered controller when abort() is called', () => {
    const service = TestBed.inject(GenerationAbortService);
    const controller = new AbortController();
    service.setActive(controller);
    expect(controller.signal.aborted).toBe(false);
    service.abort();
    expect(controller.signal.aborted).toBe(true);
  });

  it('does not throw when abort() is called with no active controller', () => {
    const service = TestBed.inject(GenerationAbortService);
    service.setActive(null);
    expect(() => service.abort()).not.toThrow();
  });

  it('isActive() reflects whether the registered controller has been aborted', () => {
    const service = TestBed.inject(GenerationAbortService);
    expect(service.isActive()).toBe(false);
    const controller = new AbortController();
    service.setActive(controller);
    expect(service.isActive()).toBe(true);
    controller.abort();
    expect(service.isActive()).toBe(false);
  });

  it('clears the active controller when setActive(null) is called', () => {
    const service = TestBed.inject(GenerationAbortService);
    const controller = new AbortController();
    service.setActive(controller);
    service.setActive(null);
    expect(service.isActive()).toBe(false);
  });
});
