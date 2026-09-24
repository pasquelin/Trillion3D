/**
 * A WebGL2 context double for the unit tests of the engine's composition programs: every
 * constant answers itself by name, every call is recorded with its arguments, GPU objects are
 * numbered so a test can tell one from another, and the context can be declared lost. `answers`
 * replaces the recording of the calls it names by the given functions: a queried extension or
 * parameter, say.
 */
type RecordedCall = { name: string; args: unknown[] };

export function createTestContext(
  options: { lost?: boolean; answers?: Record<string, unknown> } = {},
) {
  const calls: RecordedCall[] = [];
  const listeners = new Map<string, Set<EventListener>>();
  let objects = 0;
  const canvas = {
    width: 8,
    height: 4,
    addEventListener(type: string, listener: EventListener) {
      (listeners.get(type) ?? listeners.set(type, new Set()).get(type)!).add(listener);
    },
    removeEventListener(type: string, listener: EventListener) {
      listeners.get(type)?.delete(listener);
    },
    /** Fires one event and drops its `once` listeners, as the browser does. */
    dispatch(type: string) {
      const set = listeners.get(type);
      for (const listener of [...(set ?? [])]) {
        set?.delete(listener);
        listener(new Event(type));
      }
    },
  };
  const state = { lost: options.lost === true };
  const fixed: Record<string, unknown> = {
    canvas,
    drawingBufferWidth: canvas.width,
    drawingBufferHeight: canvas.height,
    isContextLost: () => state.lost,
    getShaderParameter: () => true,
    getProgramParameter: () => true,
    getShaderInfoLog: () => '',
    getProgramInfoLog: () => '',
    getUniformLocation: (_program: unknown, name: string) => ({ uniform: name }),
    getAttribLocation: () => 0,
    checkFramebufferStatus: () => 'FRAMEBUFFER_COMPLETE',
    ...options.answers,
  };
  const gl = new Proxy(
    {},
    {
      get: (_target, name: string) => {
        if (name in fixed) return fixed[name];
        if (/^[A-Z0-9_]+$/.test(name)) return name;
        return (...args: unknown[]) => {
          calls.push({ name, args });
          return name.startsWith('create') ? { [name]: ++objects } : undefined;
        };
      },
    },
  ) as unknown as WebGL2RenderingContext;
  return {
    gl,
    calls,
    canvas,
    state,
    names: () => calls.map((call) => call.name),
    /** The recorded calls of one name, arguments only. */
    of: (name: string) => calls.filter((call) => call.name === name).map((call) => call.args),
  };
}
