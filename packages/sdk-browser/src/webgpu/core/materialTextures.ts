import type { Texture } from '../../../../sdk-core/src/index.ts';
import type { BlendCopy } from '../../cluster/blendCopyContract.ts';
import type { PageSurface } from '../../page/surface.ts';
import type { PageRec } from '../../page/selection/selection.ts';

/** Store a texture in an atlas if it is not already there, and return the slot it occupies.
 *  Slot 0 is the fill texel, so the first stored texture takes slot 1. */
const adder = (known: Map<Texture, number>, list: Texture[]) => (texture?: Texture) => {
  if (!texture) return;
  if (known.has(texture)) return;
  known.set(texture, list.length + 1);
  list.push(texture);
};

/**
 * Census every colour and data texture once, in a stable slot order — and the colour textures
 * EVERY reader of which takes the alpha for coverage: the map of a masked or blended surface,
 * never an emissive map nor the map of an opaque one. Those alone reduce their mips weighted by
 * alpha, the rule the compiler bakes into their `Coverage` chain (`collect.rs`, #42); one opaque
 * or emissive reader draws the RGB under alpha 0, and keeps the texture plain.
 */
export function collectWebgpuMaterialTextures(
  allPages: PageRec[],
  blendCopies: readonly BlendCopy[],
  mapLayer: Map<Texture, number>,
  dataLayer: Map<Texture, number>,
) {
  const maps: Texture[] = [];
  const dataMaps: Texture[] = [];
  const seen = new Set<PageSurface>();
  const addColor = adder(mapLayer, maps);
  const addData = adder(dataLayer, dataMaps);
  /** Per colour texture, whether every reader so far takes its alpha for coverage. */
  const coverage = new Map<Texture, boolean>();
  const readColor = (texture: Texture | undefined, asCoverage: boolean) => {
    if (!texture) return;
    addColor(texture);
    coverage.set(texture, (coverage.get(texture) ?? true) && asCoverage);
  };
  const collect = (mat: PageSurface) => {
    if (seen.has(mat)) return;
    seen.add(mat);
    readColor(mat.map, mat.transparent || mat.alphaTest > 0);
    readColor(mat.emissiveMap, false);
    addData(mat.roughnessMap);
    addData(mat.metalnessMap);
    addData(mat.normalMap);
    addData(mat.aoMap);
  };
  for (const rec of allPages) collect(rec.material);
  for (const copy of blendCopies) collect(copy.surface);
  return { maps, dataMaps, coverage: coverage as ReadonlyMap<Texture, boolean> };
}
