import { Injectable } from '@angular/core';

/**
 * Holds the active generation's AbortController so the planner's Stop button
 * can cancel a generation that was kicked off from the editor (regenerate) or
 * from the planner itself (initial generate). Without this shared handle, the
 * planner's local AbortController would not reach the regeneration call.
 */
@Injectable({ providedIn: 'root' })
export class GenerationAbortService {
  private active: AbortController | null = null;

  setActive(controller: AbortController | null): void {
    this.active = controller;
  }

  abort(): void {
    this.active?.abort();
  }

  isActive(): boolean {
    return this.active !== null && !this.active.signal.aborted;
  }
}
