import type JoltModule from 'jolt-physics/wasm';
import type { ColliderInstance, CollisionMesh } from '../collision.ts';
import type { Physics } from './physics.ts';

/**
 * The props the physics collides with (#332): each prop's collision mesh is fetched once and
 * becomes one Jolt mesh shape, kept for the session; a tile's placements become one static
 * compound that references those shapes, scaled and turned, without copying a triangle.
 */
export type Solids = {
  /** Fetches under way or done, by prop id. */
  loading: Map<string, Promise<void>>;
  /** Meshes fetched and not yet made into a shape. */
  meshes: Map<string, CollisionMesh>;
  shapes: Map<string, JoltModule.Shape>;
};

export const solids = (): Solids => ({ loading: new Map(), meshes: new Map(), shapes: new Map() });

/** Resolves once every prop `placed` names has its mesh; a failed fetch is tried again later. */
export function loadSolids(
  held: Solids,
  mesh: (prop: string) => Promise<CollisionMesh>,
  placed: readonly ColliderInstance[],
) {
  const wanted = new Set(placed.map((instance) => instance.prop));
  return Promise.all(
    [...wanted].map((prop) => {
      let pending = held.loading.get(prop);
      if (!pending) {
        pending = mesh(prop).then(
          (loaded) => void held.meshes.set(prop, loaded),
          (error: unknown) => {
            held.loading.delete(prop);
            throw error;
          },
        );
        held.loading.set(prop, pending);
      }
      return pending;
    }),
  );
}

/** One Jolt mesh shape from a collision mesh, referenced so it outlives every tile using it. */
function meshShape({ J }: Physics, mesh: CollisionMesh) {
  const vertices = new J.VertexList(),
    triangles = new J.IndexedTriangleList(),
    materials = new J.PhysicsMaterialList(),
    count = mesh.indices.length / 3;
  vertices.resize(mesh.positions.length / 3);
  triangles.resize(count);
  J.HEAPF32.set(mesh.positions, J.getPointer(vertices.at(0)) / 4);
  // An indexed triangle is five words: three indices, a material, a user value.
  const words = J.getPointer(triangles.at(0)) / 4;
  for (let t = 0; t < count; t++)
    J.HEAPU32.set(mesh.indices.subarray(t * 3, t * 3 + 3), words + t * 5);
  const settings = new J.MeshShapeSettings(vertices, triangles, materials);
  const result = settings.Create();
  if (result.HasError()) throw new Error(`collision mesh: ${result.GetError().c_str()}`);
  const shape = result.Get();
  shape.AddRef();
  for (const made of [settings, vertices, triangles, materials]) J.destroy(made);
  return shape;
}

const unit = (scale: readonly number[]) => scale.every((s) => s === 1);

/** The static compound of a tile's placements, near the physics origin; none when empty. */
export function placedCompound(
  physics: Physics,
  held: Solids,
  placed: readonly ColliderInstance[],
) {
  const { J, origin } = physics;
  const settings = new J.StaticCompoundShapeSettings(),
    up = new J.Vec3(0, 1, 0);
  let count = 0;
  for (const instance of placed) {
    let shape = held.shapes.get(instance.prop);
    const mesh = held.meshes.get(instance.prop);
    if (!shape && mesh) {
      shape = meshShape(physics, mesh);
      held.shapes.set(instance.prop, shape);
      held.meshes.delete(instance.prop);
    }
    if (!shape) continue;
    const [x, y, z] = instance.position,
      where = new J.Vec3(x - origin.x, y, z - origin.z),
      scale = new J.Vec3(...instance.scale);
    settings.AddShapeShape(
      where,
      J.Quat.prototype.sRotation(up, instance.yaw),
      unit(instance.scale) ? shape : new J.ScaledShape(shape, scale),
      0,
    );
    J.destroy(where);
    J.destroy(scale);
    count++;
  }
  J.destroy(up);
  if (count) return settings;
  J.destroy(settings);
  return undefined;
}
