import { rowMaterial, type MaterialLayers } from '../row/pageRowMaterial.ts'
import { neverCulled } from '../../visibility/shader/spriteWgsl.ts'
import { surfaceEmitsOrOccludes } from '../../scene/surfaceEmission.ts'
import { hasPhysicalLobes } from '../../scene/physicalLobes.ts'
import type { MaterialSurface } from './materialRecord.ts'
import type { MaterialEntry } from './materialState.ts'

/** The facts a frame derives from its rows' surfaces beside their flags, a bit each: the vertex
 *  colours a row reads where its geometry has some, a sprite no cut culls (`neverCulled`), the
 *  emission-and-occlusion layer (`surfaceEmitsOrOccludes`), the thin transmission target (a sheet's
 *  colour, `wantsSubsurface`), the lobes target (`hasPhysicalLobes`). */
const FACT = { vertexColors: 1, neverCulled: 2, emits: 4, sheet: 8, lobed: 16 }

/** `mat`'s facts (`FACT`). */
function factsOf(mat: MaterialSurface) {
  let facts = 0
  if (mat.vertexColors) facts |= FACT.vertexColors
  if (neverCulled(mat)) facts |= FACT.neverCulled
  if (surfaceEmitsOrOccludes(mat)) facts |= FACT.emits
  if (mat.side === 'double' && mat.subsurfaceColor?.some((c) => c > 0)) facts |= FACT.sheet
  if (hasPhysicalLobes(mat)) facts |= FACT.lobed
  return facts
}

/** Whether a surface is drawn blended or transmits: its items' lobes and sampled flag, its water
 *  volume and its casters' shadow read its values themselves, so any of them moving takes the
 *  whole path a summary's does (`../row/blendCasters.ts`, `../blend/sceneRefresh.ts`). */
const blendedSurface = (mat: MaterialSurface) => mat.transparent || mat.transmission > 0

/**
 * What the rows and items of `mat` read of it beside its record, into `entry`: its flags' surface
 * bits and its resolve class's, as a row without geometry has them (`rowMaterial`), and its facts.
 * True when a former summary moved — a row of it must be written again —, or when a blended or
 * transmitting surface's record did (`changed`): never on its first.
 */
export function summarize(
  entry: MaterialEntry,
  mat: MaterialSurface,
  layers: MaterialLayers,
  changed: boolean,
) {
  const { flags, classKey } = rowMaterial(mat, undefined, layers),
    facts = factsOf(mat),
    first = entry.version === undefined && entry.epoch < 0
  const moved =
    !first &&
    (flags !== entry.flags ||
      classKey !== entry.classKey ||
      facts !== entry.facts ||
      (changed && blendedSurface(mat)))
  entry.flags = flags
  entry.classKey = classKey
  entry.facts = facts
  return moved
}
