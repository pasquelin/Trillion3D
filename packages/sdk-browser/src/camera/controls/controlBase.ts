import type { CameraControlBase, ChangeListener } from './controlTypes.ts';

/**
 * The socle every camera controller is built on: the `change` emitter the host listens to,
 * and the register of DOM listeners `dispose()` undoes.
 *
 * WHY A REGISTER. A controller installs its listeners on three surfaces — the canvas, the
 * document that owns it, the window that owns that document — and a host disposes it long
 * after. Anything installed through `listen` is removed by `dispose`, once, with the very
 * arguments it was installed with; nothing else may call `addEventListener`, and
 * `controls.test.ts` counts both sides to prove none is left behind.
 *
 * WHY `emit` IS NOT A FRAME. A controller emits only when the pose actually changed. A still
 * scene therefore schedules nothing: the host's `invalidate` is called on motion alone.
 */
export interface ControlBase {
  listen<T extends Event>(
    target: EventTarget,
    type: string,
    handler: (event: T) => void,
    options?: AddEventListenerOptions,
  ): void;
  /**
   * A teardown `dispose()` runs once, for the state that is not a listener: the surface's
   * `touch-action`, the pointers still captured. Same register, same guarantee.
   */
  undo(action: () => void): void;
  emit(): void;
  /** The three methods every controller re-publishes as-is. */
  api: Omit<CameraControlBase, 'object'>;
}

export function createControlBase(): ControlBase {
  const removals: Array<() => void> = [];
  const listeners = new Set<ChangeListener>();
  let gone = false;
  const undo = (action: () => void) => {
    removals.push(action);
  };
  return {
    listen(target, type, handler, options) {
      const bound = handler as EventListener;
      target.addEventListener(type, bound, options);
      undo(() => target.removeEventListener(type, bound, options));
    },
    undo,
    emit() {
      for (const listener of [...listeners]) listener();
    },
    api: {
      addEventListener(type, listener) {
        if (type === 'change') listeners.add(listener);
      },
      removeEventListener(type, listener) {
        if (type === 'change') listeners.delete(listener);
      },
      dispose() {
        if (gone) return;
        gone = true;
        for (const remove of removals.splice(0)) remove();
        listeners.clear();
      },
    },
  };
}

/**
 * The gate that keeps a still scene still: it remembers the numbers last emitted and calls
 * `emit` only when one of them changed. Every controller ends its motion here, so a host's
 * `invalidate` is bound to a pose that actually moved and never to a frame that merely passed.
 */
export function createChangeGate(base: ControlBase, size: number) {
  const sent = new Float64Array(size);
  let known = false;
  return (values: ArrayLike<number>) => {
    let moved = !known;
    for (let i = 0; i < size; i++) moved = moved || sent[i] !== values[i];
    if (!moved) return false;
    for (let i = 0; i < size; i++) sent[i] = values[i];
    known = true;
    base.emit();
    return true;
  };
}
