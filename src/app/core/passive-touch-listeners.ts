/**
 * Mark `touchmove` listeners passive by default to silence the Chrome
 * "[Violation] Added non-passive event listener to a scroll-blocking
 * 'touchmove' event" warning emitted by third-party UI libraries
 * (PrimeNG Slider, Table resizer, …) that register handlers via plain
 * Angular template bindings or `Renderer2.listen` without `passive: true`.
 *
 * Must be imported and executed before Angular bootstraps.
 */
const PASSIVE_TOUCH_EVENTS = new Set(['touchmove']);

export function installPassiveTouchListeners(): void {
  if (typeof EventTarget === 'undefined') return;
  const proto = EventTarget.prototype as EventTarget & {
    addEventListener: (
      type: string,
      listener: EventListenerOrEventListenerObject,
      options?: boolean | AddEventListenerOptions | undefined,
    ) => void;
  };
  if ((proto as unknown as { __passiveTouchPatched?: boolean }).__passiveTouchPatched) {
    return;
  }
  const original = proto.addEventListener;
  proto.addEventListener = function patchedAddEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions | undefined,
  ): void {
    if (PASSIVE_TOUCH_EVENTS.has(type)) {
      if (options === undefined || options === false) {
        original.call(this, type, listener, { passive: true });
        return;
      }
      if (typeof options === 'object' && options.passive === undefined) {
        original.call(this, type, listener, { ...options, passive: true });
        return;
      }
    }
    original.call(this, type, listener, options as never);
  };
  (proto as unknown as { __passiveTouchPatched?: boolean }).__passiveTouchPatched = true;
}

installPassiveTouchListeners();
