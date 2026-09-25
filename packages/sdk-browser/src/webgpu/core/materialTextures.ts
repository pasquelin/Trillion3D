import type { Texture } from '../../../../sdk-core/src/index.ts';
import type { BlendCopy } from '../../cluster/blendCopyContract.ts';
import type { PageSurface } from '../../page/surface.ts';
import type { PageRec } from '../../page/selection/selection.ts';
import { CoverageReaders } from '../../texture/coverage.ts';

/** Store a texture in an atlas if it is not already there, and return the slot it occupies.
 *  Slot 0 is the fill texel, so the first stored texture takes slot 1. */
const adder = (known: Map<Texture, number>, list: Texture[]) => (texture?: Texture) => {
  if (!texture) return;
  if (known.has(texture)) return;
  known.set(texture, list.length + 1);
  list.push(texture);
};

/**
 * Census every colour and data texture once, in a stable slot order, and the readers of each
 * colour texture, which say whether its mips weigh by alpha (`CoverageReaders`, #42).
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
  const coverage = new CoverageReaders();
  const collect = (mat: PageSurface) => {
    if (seen.has(mat)) return;
    seen.add(mat);
    addColor(mat.map);
    addColor(mat.emissiveMap);
    coverage.read(mat);
    addData(mat.roughnessMap);
    addData(mat.metalnessMap);
    addData(mat.normalMap);
    addData(mat.aoMap);
  };
  for (const rec of allPages) collect(rec.material);
  for (const copy of blendCopies) collect(copy.surface);
  return { maps, dataMaps, coverage };
}
