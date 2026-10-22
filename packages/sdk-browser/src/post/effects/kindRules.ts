import type { EffectKind, EffectStage } from '../../../../sdk-core/src/world/effect/chain.ts'
import {
  DEPTH_OF_FIELD_RULES,
  type DepthOfFieldValues,
} from '../../../../sdk-core/src/contracts/depthOfFieldRules.ts'
import { BLOOM_RULES, type BloomValues } from '../../../../sdk-core/src/contracts/bloomRules.ts'
import {
  GAUSSIAN_BLUR_RULES,
  type GaussianBlurValues,
} from '../../../../sdk-core/src/contracts/gaussianBlurRules.ts'
import type { SettingRule } from '../../../../sdk-core/src/contracts/settingRules.ts'
import {
  MOTION_BLUR_RULES,
  motionBlurIdle,
  type MotionBlurValues,
} from '../../../../sdk-core/src/contracts/motionBlurOptions.ts'
import { bloomBytes } from './bloom/bloomFilter.ts'
import { motionBlurBytes } from './motionBlur/motionBlurLayout.ts'
import { outlineBytes } from './outline/outlineTarget.ts'
import type { WebgpuPagesRuntime } from '../../frame/backend/runtime.ts'
import { askBloomPrograms } from './bloom/bloomAsk.ts'
import type { EffectPassOf } from './targets.ts'

/** What the view's settings of each kind resolve to (`KIND_RULES[kind].settings`): the values its
 *  `encode` or `resolve` is handed, by kind. A kind with no entry reads none. */
export interface KindValues {
  /** The bloom's own settings and the Gaussian blur's, which its levels are blurred by. */
  bloom: BloomValues & GaussianBlurValues
  motionBlur: MotionBlurValues
  depthOfField: DepthOfFieldValues
}
/** The values of the view's settings kind `K` reads. */
export type ValuesOf<K extends EffectKind> = K extends keyof KindValues ? KindValues[K] : undefined

/** What the view says of one kind besides how it is drawn (`WEBGPU_KINDS`). */
interface KindRules<K extends EffectKind> {
  /** The stage the kind's passes run at, as its pass says (`EffectPass.stage`): the one place the
   *  renderer reads it. */
  readonly stage: EffectPassOf<K>['stage']
  /** Bytes the kind holds on a `width × height` image, whatever the number of its passes: they run one
   *  after the other on the same resources (what the budget reserves for it, `effectChainBytesAt`). */
  readonly bytes: (width: number, height: number) => number
  /** The rules of the settings the view holds for the kind (`KindValues`): read once an image when the
   *  chain holds a pass of it that draws, handed to the kind, and a change of them redraws a view that
   *  rests (`createKindSettings`). */
  readonly settings?: Readonly<Record<string, SettingRule>>
  /** Whether the settings turn the kind off: a pass of it then draws nothing, and the image is drawn
   *  as without it. */
  readonly off?: (values: ValuesOf<K>) => boolean
  /** Whether a pass of the kind draws nothing as the view's settings leave it, in place of the pass's
   *  own `idle`: the strength and the reach of a pass may be set by the view, an idle pass of its
   *  own then drawing. */
  readonly idle?: (pass: EffectPassOf<K>, values: ValuesOf<K>) => boolean
  /** Asks the programs a pass of the kind that draws needs beyond its own compile (`askEffectPrograms`):
   *  of `device`, off the frame, the frames held until they landed. */
  readonly ask?: (pass: EffectPassOf<K>, device: GPUDevice, rt: WebgpuPagesRuntime) => void
  /** Whether a pass of the kind reads the motion the velocity stage measures. */
  readonly motion?: boolean
  /** The smallest object, in percent of the screen, whose own motion the kind's pass wants measured,
   *  which the velocity stage decides once for every pass that reads it. */
  readonly objectSize?: (pass: EffectPassOf<K>) => number
}

/**
 * WHAT THE FRAME'S ENTRY KNOWS OF EACH EFFECT KIND, one table, light enough to be read before a kind's
 * code has arrived (`WEBGPU_KINDS` holds the code): its stage, the bytes it holds, the settings the
 * view has of it, what turns it off, whether it reads the motion. A kind adds its entry here, its
 * values to `KindValues` and its code to `WEBGPU_KINDS`, and no site of its own.
 */
export const KIND_RULES: { readonly [K in EffectKind]: KindRules<K> } = {
  depthOfField: {
    stage: 'before-resolve',
    // Off until a focus distance is set: nothing is reserved for it, its images are held — and counted
    // by the budget as held (`ActiveGpuMemory.effectTargets`) — only while it draws.
    bytes: () => 0,
    settings: DEPTH_OF_FIELD_RULES,
    off: (values) => values.depthOfFieldQuality === 'off',
  },
  motionBlur: {
    stage: 'after-resolve',
    bytes: motionBlurBytes,
    settings: MOTION_BLUR_RULES,
    off: (values) => values.motionBlurQuality === 'off',
    idle: motionBlurIdle,
    motion: true,
    objectSize: (pass) => pass.perObjectSize,
  },
  bloom: {
    stage: 'before-tone-mapping',
    bytes: bloomBytes,
    settings: { ...BLOOM_RULES, ...GAUSSIAN_BLUR_RULES },
    off: (values) => values.bloomQuality === 'off',
    ask: askBloomPrograms,
  },
  outline: { stage: 'after-tone-mapping', bytes: outlineBytes },
}

/** Every kind, read off the one table typed by all of them. */
export const EFFECT_KINDS = Object.keys(KIND_RULES) as readonly EffectKind[]

/** The kinds whose passes run at `stage`, read off the table. */
export const kindsAt = (stage: EffectStage) =>
  EFFECT_KINDS.filter((kind) => KIND_RULES[kind].stage === stage)
