import { BOX_VALUES } from '../../../math/src/geometry/box.ts'
import { clamp } from '../../../math/src/scalar/reals.ts'
import type { BlendCopy } from '../geometry/cluster/blendCopyContract.ts'
import { refreshBlendBounds } from './worlds.ts'
import { FLAG_TRANSMISSIVE } from '../visibility/types.ts'
import { emptyGeometryBlock } from '../geometry/rows/page/pageRowMaterial.ts'
import { neverCulled } from '../visibility/shader/spriteWgsl.ts'
import type { WebgpuBlendState } from './state.ts'
import {
  FLAG_COLOR,
  FLAG_NORMAL,
  FLAG_TANGENT,
  FLAG_UV,
} from '../../../sdk-core/src/page/format.ts'

/** Creates forward transparent GPU items, one per copy — per placement —, in source mesh order, and
 *  returns how many items transmit. The copies of a session that gains some later are given the
 *  same way: their items follow the held ones. */
export function prepareWebgpuBlend(
  blendCopies: readonly BlendCopy[],
  blendState: WebgpuBlendState,
) {
  let transmissive = blendState.transmissive
  for (const copy of blendCopies) {
    const item = blendItemOf(copy)
    if (item.transmissive) transmissive++
    refreshBlendBounds(item)
    blendState.blendGpu.push(item)
    if (copy.placement) copy.placement.rows.blended = true
  }
  return transmissive
}

/** The item of one copy. Every copy is a blended root's
 *  (`pagedBlendCopiesOf`): it draws its pages, cluster by cluster, from the page cache — their
 *  quantized geometry in place (`../visibility/shader/pageGeometryWgsl.ts`), or the float pool's
 *  for a run-time mesh the session cut with none —, and owns no buffer at all. */
function blendItemOf(copy: BlendCopy) {
  // A transmissive surface goes through the same prepare as the other blends: it differs only
  // at draw, where its layer is lit and composed as a thin translucent layer.
  const mat = copy.surface
  const transmits = mat.transmission > 0
  return {
    transmissive: transmits,
    water: mat.water === true,
    surface: mat,
    priority: sortPriority(copy.drawSource?.node?.renderOrder ?? 0),
    matrix: copy.matrix,
    placement: copy.placement,
    drawSource: copy.drawSource,
    sourceGeometry: copy.geometry,
    pageBox: copy.localBox,
    worldBox: blendWorldBox(copy),
    bounds: undefined as Float64Array | undefined,
    geometry: blendGeometry(copy),
    flags: transmits ? FLAG_TRANSMISSIVE : 0,
  }
}

/** A sort priority clamped to a signed 16-bit value, what the sort key stores (`PRIORITY_BIAS`): the
 *  author's translucent sort priority of the source node, zero by default — never its rank among the
 *  sources (`BlendCopy.renderOrder`), which only orders the copies. */
const sortPriority = (order: number) => clamp(Math.trunc(order), -0x8000, 0x7fff)

/** What a copy's geometry brings to its item's flags, as a page row's block (`GeometryBlock`): the
 *  record writer derives them with the surface's by `rowFlags`, as a row does — the attributes its
 *  quantized pages carry (`pageFlags`), else its source geometry's. A page that stores no tangent
 *  (`FLAG_TANGENT`) leaves the fragment stage to rebuild the frame, as the opaque resolve does. */
const blendGeometry = (copy: BlendCopy) => {
  const flags = copy.pageFlags
  if (flags !== undefined)
    return {
      ...emptyGeometryBlock(),
      hasUv: (flags & FLAG_UV) !== 0,
      hasNormal: (flags & FLAG_NORMAL) !== 0,
      hasTangent: (flags & FLAG_TANGENT) !== 0,
      hasColor: (flags & FLAG_COLOR) !== 0,
      quantized: true,
    }
  const { attributes } = copy.geometry
  return {
    ...emptyGeometryBlock(),
    hasUv: !!attributes.uv,
    hasNormal: !!attributes.normal,
    hasTangent: !!attributes.tangent,
    hasColor: !!attributes.color,
    quantized: false,
  }
}

/**
 * No transform is baked here: the item carries the live world matrix of its source mesh, and its
 * box is SET by the same path that will refresh it after a move. The world box stays conservative
 * under rotation, mirror, non-uniform scale and shear — `boxTransform` guarantees that, not a
 * decomposition. A surface never culled (`neverCulled`) takes none either.
 */
function blendWorldBox(copy: BlendCopy) {
  if (neverCulled(copy.surface)) return undefined
  if (copy.localBox) return new Float64Array(BOX_VALUES)
  if (!copy.geometry.boundingBox) copy.geometry.computeBoundingBox()
  return copy.geometry.boundingBox ? new Float64Array(BOX_VALUES) : undefined
}
