/**
 * The engine's render settings (`../../../../sdk-core/src/runtime/renderSettings.ts`): each default
 * is the constant the engine reads today, referenced, never copied. A switch with no constant of
 * its own defaults to what the engine does without it: the pass drawn, the bounce off.
 */
import { LOD_QUALITY } from '../../../../sdk-core/src/lod/policy.ts';
import { LIGHT_SETTINGS } from '../../../../sdk-core/src/scene/light/contracts.ts';
import {
  createRenderSettings,
  type QualityGroup,
  type RenderSettingEntry,
} from '../../../../sdk-core/src/runtime/renderSettings.ts';
import { MAX_ANISOTROPY } from '../../texture/maxAnisotropy.ts';
import {
  VSM_CACHE_ON,
  VSM_POOL_PAGES,
  VSM_NORMAL_BIAS,
  VSM_SUN_LEVEL_BIAS,
  VSM_SUN_LEVEL_BIAS_MOVING,
  VSM_LOCAL_LEVEL_BIAS,
  VSM_LOCAL_LEVEL_BIAS_MOVING,
  VSM_TRACE_SLOPE_CAP_SUN,
  VSM_TRACE_SLOPE_CAP_LOCAL,
  VSM_TRACE_RAYS_SUN,
  VSM_TRACE_RAYS_LOCAL,
  VSM_TRACE_STEPS_SUN,
  VSM_TRACE_STEPS_LOCAL,
  VSM_TRACE_DITHER_SUN,
  VSM_TRACE_DITHER_LOCAL,
  VSM_COVER_SUN,
  VSM_COVER_LOCAL,
} from '../../vsm/constants.ts';
import { VSM_MASK_MAX_RAYS } from '../../vsm/projectionMaskTable.ts';

/** A count of the shadow maps' uniform block: an `i32` word, at least one. */
const COUNT = [1, 2 ** 31 - 1] as const;
/** A light's rays: as many as its shadow mask lane counts (`VSM_MASK_MAX_RAYS`). */
const RAYS = [1, VSM_MASK_MAX_RAYS] as const;
/** Any finite number. */
const FINITE = [-Number.MAX_VALUE, Number.MAX_VALUE] as const;

type Apply = RenderSettingEntry['apply'];
/** Who may write a setting, and what its change throws away: by default anyone, and nothing. */
type Extra = { editorOnly?: boolean; invalidates?: RenderSettingEntry['invalidates'] };
const base = (group: QualityGroup, apply: Apply, extra: Extra = {}) => ({
  apply,
  group,
  editorOnly: extra.editorOnly ?? false,
  invalidates: extra.invalidates ?? 'none',
});
const flag = (value: boolean, group: QualityGroup, apply: Apply, extra?: Extra) => ({
  kind: 'flag' as const,
  default: value,
  ...base(group, apply, extra),
});
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
});
/** A float of the shadows, any finite value. */
const shadowFloat = (value: number, apply: Apply, extra?: Extra) => ({
  kind: 'float' as const,
  default: value,
  range: FINITE,
  ...base('shadows', apply, extra),
});
const editor = { editorOnly: true };
const cache = { invalidates: 'shadowCache' } as const;
const editorCache = { ...editor, ...cache };

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
  reflections: flag(true, 'reflections', 'resources'),
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
  shadowCache: flag(VSM_CACHE_ON === 1, 'shadows', 'frame', editorCache),
  sunReceiverMask: flag(VSM_COVER_SUN, 'shadows', 'resources', editorCache),
  lampReceiverMask: flag(VSM_COVER_LOCAL, 'shadows', 'resources', editorCache),
  sunRays: count(VSM_TRACE_RAYS_SUN, RAYS, 'shadows', 'uniform'),
  sunSamplesPerRay: count(VSM_TRACE_STEPS_SUN, COUNT, 'shadows', 'uniform'),
  lampRays: count(VSM_TRACE_RAYS_LOCAL, RAYS, 'shadows', 'uniform'),
  lampSamplesPerRay: count(VSM_TRACE_STEPS_LOCAL, COUNT, 'shadows', 'uniform'),
  sunResolutionBias: shadowFloat(VSM_SUN_LEVEL_BIAS, 'frame'),
  sunResolutionBiasMoving: shadowFloat(VSM_SUN_LEVEL_BIAS_MOVING, 'frame'),
  lampResolutionBias: shadowFloat(VSM_LOCAL_LEVEL_BIAS, 'frame'),
  lampResolutionBiasMoving: shadowFloat(VSM_LOCAL_LEVEL_BIAS_MOVING, 'frame'),
  shadowNormalBias: shadowFloat(VSM_NORMAL_BIAS, 'uniform', editor),
  sunTexelDither: shadowFloat(VSM_TRACE_DITHER_SUN, 'uniform', editor),
  lampTexelDither: shadowFloat(VSM_TRACE_DITHER_LOCAL, 'uniform', editor),
  sunExtrapolateSlope: shadowFloat(VSM_TRACE_SLOPE_CAP_SUN, 'uniform', editor),
  lampExtrapolateSlope: shadowFloat(VSM_TRACE_SLOPE_CAP_LOCAL, 'uniform', editor),
  // Mode 2 is a variant of the blend and water programs (`directShadowWgsl`'s `traced`).
  translucentShadowFilter: {
    kind: 'enum',
    default: LIGHT_SETTINGS.translucentShadowFilter,
    values: [0, 1, 2],
    ...base('shadows', 'pipeline', editor),
  },
} as const satisfies Readonly<Record<string, RenderSettingEntry>>;

/** A world's registry over the engine's settings. */
export const createWorldSettings = () => createRenderSettings(WORLD_SETTINGS);
/** A world's settings registry. */
export type WorldSettings = ReturnType<typeof createWorldSettings>;
