import type { Scene } from './lightingSceneTypes.ts';
import { add, cross, normalized } from './lightingSceneMath.ts';
import { createLightingGltfBuffer } from './lightingSceneGltfBuffer.ts';
import { createLightingSphereGeometry } from './lightingSceneSphere.ts';

/** glTF and a separate, little-endian binary buffer; adapters own persistence. */
export function exportLightingGltf(scene: Scene): {
  gltf: Record<string, unknown>;
  binary: Uint8Array;
} {
  const { materials, mesh, finish } = createLightingGltfBuffer();
  const extensionsUsed = new Set<string>();
  scene.surfaces.forEach((surface, surfaceIndex) => {
    const emissionStrength = Math.max(1, ...surface.emission);
    const material: Record<string, unknown> = {
      name: `${surface.id}_material`,
      pbrMetallicRoughness: {
        baseColorFactor: [...surface.albedo, 1],
        metallicFactor: surface.kind === 'mirror' ? 1 : 0,
        roughnessFactor: surface.kind === 'mirror' ? 0 : 1,
      },
      emissiveFactor: surface.emission.map((value) => value / emissionStrength),
    };
    if (emissionStrength > 1) {
      material.extensions = {
        KHR_materials_emissive_strength: { emissiveStrength: emissionStrength },
      };
      extensionsUsed.add('KHR_materials_emissive_strength');
    }
    materials.push(material);
    const a = surface.origin,
      b = add(a, surface.u),
      d = add(a, surface.v),
      c = add(b, surface.v);
    const normal = normalized(cross(surface.u, surface.v));
    mesh(
      surface.id,
      [...a, ...b, ...c, ...d],
      [...normal, ...normal, ...normal, ...normal],
      [0, 0, 1, 0, 1, 1, 0, 1],
      [0, 1, 2, 0, 2, 3],
      materials.length - 1,
      {
        surfaceId: surface.id,
        surfaceIndex,
        moving: surface.moving,
        kind: surface.kind,
        columns: surface.columns,
        rows: surface.rows,
        emission: [...surface.emission],
      },
    );
  });
  if (scene.sphere) {
    const { center, radius, roughness } = scene.sphere;
    const { positions, normals, uv, indices } = createLightingSphereGeometry({ center, radius });
    materials.push({
      name: 'glossy_sphere_material',
      pbrMetallicRoughness: {
        baseColorFactor: [0.92, 0.92, 0.92, 1],
        metallicFactor: 1,
        roughnessFactor: roughness,
      },
    });
    mesh('glossy_sphere', positions, normals, uv, indices, materials.length - 1, {
      roughness,
      radius,
      center: [...center],
    });
  }
  const { gltf, binary } = finish();
  if (extensionsUsed.size) gltf.extensionsUsed = [...extensionsUsed];
  return { gltf, binary };
}
