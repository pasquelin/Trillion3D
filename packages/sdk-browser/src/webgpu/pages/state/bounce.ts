import type { GpuBounceProbes } from '../../../bounce/bounceProbes.ts';

/**
 * State of bouncing light: the probe grid, what the host asked of it, and what the last image
 * actually did. Nothing is allocated per image.
 */
export interface WebgpuBounceState {
  probes: GpuBounceProbes | undefined;
  /** In-flight load of the resident proxy; it is launched only once, at the first light. */
  pending: Promise<unknown> | undefined;
  /** What the host asked. */
  wanted: boolean;
  /** Target duration of the Bounce stage per image, in milliseconds: the host's instruction. */
  budgetMs: number;
  /** Why bounce does not exist, when it does not. */
  reason: string | null;
  /** Light-store revision already seen: a change restarts convergence. */
  lightEpoch: number;
  /** Probes updated and rays launched by the last image; zero when nothing was encoded. */
  probesUpdated: number;
  raysLaunched: number;
  /** True when the last image actually encoded the probe pass. */
  encoded: boolean;
  firstFrameLogged: boolean;
}

export function createWebgpuBounceState(wanted: boolean, budgetMs: number): WebgpuBounceState {
  return {
    probes: undefined,
    pending: undefined,
    wanted,
    budgetMs,
    reason: null,
    lightEpoch: 0,
    probesUpdated: 0,
    raysLaunched: 0,
    encoded: false,
    firstFrameLogged: false,
  };
}
