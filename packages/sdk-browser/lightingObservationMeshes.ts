import * as THREE from 'three';
import { invertMatrix4, multiplyMatrix4 } from '../sdk-core/index.ts';
import type { LightingExperimentRenderState } from './lightingObservationContracts.ts';
import type { ObservationResources } from './lightingObservationResources.ts';
import { createObservationTransforms } from './lightingObservationTransforms.ts';
import { vertexShader, fragmentShader } from './lightingObservationShaders.ts';

export function createObservationMeshes(
  state: LightingExperimentRenderState,
  resources: ObservationResources,
  source: THREE.Object3D,
) {
  const { surfaceCount, expectedIds, uniforms, scene } = resources;
  const shader = fragmentShader(surfaceCount);
  const materials: THREE.ShaderMaterial[] = [];
  const copies: { mesh: THREE.Mesh; surface: number; restTransform: THREE.Matrix4 }[] = [];
  const geometrySet = new Set<THREE.BufferGeometry>();
  const { basis, surfaceBasis, sphereBasis } = createObservationTransforms(state);
  let triangles = 0,
    geometryAllocationBytes = 0;
  source.updateMatrixWorld(true);
  const sourceMeshes: THREE.Mesh[] = [];
  source.traverse((object) => {
    if ((object as THREE.Mesh).isMesh) sourceMeshes.push(object as THREE.Mesh);
  });
  const indices = sourceMeshes.map((mesh) => {
    const i = expectedIds.indexOf(mesh.name);
    if (i < 0 && mesh.name !== 'glossy_sphere')
      throw new Error(`Unknown source mesh in lighting experiment: ${mesh.name}`);
    return i;
  });
  for (let i = -1; i < surfaceCount; i++)
    if (indices.filter((index) => index === i).length !== 1)
      throw new Error(
        `Lighting experiment requires one source mesh for ${i < 0 ? 'glossy_sphere' : expectedIds[i]}`,
      );
  try {
    for (let meshIndex = 0; meshIndex < sourceMeshes.length; meshIndex++) {
      const original = sourceMeshes[meshIndex],
        surface = indices[meshIndex];
      const geometry = original.geometry.clone();
      geometrySet.add(geometry);
      const material = new THREE.ShaderMaterial({
        name: 'lighting-experiment-cache',
        vertexShader,
        fragmentShader: shader,
        uniforms: { ...uniforms, primarySurface: { value: surface } },
        side: THREE.DoubleSide,
        transparent: false,
        depthTest: true,
        depthWrite: true,
        toneMapped: true,
      });
      materials.push(material);
      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = original.name;
      mesh.matrixAutoUpdate = false;
      mesh.frustumCulled = false;
      mesh.matrix.copy(original.matrixWorld);
      mesh.renderOrder = meshIndex;
      scene.add(mesh);
      // La pose de repos relative à la base, `base⁻¹ · monde`, que chaque image recompose avec la base.
      const restTransform = new THREE.Matrix4(),
        rest = restTransform.elements;
      invertMatrix4(
        rest,
        (surface >= 0 ? surfaceBasis(surface, basis) : sphereBasis(basis)).elements,
      );
      multiplyMatrix4(rest, rest, original.matrixWorld.elements);
      copies.push({ mesh, surface, restTransform });
      const index = geometry.getIndex(),
        position = geometry.getAttribute('position');
      triangles += (index ? index.count : position.count) / 3;
      if (index) geometryAllocationBytes += index.array.byteLength;
      const counted = new Set<ArrayBufferView>();
      for (const attribute of Object.values(geometry.attributes)) {
        const array =
          attribute instanceof THREE.InterleavedBufferAttribute
            ? attribute.data.array
            : attribute.array;
        if (!counted.has(array)) {
          counted.add(array);
          geometryAllocationBytes += array.byteLength;
        }
      }
    }
  } catch (error) {
    materials.forEach((material) => material.dispose());
    geometrySet.forEach((geometry) => geometry.dispose());
    resources.dispose();
    throw error;
  }

  return {
    copies,
    triangles,
    geometryAllocationBytes,
    updateTransforms() {
      for (const copy of copies) {
        if (copy.surface >= 0) surfaceBasis(copy.surface, basis);
        else sphereBasis(basis);
        multiplyMatrix4(copy.mesh.matrix.elements, basis.elements, copy.restTransform.elements);
        copy.mesh.matrixWorldNeedsUpdate = true;
      }
    },
    dispose() {
      materials.forEach((material) => material.dispose());
      geometrySet.forEach((geometry) => geometry.dispose());
    },
  };
}
export type ObservationMeshes = ReturnType<typeof createObservationMeshes>;
