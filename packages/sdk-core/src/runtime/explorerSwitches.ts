/** What the engine does with an explorer on/off option (`MeasuredWorldOptions`) the host leaves
 *  out; the LLM schema of the options advertises the same values. */
export const EXPLORER_SWITCHES = {
  interactive: false,
  temporalAntialiasing: true,
  lodAdaptive: false,
  /** Shadow-map pages invalidated one by one, not the whole face. */
  shadowPageInvalidation: true,
  bounce: false,
  importedLights: true,
  /** Static WebGL2 pages without the source geometry buffers. */
  autonomousGeometry: false,
  stageProfile: false,
} as const;

/** The name of an explorer switch. */
export type ExplorerSwitch = keyof typeof EXPLORER_SWITCHES;

/** Switch `key` of `options`. A switch on by default is turned off only by `false`, one off by
 *  default is turned on only by `true`: a missing or non-boolean value keeps the default. */
export const explorerSwitch = (
  options: { readonly [K in ExplorerSwitch]?: boolean },
  key: ExplorerSwitch,
): boolean => (EXPLORER_SWITCHES[key] ? options[key] !== false : options[key] === true);
