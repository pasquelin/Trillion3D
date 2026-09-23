/**
 * A GPU object that lives as long as the context does. A lost context takes every program,
 * texture and buffer with it; nothing can be drawn until it comes back, and what comes back is
 * rebuilt — the names of a dead context never work again. `current()` answers the live object,
 * building it on first use and again after a loss, or `null` while the context is lost.
 */
export function boundToContext<T>(
  gl: WebGL2RenderingContext,
  build: () => T,
  discard: (value: T) => void = () => {},
) {
  let value: T | undefined,
    armed = false;
  const lost = () => {
    value = undefined;
    armed = false;
  };
  return {
    /** True while the object built on the live context is still there: nothing lost since. */
    alive() {
      return value !== undefined && !gl.isContextLost();
    },
    current(): T | null {
      if (gl.isContextLost()) return null;
      if (value === undefined) {
        value = build();
        if (!armed) {
          gl.canvas.addEventListener('webglcontextlost', lost, { once: true });
          armed = true;
        }
      }
      return value;
    },
    /** Discards the object on a live context and forgets it either way; `current()` rebuilds. */
    dispose() {
      gl.canvas.removeEventListener('webglcontextlost', lost);
      if (value !== undefined && !gl.isContextLost()) discard(value);
      lost();
    },
  };
}
