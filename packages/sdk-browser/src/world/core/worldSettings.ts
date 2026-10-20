/**
 * The engine's render settings (`../../../../sdk-core/src/runtime/renderSettings.ts`): each default
 * is the constant the engine reads today, referenced, never copied. A switch with no constant of
 * its own defaults to what the engine does without it: the pass drawn, the bounce off.
 */
import { DEFAULT_PIXEL_ERROR } from '../../../../sdk-core/src/lod/policy.ts'
import {
  DEFAULT_TEMPORAL_AA_LEVEL,
  TEMPORAL_AA_LEVELS,
} from '../../../../sdk-core/src/contracts/compilerAbi.ts'
import {
  createRenderSettings,
  type QualityGroup,
  type RenderSettingEntry,
} from '../../../../sdk-core/src/runtime/renderSettings.ts'

type Apply = RenderSettingEntry['apply']
/** Who may write a setting, and what its change throws away: by default anyone, and nothing. */
type Extra = { editorOnly?: boolean; invalidates?: RenderSettingEntry['invalidates'] }
const base = (group: QualityGroup, apply: Apply, extra: Extra = {}) => ({
  apply,
  group,
  editorOnly: extra.editorOnly ?? false,
  invalidates: extra.invalidates ?? 'none',
})
const flag = (value: boolean, group: QualityGroup, apply: Apply, extra?: Extra) => ({
  kind: 'flag' as const,
  default: value,
  ...base(group, apply, extra),
})

/** Every render setting of the engine, by name. */
const WORLD_SETTINGS = {
  // Wired: the world applies them (`worldSwitches.ts`).
  pixelError: {
    kind: 'float',
    default: DEFAULT_PIXEL_ERROR,
    range: [0, Number.MAX_VALUE],
    ...base('viewDistance', 'frame'),
  },
  // The temporal anti-aliasing's level, `'off'` none (`../../taa/levels.ts`).
  antialiasing: {
    kind: 'choice',
    default: DEFAULT_TEMPORAL_AA_LEVEL,
    choices: TEMPORAL_AA_LEVELS,
    ...base('edgeSmoothing', 'pipeline', { invalidates: 'taaHistory' }),
  },
  bounce: flag(false, 'indirectLight', 'resources'),
} as const satisfies Readonly<Record<string, RenderSettingEntry>>

/** A world's registry over the engine's settings. */
export const createWorldSettings = () => createRenderSettings(WORLD_SETTINGS)
/** A world's settings registry. */
export type WorldSettings = ReturnType<typeof createWorldSettings>
