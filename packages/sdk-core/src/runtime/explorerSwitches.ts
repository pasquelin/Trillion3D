/** What the engine does with an explorer on/off option (`MeasuredWorldOptions`) the host leaves
 *  out; the LLM schema of the options advertises the same values. */
const EXPLORER_SWITCHES = {
  interactive: false,
  bounce: false,
  importedLights: true,
  stageProfile: false,
} as const

/** The name of an explorer switch. */
export type ExplorerSwitch = keyof typeof EXPLORER_SWITCHES

/** The default of switch `key`, as a call: a module that reads it through a call marked pure is
 *  still dropped from a bundle that never uses it, where a property read would be kept. */
export const explorerSwitchDefault = (key: ExplorerSwitch): boolean => EXPLORER_SWITCHES[key]

/** Switch `key` of `options`, as the engine has always read it: a switch on by default is turned
 *  off only by `false`; one off by default is turned on by `true`, except `interactive`, which the
 *  engine has always turned on for any truthy value (a JavaScript host passing `1`). A missing
 *  value keeps the default. */
export const explorerSwitch = (
  options: { readonly [K in ExplorerSwitch]?: boolean },
  key: ExplorerSwitch,
): boolean => {
  const value = options[key]
  if (EXPLORER_SWITCHES[key]) return value !== false
  return key === 'interactive' ? !!value : value === true
}
