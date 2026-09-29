import { receiveSoftSource } from '../deformation/softSource.ts';
import type { Object3D } from '../../../sdk-core/src/world/object/object3d.ts';
import { EngineError } from '../../../sdk-core/src/contracts/cache.ts';
import {
  BODY_INDEX,
  SOFT_STATE_WORDS,
  SOFT_VERTEX_WORDS,
  physicsMatterOf,
  softBodyOf,
  writeSoft,
  type CommandWriter,
  type ObjectPhysics,
  type SoftBodyRecord,
} from '../../../sdk-core/src/physics/index.ts';
import type { Mesh } from '../../../sdk-core/src/world/object/mesh.ts';
import type { Geometry } from '../../../sdk-core/src/world/geometry/geometry.ts';
import { computeNormals } from '../../../sdk-core/src/world/geometry/normals.ts';
import { type Bodied, type createPhysicsBodies } from './bodies.ts';

type Pose = { position: ArrayLike<number>; quaternion: ArrayLike<number> };

/** How far, relatively, a soft body's world scale may stray from the one it was made at. */
const SCALE_TOLERANCE = 1e-4;
const near = (s: number, at: number) => Math.abs(s - at) <= SCALE_TOLERANCE * Math.abs(at);
/** Whether `scale`, a soft body's world scale, is `at`, the one it was made (or cooked) at. */
export const fits = (scale: { x: number; y: number; z: number }, at: ArrayLike<number>) =>
  near(scale.x, at[0]) && near(scale.y, at[1]) && near(scale.z, at[2]);

/** The refusal of soft body `what`, made at scale `at` and placed at another: Jolt scales no soft
 *  body once made. `names` say which. */
export const rescaledSoft = (what: string, at: ArrayLike<number>, names: Record<string, unknown>) =>
  new EngineError(
    'PHYSICS_FAILED',
    `The soft body ${what} was made at scale ${Array.from(at).join(', ')}: it is placed at another.`,
    names,
  );

/**
 * Writes the SOFT command of body `id`, made with the options `p` over the matter `matter` of its
 * material or its cooked collider, placed by `pose` and simulated at `scale`: a page-built and a
 * cooked soft body mapped alike. Its options win over the matter, as `obj.physics` wins. SOFT has
 * no flags word: its `flags` (`flagsOf`), when any, follow in FLAGS.
 */
export function writeSoftBody(
  writer: CommandWriter,
  id: number,
  p: ObjectPhysics,
  matter: { friction: number; restitution: number },
  pose: Pose & Pick<SoftBodyRecord, 'scale'>,
  record: SoftBodyRecord['record'],
  flags: number,
) {
  writeSoft(writer, {
    ...{ id, ...pose },
    ...{
      friction: p.friction ?? matter.friction,
      restitution: p.restitution ?? matter.restitution,
    },
    ...{ gravityScale: p.gravityScale, linearDamping: p.damping.linear },
    ...{ settings: p.soft!, record },
  });
  if (flags) writer.flags(id & BODY_INDEX, flags);
}

/** The soft body drawn into each geometry; the one drawing now (`drawSoft`), if any. */
const drawers = new WeakMap<Geometry, Mesh>();
let drawing: Mesh | null = null;
/** Whether `node`'s change is its soft body drawn where it is: no new shape to simulate (#573). */
export const drawnBySoft = (node: object) => node === drawing;

/**
 * Writes the SOFT command of `mesh`, a soft body placed at `pose` and scaled by `size`: its slot
 * claimed with its vertices counted against the budget, its vertex map kept in `maps`, its
 * `flags` written. Returns the slot. A geometry another soft body draws itself into is refused.
 */
export function addSoftBody(
  writer: CommandWriter,
  mesh: Bodied,
  pose: Pose,
  size: { x: number; y: number; z: number },
  claim: (collisionBytes: number, softVertices: number) => number,
  maps: (Uint32Array | null)[],
  flags: number,
) {
  const p = mesh.physics,
    other = drawers.get(mesh.geometry);
  if (other && other !== mesh && other.geometry === mesh.geometry && other.physics?._host)
    throw new EngineError(
      'PHYSICS_FAILED',
      `The soft body ${mesh.name || '(unnamed)'} shares its geometry with ${other.name || 'another'}: give each its own (geometry.clone()).`,
      { name: mesh.name, shares: other.name },
    );
  drawers.set(mesh.geometry, mesh);
  const record = softBodyOf(mesh.geometry, size, { ...p.soft!, mass: p.mass });
  const id = claim(0, record.vertices.length / SOFT_VERTEX_WORDS);
  // Its vertices move every step: uploaded in place, never cut into pages again (#573).
  mesh.geometry.usage = 'dynamic';
  const scale = [size.x, size.y, size.z] as const;
  writeSoftBody(writer, id, p, physicsMatterOf(mesh.material), { ...pose, scale }, record, flags);
  maps[id & BODY_INDEX] = record.map;
  return id & BODY_INDEX;
}

/** Draws `mesh` where its soft body is (#573): its geometry's positions, and its float normals
 *  when it carries some, rewritten in place from `vertices`, one simulated place per vertex. */
function drawSoft(mesh: Mesh, vertices: Float32Array) {
  const { position, normal } = mesh.geometry.attributes;
  if (position?.kind !== 'attribute' || position.array.length !== vertices.length) return;
  drawing = mesh;
  try {
    position.array.set(vertices);
    position.needsUpdate = true;
    const normals = normal?.kind === 'attribute' ? normal.array : null;
    const floats = normals instanceof Float32Array || normals instanceof Float64Array;
    if (!floats || normals.length !== vertices.length) return;
    computeNormals(vertices, mesh.geometry.index?.array ?? null, normals);
    normal!.needsUpdate = true;
  } finally {
    drawing = null;
  }
}

/**
 * A tick's soft-body vertices (`SOFT_STATE_WORDS`): each vertex of a soft body's geometry takes
 * the place of the simulated vertex it maps to, in `physics.vertices`, and its geometry is drawn
 * there (`drawSoft`). A record naming a body that left is skipped. Returns the meshes it moved.
 */
export function receiveSoft(
  words: Uint32Array | null,
  bodies: Pick<ReturnType<typeof createPhysicsBodies>, 'meshOf' | 'softMap' | 'slots'>,
) {
  const moved: Object3D[] = [];
  if (!words) return moved;
  const floats = new Float32Array(words.buffer, words.byteOffset, words.length);
  for (let at = 0; at < words.length;) {
    const mesh = bodies.meshOf(words[at]),
      count = words[at + 1],
      from = at + SOFT_STATE_WORDS;
    const owner = bodies.slots.of(words[at]);
    if (
      owner &&
      'soft' in owner &&
      owner.soft.source &&
      receiveSoftSource(owner.soft.source, floats.subarray(from, from + count * 3))
    )
      moved.push(owner.model);
    const map = mesh && bodies.softMap(mesh.physics._index);
    if (mesh && map) {
      // Made again from another geometry, it takes the new one's vertex count.
      if (mesh.physics.vertices?.length !== map.length * 3)
        mesh.physics.vertices = new Float32Array(map.length * 3);
      const out = mesh.physics.vertices;
      for (let v = 0; v < map.length; v++)
        for (let k = 0; k < 3; k++) out[v * 3 + k] = floats[from + map[v] * 3 + k];
      drawSoft(mesh, out);
      moved.push(mesh);
    }
    at = from + count * 3;
  }
  return moved;
}
