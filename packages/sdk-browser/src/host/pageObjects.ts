/**
 * THE OBJECTS THE WEBGL2 PAGE PATH DRAWS WITH.
 *
 * The autonomous WebGL2 backend is a shipping path, not a witness: it is what `chooseBackends`
 * picks on a machine that grants no WebGPU device. Its image is drawn by the engine's own
 * program (`../webgl/cluster/sceneDraw.ts`), which reads the display graph by shape, so a
 * resident page is a mesh of the engine's own graph (`graph/`), holding a geometry of that graph
 * and the declaration it was collected with. The path itself (`../backend/autonomous/`) holds
 * these objects through the shapes of `resources.ts` and hands them back here.
 *
 * Nothing is decided here: the pose, the component counts, the box and the surface parameters
 * all arrive computed.
 */
import type { Material } from '../../../sdk-core/src/index.ts';
import type { HostMaterial, HostMaterials } from './resources.ts';
import type { DecodedGeometryPage } from '../page/decode/geometryPage.ts';
import type { MatrixElements } from '../math/matrixElements.ts';
import { geometryBytes } from '../scene/meshes.ts';
import { hostSide } from '../scene/materialSide.ts';
import { setGeometryBounds } from './geometryBounds.ts';
import { GraphScene } from './graph/scene.ts';
import { GraphInstancedMesh, GraphMesh } from './graph/mesh.ts';
import { BufferAttribute } from '../../../sdk-core/src/world/buffer/attribute.ts';
import { GraphSurface } from './graph/surface.ts';
import type { Object3D } from '../../../sdk-core/src/world/object/object3d.ts';
import { Geometry } from '../../../sdk-core/src/world/geometry/geometry.ts';

type Surfaces = GraphSurface | GraphSurface[];

/** The display graph the page path hangs its pages on, holding from the start the transparent
 *  copies it draws whole (`../cluster/blendCopyMesh.ts`). */
export function hostPageScene(copies: readonly object[] = []): GraphScene {
  const scene = new GraphScene();
  for (const copy of copies) scene.add(copy as unknown as Object3D);
  return scene;
}

/**
 * The mesh one resident page is drawn as: the geometry decoded for it, and the declaration it
 * was collected with — never the engine's surface record, which carries no `visible` flag and
 * would have the program skip every mesh wearing it. The pose is written term by term, so nothing
 * recomposes it from a position and a rotation, and the renderer culls nothing again: the cut
 * has already decided which pages are drawn.
 */
export function hostPageMesh(
  geometry: Geometry,
  declaration: HostMaterials,
  renderOrder: number,
): GraphMesh {
  const mesh = new GraphMesh(geometry, declaration as unknown as Surfaces);
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
  geometry: Geometry,
  declaration: HostMaterials,
  renderOrder: number,
  capacity: number,
): GraphInstancedMesh {
  const mesh = new GraphInstancedMesh(geometry, declaration as unknown as Surfaces, capacity);
  mesh.matrixAutoUpdate = false;
  mesh.frustumCulled = false;
  mesh.renderOrder = renderOrder;
  return mesh;
}

/** Placement `index` of an instanced page: the sixteen floats of its row. */
export const setHostInstance = (mesh: GraphInstancedMesh, index: number, pose: MatrixElements) => {
  mesh.instanceMatrix.array.set(pose.elements, index * 16);
};

/** How many placements the instanced page draws this frame; its matrices go up once. */
export const setHostInstanceCount = (mesh: GraphInstancedMesh, count: number) => {
  mesh.count = count;
  mesh.instanceMatrix.needsUpdate = true;
};

/** Gives an instanced page's matrices back; its geometry and surface are released by theirs. */
export const releaseHostInstances = (mesh: GraphInstancedMesh) => {
  mesh.dispose();
};

/** The pose a drawn page wears: the sixteen floats the engine composed for it. */
export const setHostPose = (mesh: GraphMesh, pose: MatrixElements) => {
  mesh.matrix.fromArray(pose.elements);
};

/** The surface a drawn page wears once its primitive has been repainted. */
export const setHostSurface = (mesh: GraphMesh, declaration: HostMaterials) => {
  mesh.material = declaration as unknown as Surfaces;
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
): Geometry {
  const geometry = new Geometry('host');
  geometry.setIndex(new BufferAttribute(page.indices, 1));
  for (const [name, array] of Object.entries(page.attributes))
    geometry.setAttribute(name, new BufferAttribute(array, itemSize(name)));
  setGeometryBounds(geometry, min, max);
  return geometry;
}

/** A page geometry of an instance's own: a copy that shares no buffer with the model's. */
export const copyHostGeometry = (geometry: Geometry): Geometry => geometry.clone();

/** Buffers already counted, reused across calls: a page geometry owns its own, so the set is
 *  empty again at every call and nothing is allocated to count one. */
const counted = new Set<ArrayBufferView>();

/** The bytes a page geometry holds, counted where every other holder of host buffers counts them
 *  (`../scene/meshes.ts`). */
export function hostPageBytes(geometry: Geometry) {
  counted.clear();
  return geometryBytes(geometry, counted);
}

/** Gives a page geometry back: the draw frees its buffers. */
export const releaseHostGeometry = (geometry: Geometry) => {
  geometry.dispose();
};

/** The standard (or physical) surface the engine's material parameters describe. The face
 *  constant is the engine's (`../scene/materialSide.ts`); nothing else is converted. */
export function hostPageSurface(
  material: Material,
  vertexColors: boolean,
  family: 'standard' | 'physical' = 'standard',
) {
  const [r, g, b] = material.baseColor,
    [er, eg, eb] = material.emissive;
  return new GraphSurface(family, {
    color: { r, g, b },
    emissive: { r: er, g: eg, b: eb },
    metalness: material.metalness,
    roughness: material.roughness,
    opacity: material.opacity,
    transparent: material.alphaMode === 'blend',
    alphaTest: material.alphaMode === 'mask' ? material.alphaCutoff : 0,
    side: hostSide(material.side),
    vertexColors,
  }) as unknown as GraphSurface & HostMaterial;
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
  const source = original as unknown as GraphSurface;
  const twin = into ? (into as unknown as GraphSurface).copy(source) : source.clone();
  twin.vertexColors = true;
  twin.needsUpdate = true;
  return twin as unknown as HostMaterial;
}

/** Gives a surface this engine built back. */
export const releaseHostSurface = (material: HostMaterial) => {
  (material as unknown as GraphSurface).dispose();
};
