import type { HostAttributes } from '../../host/resources.ts';
import type { PageRec } from '../../page/selection/selection.ts';
import { refreshSurface, type PageSurface } from '../../page/surface.ts';
import { surfaceEmitsOrOccludes } from '../../scene/surfaceEmission.ts';
import {
  emptyGeometryBlock,
  rowGeometry,
  rowMaterial,
  type GeometryBlock,
  type MaterialLayers,
} from '../row/pageRowMaterial.ts';

/** What a resolve class reads of a row's geometry (`rowMaterial`): the attributes its block holds
 *  — uv, normal, tangent, colour —, one bit each. */
const GEOMETRY_ATTRIBUTES = 4;
/** Every set of those attributes a row's geometry can hold: two to the power of their count. */
const GEOMETRIES = 1 << GEOMETRY_ATTRIBUTES;

/** The set a row's geometry holds; none for a row without a block, which reads none. */
const geometryBits = (geo: GeometryBlock | undefined) =>
  geo ? +geo.hasUv | (+geo.hasNormal << 1) | (+geo.hasTangent << 2) | (+geo.hasColor << 3) : 0;

/** A block holding the attributes `bits` names, into `block`. */
function blockOf(bits: number, block: GeometryBlock) {
  block.hasUv = (bits & 1) !== 0;
  block.hasNormal = (bits & 2) !== 0;
  block.hasTangent = (bits & 4) !== 0;
  block.hasColor = (bits & 8) !== 0;
  return block;
}

/** Each surface an opaque page wears — transparent pages take no row (`../row/sync.ts`) —, and the
 *  geometries it is worn on, bit `geometryBits` set for each: a page's class is a function of these
 *  two and of the atlases alone. */
function wornSurfaces(
  allPages: readonly PageRec[],
  geometryBlocks: ReadonlyMap<HostAttributes, GeometryBlock>,
) {
  const worn = new Map<PageSurface, number>(),
    block = emptyGeometryBlock();
  for (const rec of allPages)
    if (!rec.transparent) {
      const bits = geometryBits(rowGeometry(rec, geometryBlocks, block));
      worn.set(rec.material, (worn.get(rec.material) ?? 0) | (1 << bits));
    }
  return worn;
}

/** The resolve classes the worn surfaces draw under, sorted into `keys`, which `seen` dedupes:
 *  from the same material fields, geometry and atlas slots the rows will carry
 *  (`../row/pageRow.ts`), one surface and geometry at a time. Both are refilled in place. */
function classKeys(
  worn: ReadonlyMap<PageSurface, number>,
  layers: MaterialLayers,
  seen: Set<number>,
  keys: number[],
) {
  const block = emptyGeometryBlock();
  seen.clear();
  keys.length = 0;
  for (const [surface, geometries] of worn) {
    const mat = refreshSurface(surface);
    for (let bits = 0; bits < GEOMETRIES; bits++)
      if (geometries & (1 << bits))
        seen.add(rowMaterial(mat, blockOf(bits, block), layers).classKey);
  }
  for (const key of seen) keys.push(key);
  return keys.sort((a, b) => a - b);
}

/** Whether a worn surface can emit or occlude (`surfaceEmitsOrOccludes`). */
function emitting(worn: ReadonlyMap<PageSurface, number>) {
  for (const surface of worn.keys())
    if (surfaceEmitsOrOccludes(refreshSurface(surface))) return true;
  return false;
}

/**
 * The census of the surfaces a session's opaque pages wear: whether one can emit or occlude, read
 * at preparation before the frame targets (`../pages/prepare/emissiveAoLayer.ts`), and the resolve
 * classes they draw under, read once the atlases are laid out (`layers`, read live). Both are taken
 * again at the first frame entry after what they read moved (`moved`, `retake`) — a surface's
 * values, the maps' filter rules, the surfaces drawables wear —, so that a class a material changed
 * into is compiled before the image that draws it (`../frame/framePipelines.ts`). A retake reads
 * each worn surface once per geometry it is worn on; the pages are walked again only once
 * drawables wear other surfaces.
 */
export function createShadeCensus(
  allPages: readonly PageRec[],
  geometryBlocks: ReadonlyMap<HostAttributes, GeometryBlock>,
  layers: MaterialLayers,
) {
  const seen = new Set<number>(),
    keys: number[] = [];
  let worn = wornSurfaces(allPages, geometryBlocks),
    emits = emitting(worn),
    counted = false,
    stale = false,
    rewear = false;
  return {
    /** The classes of the last census, sorted. */
    get keys(): readonly number[] {
      if (!counted) classKeys(worn, layers, seen, keys);
      counted = true;
      return keys;
    },
    /** Whether a surface of the last census can emit or occlude. */
    get emits() {
      return emits;
    },
    /** What a class reads moved: a surface's values or a map's filter rule; `wearing`, drawables
     *  now wear other surfaces. */
    moved(wearing = false) {
      stale = true;
      rewear ||= wearing;
    },
    /** Takes the census again when what it reads moved since the last one; whether it did. */
    retake() {
      if (!stale) return false;
      if (rewear) worn = wornSurfaces(allPages, geometryBlocks);
      stale = rewear = false;
      emits = emitting(worn);
      classKeys(worn, layers, seen, keys);
      counted = true;
      return true;
    },
  };
}
export type ShadeCensus = ReturnType<typeof createShadeCensus>;
