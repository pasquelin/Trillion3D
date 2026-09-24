/**
 * THE HOST-LIBRARY OBJECTS THE WEBGL2 PAGE PATH DRAWS WITH.
 *
 * The autonomous WebGL2 backend is a shipping path, not a witness: it is what `chooseBackends`
 * picks on a machine that grants no WebGPU device. Its image is nonetheless drawn by the HOST
 * renderer — the shared adapter of `three/sceneAdapter.ts`, with the host lights the contract
 * installs — so a resident page has to exist as a host mesh, holding a host geometry and the
 * host declaration it was collected with. Making those objects is a boundary, exactly as making
 * the explorer's camera is (`scene/graphObjects.ts`, which builds what the EXPLORER publishes to
 * its host; this file builds what a BACKEND draws). Since #78 lot 3 the path itself —
 * `../backend/autonomous/pages.ts`, `../backend/autonomous/geometry.ts`, `../backend/autonomous/instances.ts` — names no library:
 * it holds these objects through the shapes of `resources.ts` and hands them back here.
 *
 * Nothing is decided here: the pose, the component counts, the box and the surface parameters
 * all arrive computed. And every value handed to a host method below is an object THIS file
 * built: `Object3D.add` drops any node that does not carry the host's own `isObject3D` brand,
 * silently, so `hostPageMesh` is the single writer of the mesh a page is drawn as.
 */
import * as THREE from 'three';
import type { Material } from '../../../sdk-core/src/index.ts';
import type { HostDrawScene } from './scene/graphNodes.ts';
import {
  asHostLibrary,
  type HostGeometry,
  type HostMaterial,
  type HostMaterials,
  type HostMesh,
} from './resources.ts';
import type { HostGraphGeometry } from './scene/graphResources.ts';
import type { DecodedGeometryPage } from '../page/decode/geometryPage.ts';
import type { MatrixElements } from '../math/matrixElements.ts';
import { hostSide } from '../scene/materialSide.ts';
import { geometryBytes } from '../scene/meshes.ts';
import { setGeometryBounds } from './three/bounds.ts';

/** The display graph a backend drawn by the host renderer hangs its pages on, holding from the
 *  start the transparent copies it draws whole (`../cluster/blendCopyMesh.ts`). */
export function hostPageScene(copies: readonly object[] = []): HostDrawScene {
  const scene = new THREE.Scene();
  for (const copy of copies) scene.add(asHostLibrary<THREE.Object3D>(copy));
  return scene;
}

/**
 * The mesh one resident page is drawn as: the geometry decoded for it, and the declaration it
 * was collected with — never the engine's surface record, which carries no `visible` flag and
 * would have the host drop every mesh wearing it. The pose is written term by term, so nothing
 * recomposes it from a position and a rotation, and the renderer culls nothing again: the cut
 * has already decided which pages are drawn.
 */
export function hostPageMesh(
  geometry: HostGeometry,
  declaration: HostMaterials,
  renderOrder: number,
): HostMesh {
  const mesh = new THREE.Mesh(
    asHostLibrary<THREE.BufferGeometry>(geometry),
    asHostLibrary<THREE.Material | THREE.Material[]>(declaration),
  );
  mesh.matrixAutoUpdate = false;
  mesh.frustumCulled = false;
  mesh.renderOrder = renderOrder;
  return mesh;
}

/**
 * The one mesh a page is drawn as at every placement a row of an instance buffer gives it: the
 * page's geometry and surface, and one matrix per placement, the count set per frame. Culled by
 * nobody but the cut, like `hostPageMesh`.
 */
export function hostPageInstances(
  geometry: HostGeometry,
  declaration: HostMaterials,
  renderOrder: number,
  capacity: number,
): HostMesh {
  const mesh = new THREE.InstancedMesh(
    asHostLibrary<THREE.BufferGeometry>(geometry),
    asHostLibrary<THREE.Material | THREE.Material[]>(declaration),
    capacity,
  );
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.matrixAutoUpdate = false;
  mesh.frustumCulled = false;
  mesh.renderOrder = renderOrder;
  return mesh;
}

/** Placement `index` of an instanced page: the sixteen floats of its row. */
export const setHostInstance = (mesh: HostMesh, index: number, pose: MatrixElements) => {
  asHostLibrary<THREE.InstancedMesh>(mesh).instanceMatrix.array.set(pose.elements, index * 16);
};

/** How many placements the instanced page draws this frame; its matrices go up once. */
export const setHostInstanceCount = (mesh: HostMesh, count: number) => {
  const instanced = asHostLibrary<THREE.InstancedMesh>(mesh);
  instanced.count = count;
  instanced.instanceMatrix.needsUpdate = true;
};

