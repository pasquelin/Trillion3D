import type * as THREE from 'three';
import type { PageRec } from './pageSelection.ts';
import { visMaterial } from './visibilityBuffer.ts';
import type { MaterialLayerIndex } from './webgpuTexturePriority.ts';

const defined = (layers: Array<number | undefined>) =>
  layers.filter((layer): layer is number => layer !== undefined);

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
  const addColor = (texture?: THREE.Texture) => {
    if (!texture) return undefined;
    let layer = mapLayer.get(texture);
    if (layer === undefined) {
      layer = maps.length + 1;
      mapLayer.set(texture, layer);
      maps.push(texture);
    }
    return layer;
  };
  const addData = (texture?: THREE.Texture) => {
    if (!texture) return undefined;
    let layer = dataLayer.get(texture);
    if (layer === undefined) {
      layer = dataMaps.length + 1;
      dataLayer.set(texture, layer);
      dataMaps.push(texture);
    }
    return layer;
  };
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
