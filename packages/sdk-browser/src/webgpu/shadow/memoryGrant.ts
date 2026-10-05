/** A memory-pressure event of the shadows, by name (see `ShadowMemory`). */
export type ShadowPressure = 'pool-shrunk' | 'pool-refused';

/**
 * THE SHADOWS' MEMORY PRESSURE. Memory pressure never passes for performance: nothing lowers a
 * page to meet a frame time, and each pressure is an event by name. A pool the device refuses is
 * drawn smaller (`pool-shrunk`, `bias` its halvings, 0 whenever the device grants what the budget
 * asks) or not at all (`pool-refused`, shadows off by name) (`../pages/render/vsm/vsmGrant.ts`).
 */
export type ShadowMemory = {
  bias: number;
  /** Replaced, never mutated, at each event: a frame's metrics publish it without a copy. */
  events: readonly ShadowPressure[];
};

export const createShadowMemory = (): ShadowMemory => ({ bias: 0, events: [] });

/** Records a pressure by name, once per allocation it concerns; `bias` the pool's halvings. */
export function noteShadowPressure(memory: ShadowMemory, name: ShadowPressure, bias = 0) {
  memory.events = [...memory.events, name];
  memory.bias = Math.max(memory.bias, bias);
}
