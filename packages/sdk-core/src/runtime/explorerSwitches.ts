// The on/off options of an explorer session (`MeasuredWorldOptions`), with what the engine does
// when one is not given. The engine reads each switch through `explorerSwitch`, and the LLM schema
// of the options (`../llm/explorerOptionsSchema.ts`) advertises the same values: one owner, so the
// two cannot disagree.

/** What the engine does with a switch the host leaves out. */
export const EXPLORER_SWITCHES = {
  /** Own controls, CSS/DPR sizing and demand-driven rendering: off. */
  interactive: false,
  /** Temporal antialiasing: on. */
  temporalAntialiasing: true,
  /** The LOD error threshold adapting to the workload: off. */
  lodAdaptive: false,
  /** Shadow-map pages invalidated one by one: on. */
  shadowPageInvalidation: true,
  /** Bounced light: off. */
  bounce: false,
  /** The lights the source file carried: declared. */
  importedLights: true,
  /** Static WebGL2 pages without the source geometry buffers: off. */
  autonomousGeometry: false,
  /** Per-step frame timing: off. */
  stageProfile: false,
} as const;

/** The name of an explorer switch. */
export type ExplorerSwitch = keyof typeof EXPLORER_SWITCHES;

/** Switch `key` of `options`: the host's own value, else the engine's default. */
export const explorerSwitch = (
  options: Partial<Record<ExplorerSwitch, boolean | null>>,
  key: ExplorerSwitch,
): boolean => options[key] ?? EXPLORER_SWITCHES[key];
