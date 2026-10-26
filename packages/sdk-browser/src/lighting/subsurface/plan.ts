import {
  subsurfaceCheckerboardOn,
  subsurfaceRecombineHigh,
  type SubsurfaceScatteringSettings,
} from '../../../../sdk-core/src/contracts/subsurfaceScatteringOptions.ts'
import { ceilDiv } from '../../../../math/src/scalar/integers.ts'
import { SSS_MAX_MIPS, SSS_TILE } from './layout.ts'
import type { SubsurfaceShape } from './shape.ts'

/** A size in the scattering's resolution: half of it, rounded up, in half resolution. */
export const subOf = (
  size: readonly number[],
  half: boolean,
  out: [number, number] = [0, 0],
): [number, number] => {
  const scale = half ? 2 : 1
  out[0] = ceilDiv(size[0], scale)
  out[1] = ceilDiv(size[1], scale)
  return out
}

/** The shape of the programs the settings ask for, for an image accumulated in time or not. */
export function subsurfaceShapeOf(
  settings: SubsurfaceScatteringSettings,
  accumulates: boolean,
): SubsurfaceShape {
  return {
    half: settings.half,
    forceSeparable: settings.forceSeparable,
    cache: settings.profileIdCache,
    sampleSet: settings.sampleSet,
    bilateral: settings.bilateralKernel === 1,
    high: subsurfaceRecombineHigh(settings, accumulates),
    checker: subsurfaceCheckerboardOn(settings),
    filter: settings.filter,
  }
}

/** What a view's textures and buffers are made for: the textures of the image's resolution (`scene`), of the scattering's (`sub`, half
 *  of it in half resolution, rounded up), the mips of the setup texture (more than one only where the sampled scattering runs at
 *  the image's size and reads them), whether the scattering keeps its quality history and the profile ids' texture, the ids' format
 *  and the most tiles a list holds. */
export interface SubsurfaceViewSpec {
  readonly scene: readonly [number, number]
  readonly sub: readonly [number, number]
  readonly mips: number
  readonly history: boolean
  readonly ids: boolean
  readonly tier1: boolean
  readonly capacity: number
  readonly key: string
}

/** Two specs the same are one key: the fields that decide the resources. */
const specKey = (s: Omit<SubsurfaceViewSpec, 'key' | 'capacity'>) =>
  [s.scene, s.sub, s.mips, s.history, s.ids, s.tier1].join()

/** The spec of a view for `shape` over targets of `allocated` pixels. */
export function subsurfaceSpecOf(
  shape: SubsurfaceShape,
  allocated: readonly [number, number],
  tier1: boolean,
): SubsurfaceViewSpec {
  const sub = subOf(allocated, shape.half)
  const mips = shape.forceSeparable
    ? 1
    : Math.min(SSS_MAX_MIPS, 1 + Math.floor(Math.log2(Math.min(sub[0], sub[1]))))
  const fields = {
    scene: allocated,
    sub,
    mips,
    history: !shape.forceSeparable,
    ids: shape.cache,
    tier1,
  }
  return {
    ...fields,
    capacity: ceilDiv(sub[0], SSS_TILE) * ceilDiv(sub[1], SSS_TILE),
    key: specKey(fields),
  }
}

/** The tiles of the drawn view in the scattering's resolution. */
export const subsurfaceTilesOf = (
  drawn: readonly number[],
  half: boolean,
  out: [number, number] = [0, 0],
): [number, number] => {
  subOf(drawn, half, out)
  out[0] = ceilDiv(out[0], SSS_TILE)
  out[1] = ceilDiv(out[1], SSS_TILE)
  return out
}
