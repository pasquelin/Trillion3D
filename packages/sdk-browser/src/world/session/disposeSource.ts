import type {
  HostGraphGeometry,
  HostGraphMaterial,
  HostGraphTexture,
} from '../../host/scene/graphResources.ts';
import { materialTextures, meshes as objects } from '../../scene/meshes.ts';
import type { Object3D } from '../../../../sdk-core/src/world/object/object3d.ts';

/** Gives back every host resource the loaded subtree holds: geometries, surfaces, textures and
 *  the images they decoded. Each is freed once — several meshes share one surface. */
export function disposeSource(source: Object3D) {
  const geometries = new Set<HostGraphGeometry>(),
    materials = new Set<HostGraphMaterial>(),
    textures = new Set<HostGraphTexture>();
  for (const mesh of objects(source)) {
    geometries.add(mesh.geometry);
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      materials.add(material);
      for (const texture of materialTextures(material)) textures.add(texture);
    }
  }
  geometries.forEach((g) => g.dispose());
  materials.forEach((m) => m.dispose());
  textures.forEach((t) => {
    t.dispose();
    // An image bitmap holds decoded pixels until it is closed; a plain image element has no close.
    const image = t.image as { close?: () => void } | undefined;
    image?.close?.();
  });
}