/** Gives an instanced page's matrices back; its geometry and surface are released by theirs. */
export const releaseHostInstances = (mesh: HostMesh) => {
  asHostLibrary<THREE.InstancedMesh>(mesh).dispose();
};

/** The pose a drawn page wears: the sixteen floats the engine composed for it. */
export const setHostPose = (mesh: HostMesh, pose: MatrixElements) => {
  asHostLibrary<THREE.Mesh>(mesh).matrix.fromArray(pose.elements);
};

/** The surface a drawn page wears once its primitive has been repainted. */
export const setHostSurface = (mesh: HostMesh, declaration: HostMaterials) => {
  asHostLibrary<THREE.Mesh>(mesh).material = asHostLibrary<THREE.Material>(declaration);
};

/**
 * The host geometry of one decoded page: its triangle list, its attributes at the component
 * counts the engine decoded them with, and the box THE PAGE declares — not the one the corners
 * span, which a quantized page reaches only to its own error.
 */
export function hostPageGeometry(
  page: DecodedGeometryPage,
  itemSize: (name: string) => number,
  min: ArrayLike<number>,
  max: ArrayLike<number>,
): HostGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setIndex(new THREE.BufferAttribute(page.indices, 1));
  for (const [name, array] of Object.entries(page.attributes))
    geometry.setAttribute(name, new THREE.BufferAttribute(array, itemSize(name)));
  setGeometryBounds(geometry, min, max);
  return geometry as unknown as HostGeometry;
}

/** A page geometry of an instance's own: a copy that shares no buffer with the model's. */
export const copyHostGeometry = (geometry: HostGeometry): HostGeometry =>
  asHostLibrary<THREE.BufferGeometry>(geometry).clone() as unknown as HostGeometry;

/** Buffers already counted, reused across calls: a page geometry owns its own, so the set is
 *  empty again at every call and nothing is allocated to count one. */
const counted = new Set<ArrayBufferView>();

/** The bytes a page geometry holds, counted where every other holder of host buffers counts them
 *  (`../scene/meshes.ts`). */
export function hostPageBytes(geometry: HostGeometry) {
  counted.clear();
  return geometryBytes(geometry as HostGraphGeometry, counted);
}

/** Gives a page geometry back to the library that owns it. */
export const releaseHostGeometry = (geometry: HostGeometry) => {
  asHostLibrary<THREE.BufferGeometry>(geometry).dispose();
};

/** The host surface the engine's own material parameters describe, given back to the library
 *  that will draw with it. The face constant is the host's, named where the engine already
 *  names it (`../scene/materialSide.ts`); nothing else is converted. */
export function hostPageSurface(material: Material, vertexColors: boolean): HostMaterial {
  return new THREE.MeshStandardMaterial({
    color: new THREE.Color(...material.baseColor),
    emissive: new THREE.Color(...material.emissive),
    metalness: material.metalness,
    roughness: material.roughness,
    opacity: material.opacity,
    transparent: material.alphaMode === 'blend',
    alphaTest: material.alphaMode === 'mask' ? material.alphaCutoff : 0,
    side: asHostLibrary<THREE.Side>(hostSide(material.side)),
    vertexColors,
  });
}

/**
 * The vertex-coloured twin of a host surface — the same surface, reading the colour attribute a
 * decoded page carries —, cloned once, then read from the shared cache. The only place a twin is
 * built: a page that decodes a colour attribute and a primitive the host repaints ask the same
 * cache, so one surface never holds two of them.
 */
export function colouredTwin(
  cache: Map<HostMaterial, HostMaterial>,
  original: HostMaterial,
): HostMaterial {
  let twin = cache.get(original);
  if (!twin) cache.set(original, (twin = colouredHostSurface(original)));
  return twin;
}

/** The same surface, reading the colour attribute a decoded page carries: a new clone, or `into`
 *  taking the original's values again once it was repainted in place. */
export function colouredHostSurface(original: HostMaterial, into?: HostMaterial): HostMaterial {
  const source = asHostLibrary<THREE.Material>(original);
  const twin = into ? asHostLibrary<THREE.Material>(into).copy(source) : source.clone();
  (twin as THREE.MeshStandardMaterial).vertexColors = true;
  twin.needsUpdate = true;
  return twin;
}

/** Gives a surface this engine built back to the library that owns it. */
export const releaseHostSurface = (material: HostMaterial) => {
  asHostLibrary<THREE.Material>(material).dispose();
};
