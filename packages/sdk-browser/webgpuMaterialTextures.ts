import type * as THREE from 'three';
import type { PageRec } from './pageSelection.ts';
import { visMaterial } from './visibilityBuffer.ts';
import type { MaterialLayerIndex } from './webgpuTexturePriority.ts';

const defined = (layers: Array<number | undefined>) =>
  layers.filter((layer): layer is number => layer !== undefined);

/** Range une texture dans un atlas si elle n'y est pas déjà, et rend la couche qu'elle occupe. La
 *  couche 0 est le remplissage de repli, donc la première texture rangée prend la couche 1. */
const adder =
  (known: Map<THREE.Texture, number>, list: THREE.Texture[]) => (texture?: THREE.Texture) => {
    if (!texture) return undefined;
    let layer = known.get(texture);
    if (layer === undefined) {
      layer = list.length + 1;
      known.set(texture, layer);
      list.push(texture);
    }
    return layer;
  };

/** Finds each color and data texture once, keeping stable atlas layer order. `materialLayers` says
 *  which layers a material reads, so the transfer order can follow what the camera draws. */
export function collectWebgpuMaterialTextures(
  allPages: PageRec[],
  blendCopies: THREE.Mesh[],
  mapLayer: Map<THREE.Texture, number>,
  dataLayer: Map<THREE.Texture, number>,
) {
  const maps: THREE.Texture[] = [];
  const dataMaps: THREE.Texture[] = [];
  const normalMaps = new Set<THREE.Texture>();
  const materialLayers: MaterialLayerIndex = new Map();
  const addColor = adder(mapLayer, maps);
  const addData = adder(dataLayer, dataMaps);
  const collect = (material: THREE.Material | THREE.Material[]) => {
    if (materialLayers.has(material)) return;
    const mat = visMaterial(material);
    const color = [addColor(mat.map), addColor(mat.emissiveMap)];
    const data = [
      addData(mat.roughnessMap),
      addData(mat.metalnessMap),
      addData(mat.normalMap),
      addData(mat.aoMap),
    ];
    if (mat.normalMap) normalMaps.add(mat.normalMap);
    materialLayers.set(material, { color: defined(color), data: defined(data) });
  };
  for (const rec of allPages) collect(rec.material);
  for (const copy of blendCopies) collect(copy.material);
  return { maps, dataMaps, normalMaps, materialLayers };
}
