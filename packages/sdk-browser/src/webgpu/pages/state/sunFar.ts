import type { GpuSunFarShadow } from '../../../gpu/shadow/sunFarShadow.ts';

/**
 * State of the sun's far shadow: the settings and counts block, the proxy it traces, and why there
 * is none when there is none. Nothing is allocated per image.
 */
export interface WebgpuSunFarState {
  gpu: GpuSunFarShadow | undefined;
  /** In-flight load of the resident proxy; it is launched only once, at the first light. */
  pending: Promise<unknown> | undefined;
  /** True when the traced proxy is bouncing light's, borrowed and not reloaded. */
  borrowed: boolean;
  /** Why the far shadow does not exist, when it does not. */
  reason: string | null;
  published: boolean;
}

export function createWebgpuSunFarState(): WebgpuSunFarState {
  return { gpu: undefined, pending: undefined, borrowed: false, reason: null, published: false };
}
