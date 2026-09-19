/**
 * Published contract of the compute-path governor (`mathPathGovernor.ts`), version 1.
 *
 * What the host reads in the metrics is what the governor has MEASURED, never an estimate:
 * a median that no execution has fed is `null`, and a path that no decision has
 * yet settled is `null` too. Zero would say "measured at zero".
 */

/** The two paths carried. JavaScript is the reference and the fallback; Wasm is the accelerated one. */
export type MathPath = 'js' | 'wasm';
/** What a host asks for: a path imposed for a campaign, or arbitration by measurement. */
export type MathPathMode = MathPath | 'auto';

/** Version of this report's contract. A host that does not know it does not read the fields. */
export const MATH_PATH_CONTRACT = 1;

/** Report of a named batch operation. */
export interface MathPathOperation {
  /** The path the next execution will play, `null` until none has taken place. */
  path: MathPath | null;
  /** Sliding median of duration per element, in nanoseconds; `null` if unmeasured. */
  jsNsPerElement: number | null;
  wasmNsPerElement: number | null;
  /** Executions retained in each median. */
  jsSamples: number;
  wasmSamples: number;
  /** Switches decided since the start of the session. */
  switches: number;
  /** Elements processed since the start of the session, all paths combined. */
  elements: number;
}

/** Governor state for the whole session. */
export interface MathPathMetrics {
  contract: number;
  mode: MathPathMode;
  /** The WebAssembly module is loaded, at the right contract version. */
  wasmAvailable: boolean;
  /** The module was compiled with `simd128`; `null` until a module is loaded. */
  wasmSimd: boolean | null;
  /** Thread clock resolution, in milliseconds; `null` until it has been estimated. */
  clockResolutionMs: number | null;
  /** True when the clock is too coarse to arbitrate: everything stays on the JavaScript path. */
  clockCoarse: boolean;
  /** Why the WebAssembly path is not playable, or `null` when it is. */
  unavailableReason: string | null;
  operations: Record<string, MathPathOperation>;
}
