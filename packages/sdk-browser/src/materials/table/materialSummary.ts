import type { MaterialLayers } from '../../geometry/rows/page/pageRowMaterial.ts'
import { rowFlags, surfaceRow } from '../../geometry/rows/surfaceRow.ts'
import { neverCulled } from '../../visibility/shader/spriteWgsl.ts'
import { surfaceEmitsOrOccludes } from '../surface/surfaceEmission.ts'
import { hasPhysicalLobes } from '../surface/physicalLobes.ts'
import { writesSubsurfaceTarget } from '../surface/subsurface.ts'
import type { MaterialSurface } from './materialRecord.ts'
import type { SurfaceSeen } from './materialState.ts'

/** The facts a frame derives from its rows' surfaces beside their flags, a bit each: the vertex
 *  colours a row reads where its geometry has some, a sprite no cut culls (`neverCulled`), the
 *  emission-and-occlusion layer (`surfaceEmitsOrOccludes`), the thin transmission target (a sheet's
 *  colour or a pixel model's data, `writesSubsurfaceTarget`), the lobes target (`hasPhysicalLobes`),
 *  the back and the face drawn as two plan entries (`twoSidedPasses`: the transparent plan's room). */
const FACT = { vertexColors: 1, neverCulled: 2, emits: 4, sheet: 8, lobed: 16, twoPasses: 32 }

/** `mat`'s facts (`FACT`). */
function factsOf(mat: MaterialSurface) {
  let facts = 0
  if (mat.vertexColors) facts |= FACT.vertexColors
  if (neverCulled(mat)) facts |= FACT.neverCulled
  if (surfaceEmitsOrOccludes(mat)) facts |= FACT.emits
  if (writesSubsurfaceTarget(mat)) facts |= FACT.sheet
  if (hasPhysicalLobes(mat)) facts |= FACT.lobed
  if (mat.twoSidedPasses === true) facts |= FACT.twoPasses
  return facts
}

/** Whether a surface is drawn blended or transmits: its items' lobes and sampled flag, its
 *  volume read its values themselves, so any of them moving takes the
 *  whole path a summary's does (`../../blend/sceneRefresh.ts`). */
const blendedSurface = (mat: MaterialSurface) =>
  mat.transparent || mat.transmission > 0 || mat.water === true

/**
 * What the rows and items of `mat` read of it beside its record, into `seen`: what it brings to
 * each row (`surfaceRow`), its flags' surface bits and its resolve class's, as a row without
 * geometry has them (`rowFlags`), whether its vertices are moved (`SurfaceRow.wpo`), and its facts. True when a former summary of it moved — a row of
 * it must be written again —, or when a blended or transmitting surface's record did (`changed`):
 * never on its `first`.
 */
export function summarize(
  seen: SurfaceSeen,
  mat: MaterialSurface,
  layers: MaterialLayers,
  changed: boolean,
  first: boolean,
) {
  const offsetBefore = seen.row.wpo
  const { flags, classKey } = rowFlags(
      surfaceRow(mat, layers, seen.row),
      undefined,
      layers.textures,
    ),
    facts = factsOf(mat)
  const moved =
    !first &&
    (flags !== seen.flags ||
      classKey !== seen.classKey ||
      facts !== seen.facts ||
      seen.row.wpo !== offsetBefore ||
      (changed && blendedSurface(mat)))
  seen.flags = flags
  seen.classKey = classKey
  seen.facts = facts
  return moved
}
