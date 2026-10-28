import type { GraphNode } from '../../../../sdk-core/src/world/material/graph/graph.ts'
import {
  SPARSE_ADDRESS_MODES,
  type NodeKind,
} from '../../../../sdk-core/src/world/material/graph/nodeSpecs.ts'
import { graphError } from '../../../../sdk-core/src/world/material/graph/valueType.ts'
import { footprint, slotWord } from './nodesTexture.ts'
import type { State } from './state.ts'
import { coerce, constantOf, type Value } from './value.ts'

/**
 * THE NODES THAT READ A SPARSE VOLUME TEXTURE (`sparseVolumeTextureObject`, `…Parameter`, `…Sample`).
 * A volume is held in a word of the values: the scene node that cites it (`Slots.sparseVolume`),
 * which the host's table of volumes names. A sample is compiled to the calls of the pass that
 * binds the volumes, which declares them (`svtCalculateMip`, `svtSample`, `svtVolumeUvw`;
 * `../../lighting/heterogeneousVolumes/sparseVolumeWgsl.ts` holds the reads they are made of):
 *
 * - `svtVolumeUvw(ctx)` is the coordinate of a sample that wires none: the point's place in the
 *   object's local bounds, `(local position - bounds minimum) / bounds size`
 *   (`MaterialExpressions.cpp:22244-22258`);
 * - `svtCalculateMip(volume, ddx, ddy, bias)` is the level the derivatives ask, plus the bias;
 * - `svtSample(volume, uvw, address, level, attributes)` is the read of one level: the page table,
 *   then the tile, then the voxel of the attribute texture `attributes` (`HLSLMaterialTranslator.cpp:15959-16040`).
 *
 * The sample reads the level below the asked one and the level above it, and blends them by the
 * fraction (`:16138-16150`, `SPARSE_VOLUME_TEXTURE_SOFTWARE_LINEAR_MIP_FILTERING`).
 */

/** The address mode as the read takes it: the codes `SVTADDRESSMODE_*` (`SparseVolumeTextureCommon.ush:14-16`). */
const ADDRESS_CODE = (mode: unknown) => SPARSE_ADDRESS_MODES.indexOf(mode as 'clamp')

/** The volume of a sparse volume node, as the word of its slot: by the parameter's name when it has one. */
function volumeValue(s: State, n: GraphNode): Value {
  const source = n.props.source as number
  const name = (n.props.name as string) || undefined
  const key = name ? `parameter:${name}` : `sparse:${source}`
  return slotWord(s.slots.sparseVolume(key, source, name), 'sparseVolume')
}

/** The volume a sample reads: the one wired to it, else its own. */
function sampled(s: State, n: GraphNode): Value {
  const wired = s.input(n, 'texture')
  if (wired) {
    if (wired.type !== 'sparseVolume')
      throw graphError('Texture input requires a sparse volume texture value', { node: n.id })
    return wired
  }
  return volumeValue(s, n)
}

/** The coordinate a sample reads at the point `s` stands at: the one wired to it, else the point's
 *  place in the object's bounds. */
function coordinateOf(s: State, n: GraphNode): Value {
  const wired = s.input(n, 'uvw')
  return wired ? coerce(wired, 'f3') : { type: 'f3', code: `svtVolumeUvw(${s.context})` }
}

/** A read of the volume at `uvw`: the level the mode gives, the two levels around it blended. */
function sparseVolumeSample(s: State, n: GraphNode): Value {
  s.uses.sparseVolumes = true
  const volume = sampled(s, n)
  const uvw = coordinateOf(s, n)
  const { mipMode, constMip, attributes } = n.props
  const mip = coerce(s.input(n, 'mip') ?? constantOf('flex', [constMip as number]), 'flex')
  let level = mip
  if (mipMode !== 'level') {
    const [ddx, ddy] =
      mipMode === 'derivative'
        ? [coerce(s.input(n, 'ddx')!, 'f3').code, coerce(s.input(n, 'ddy')!, 'f3').code]
        : footprint(s, n, uvw, coordinateOf)
    const bias = mipMode === 'bias' ? mip.code : '0.0'
    level = s.e.local('flex', `svtCalculateMip(${volume.code},${ddx},${ddy},${bias})`)
  }
  const mode = ADDRESS_CODE(n.props.address)
  const address = `vec3u(${mode}u)`
  const read = (at: string) =>
    s.e.local('f4', `svtSample(${volume.code},${uvw.code},${address},${at},${attributes}u)`)
  const lower = read(`i32(floor(${level.code}))`)
  const upper = read(`i32(ceil(${level.code}))`)
  return s.e.local('f4', `mix(${lower.code},${upper.code},fract(${level.code}))`)
}

/** The nodes that hold or read a sparse volume texture, by kind. */
export const SPARSE_VOLUME_HANDLERS: Partial<Record<NodeKind, (s: State, n: GraphNode) => Value>> =
  {
    sparseVolumeTextureObject: volumeValue,
    sparseVolumeTextureParameter: volumeValue,
    sparseVolumeTextureSample: sparseVolumeSample,
  }
