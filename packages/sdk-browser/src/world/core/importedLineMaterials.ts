import { Color } from '../../../../sdk-core/src/world/math/color.ts';
import { Material } from '../../../../sdk-core/src/world/material/material.ts';
import type { Mesh } from '../../../../sdk-core/src/world/object/mesh.ts';
import type { GraphSurface } from '../../host/graph/surface.ts';

const surfaces = new WeakMap<GraphSurface, { material: Material; version: number }>();
const sources = new WeakMap<
  Mesh,
  { source: Mesh<GraphSurface>; previous: Mesh<GraphSurface>['material'] }
>();
export const hasImportedLineMaterial = (mesh: Mesh) => sources.has(mesh);
const fields = [
  'opacity',
  'transparent',
  'vertexColors',
  'depthWrite',
  'depthTest',
  'alphaTest',
] as const;

function materialOf(source: GraphSurface) {
  let held = surfaces.get(source);
  if (!held) {
    held = { material: new Material('line'), version: -1 };
    surfaces.set(source, held);
  }
  if (held.version !== source.version) {
    for (const field of fields) Reflect.set(held.material, field, source[field]);
    held.material.color = source.color instanceof Color ? source.color : new Color(0xffffff);
    held.material.name = source.name;
    held.version = source.version;
  }
  return held.material;
}

export function lineMaterials(source: Mesh<GraphSurface>['material']) {
  return Array.isArray(source) ? source.map(materialOf) : materialOf(source);
}
export function bindLineMaterials(mesh: Mesh, source: Mesh<GraphSurface>) {
  sources.set(mesh, { source, previous: source.material });
}
/** Source API edits propagate; direct page edits remain until the source changes again. */
export function syncLineMaterials(meshes: Iterable<Mesh>) {
  for (const mesh of meshes) {
    const held = sources.get(mesh);
    if (!held) continue;
    const current = held.source.material;
    const material = lineMaterials(current);
    if (current !== held.previous) {
      mesh.material = material;
      held.previous = current;
    }
  }
}
