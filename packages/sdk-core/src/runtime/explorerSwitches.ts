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

/** The two switches off by default that the engine has always turned on for any truthy value (a
 *  JavaScript host passing `1`); the others off by default turn on only for `true`. */
const TURNED_ON_BY_ANY_TRUTHY_VALUE: Partial<Record<ExplorerSwitch, true>> = {
  interactive: true,
  lodAdaptive: true,
};

/** Switch `key` of `options`, as the engine has always read it: a switch on by default is turned
 *  off only by `false`; one off by default is turned on by `true` (or, for `interactive` and
 *  `lodAdaptive`, by any truthy value). A missing value keeps the default. */
export const explorerSwitch = (
  options: { readonly [K in ExplorerSwitch]?: boolean },
  key: ExplorerSwitch,
): boolean => {
  const value = options[key];
  if (EXPLORER_SWITCHES[key]) return value !== false;
  return TURNED_ON_BY_ANY_TRUTHY_VALUE[key] ? !!value : value === true;
};
