import type * as THREE from 'three';
import type { PageRec } from './pageSelection.ts';
import { visMaterial } from './visibilityBuffer.ts';

/** Store a texture in an atlas if it is not already there, and return the slot it occupies.
 *  Slot 0 is the fill texel, so the first stored texture takes slot 1. */
const adder =
  (known: Map<THREE.Texture, number>, list: THREE.Texture[]) => (texture?: THREE.Texture) => {
    if (!texture) return;
    if (known.has(texture)) return;
    known.set(texture, list.length + 1);
    list.push(texture);
  };

/** Census every colour and data texture once, in a stable slot order. */
export function collectWebgpuMaterialTextures(
  allPages: PageRec[],
  blendCopies: THREE.Mesh[],
  mapLayer: Map<THREE.Texture, number>,
  dataLayer: Map<THREE.Texture, number>,
) {
  const maps: THREE.Texture[] = [];
  const dataMaps: THREE.Texture[] = [];
  const seen = new Set<THREE.Material | THREE.Material[]>();
  const addColor = adder(mapLayer, maps);
  const addData = adder(dataLayer, dataMaps);
  const collect = (material: THREE.Material | THREE.Material[]) => {
    if (seen.has(material)) return;
    seen.add(material);
    const mat = visMaterial(material);
    addColor(mat.map);
    addColor(mat.emissiveMap);
    addData(mat.roughnessMap);
    addData(mat.metalnessMap);
    addData(mat.normalMap);
    addData(mat.aoMap);
  };
  for (const rec of allPages) collect(rec.material);
  for (const copy of blendCopies) collect(copy.material);
  return { maps, dataMaps };
}
