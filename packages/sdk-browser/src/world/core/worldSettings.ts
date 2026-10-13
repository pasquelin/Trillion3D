/**
 * The engine's render settings (`../../../../sdk-core/src/runtime/renderSettings.ts`): each default
 * is the constant the engine reads today, referenced, never copied. A switch with no constant of
 * its own defaults to what the engine does without it: the pass drawn, the bounce off.
 */
import { LOD_QUALITY } from '../../../../sdk-core/src/lod/policy.ts'
import {
  createRenderSettings,
  type QualityGroup,
  type RenderSettingEntry,
} from '../../../../sdk-core/src/runtime/renderSettings.ts'
import { MAX_ANISOTROPY } from '../../texture/maxAnisotropy.ts'
import { VSM_POOL_PAGES } from '../../vsm/constants.ts'

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
const count = (
  value: number,
  range: readonly [number, number],
  group: QualityGroup,
  apply: Apply,
  extra?: Extra,
) => ({
  kind: 'int' as const,
  default: value,
  range,
  ...base(group, apply, extra),
})
const cache = { invalidates: 'shadowCache' } as const

/** Every render setting of the engine, by name. */
const WORLD_SETTINGS = {
  // Wired: the world applies them (`worldSwitches.ts`).
  pixelError: {
    kind: 'float',
    default: LOD_QUALITY.source.pixelError,
    range: [0, Number.MAX_VALUE],
    ...base('viewDistance', 'frame'),
  },
  antialiasing: flag(true, 'edgeSmoothing', 'pipeline', { invalidates: 'taaHistory' }),
  bounce: flag(false, 'indirectLight', 'resources'),
  // Registered; their passes do not read the registry yet.
  dynamicShadows: flag(true, 'shadows', 'frame', cache),
  glass: flag(true, 'effects', 'frame'),
  particles: flag(true, 'effects', 'frame'),
  postProcessing: flag(true, 'imageEffects', 'frame'),
  maxAnisotropy: count(MAX_ANISOTROPY, [1, MAX_ANISOTROPY], 'textures', 'uniform'),
  // The pool shrinks to an eighth at most, as the grant does (`vsmGrant.ts`).
  shadowPages: count(
    VSM_POOL_PAGES,
    [VSM_POOL_PAGES / 8, VSM_POOL_PAGES],
    'shadows',
    'resources',
    cache,
  ),
} as const satisfies Readonly<Record<string, RenderSettingEntry>>

/** A world's registry over the engine's settings. */
export const createWorldSettings = () => createRenderSettings(WORLD_SETTINGS)
/** A world's settings registry. */
export type WorldSettings = ReturnType<typeof createWorldSettings>
