/**
 * The cache's own description of the prepared scene, and the check that it is the scene the
 * loader built.
 *
 * This batch changes no image: the runtime still builds its scene from the published glTF, and
 * reads the tables only to say, once per session, that the two agree. A divergence is a named
 * refusal — `PREPARED_SCENE_MISMATCH` — because a table that describes another scene is worse
 * than no table at all: everything built on it later would be wrong without a word.
 *
 * What is compared: which mesh and which primitive each drawn node carries, how many copies of
 * each, their world poses, and every surface field the engine reads including sampler state.
 * What is not: node names, which the loader renames when a mesh has several primitives, and the
 * boxes, which the autonomous scene publishes degenerate — both are proven on the compiler side
 * by `packages/asset-compiler-rust/src/tests/tables_scene.rs`.
 */
import {
  EngineError,
  SCENE_TABLES_FILE,
  assertSceneTables,
  type PreparedSceneTables,
  type TableNode,
  type Texture,
} from '../sdk-core/index.ts';
import type { HostNode, HostTexture } from './hostResources.ts';
import { checked } from './clusterPages.ts';
import { meshes as objects } from './sceneMeshes.ts';
import { hostWorldChainInto } from './hostWorldChain.ts';
import { importHostSurface, importTextureIndices } from './hostSurfaceImport.ts';
import { foldImageRanks, materialDivergence, near } from './preparedSceneMaterials.ts';
import type { BackendContext } from './backendTypes.ts';

/** World matrix of the mesh being checked, reused from mesh to mesh. */
const pose = new Float64Array(16);

function refuse(reason: string, context: Record<string, unknown>): never {
  throw new EngineError('PREPARED_SCENE_MISMATCH', reason, context);
}
/** The tables of a prepared cache, with the size of the product read: this read is on the load
 *  critical path of every session, so what it costs is published, not supposed. Absent or of an
 *  unknown version, the tables are a refusal: the cache format that carries them is the only one
 *  this runtime reads. */
export async function loadPreparedSceneTables(base: string, signal?: AbortSignal) {
  const response = await checked(new URL(SCENE_TABLES_FILE, base).href, signal);
  const body = await response.arrayBuffer();
  const tables = assertSceneTables(JSON.parse(new TextDecoder().decode(body)));
  return { tables, bytes: body.byteLength };
}

/** Entries of one primitive, which copies are already matched, and a pose index over them: an
 *  instanced primitive is thousands of entries, and the check is not allowed to be quadratic. */
type Group = {
  material: number;
  poses: TableNode[];
  taken: boolean[];
  left: number;
  at: Map<string, number[]>;
};
const keyOf = (mesh: number, primitive: number) => `${mesh}/${primitive}`;
/** Pose as a key: sixteen numbers at the same tick. Two matrices composed on either side of the
 *  cache agree to the last digit or they do not agree at all, so a tick decides the bucket and
 *  `near` decides the match. */
const poseKey = (matrix: ArrayLike<number>) => {
  let key = '';
  for (let i = 0; i < 16; i++) key += `${Math.round(matrix[i] * 1e5)},`;
  return key;
};

function groupsOf(tables: PreparedSceneTables) {
  const groups = new Map<string, Group>();
  for (const entry of tables.nodes) {
    const key = keyOf(entry.mesh, entry.primitive);
    let group = groups.get(key);
    if (!group) {
      group = { material: entry.material, poses: [], taken: [], left: 0, at: new Map() };
      groups.set(key, group);
    } else if (group.material !== entry.material)
      refuse(`primitive ${key} is drawn with two materials in the node table`, { key });
    group.poses.push(entry);
    group.left++;
    const at = poseKey(entry.matrix);
    const ranks = group.at.get(at) ?? [];
    if (!ranks.length) group.at.set(at, ranks);
    ranks.push(group.poses.length - 1);
  }
  return groups;
}
/** Takes the table entry whose pose is the one given, or refuses. Copies of one primitive differ
 *  only by their pose, so consuming the one placed there is consuming the right one. */
function takePose(group: Group, matrix: Float64Array, key: string) {
  const candidates = group.at.get(poseKey(matrix)) ?? [];
  let best = -1;
  let closest = Number.POSITIVE_INFINITY;
  // The bucket answers in one step; a pose that rounded to the neighbouring tick on one side of
  // the cache falls back to the whole group, which is what `closest` is then measured over.
  for (const search of [candidates, group.poses.map((_, rank) => rank)]) {
    for (const rank of search) {
      if (group.taken[rank]) continue;
      let gap = 0;
      const declared = group.poses[rank].matrix;
      for (let i = 0; i < 16; i++) gap = Math.max(gap, Math.abs(declared[i] - matrix[i]));
      if (gap < closest) {
        closest = gap;
        best = rank;
      }
    }
    if (best >= 0) break;
  }
  if (best < 0 || !group.poses[best].matrix.every((value, i) => near(value, matrix[i])))
    refuse(`no node of the table draws primitive ${key} at the pose the scene places it`, {
      key,
      closest,
      remaining: group.left,
    });
  group.taken[best] = true;
  group.left--;
  return group.poses[best];
}

type Inputs = {
  tables: PreparedSceneTables;
  source: HostNode;
  associations: BackendContext['associations'];
  textureIndices: ReadonlyMap<HostTexture, number>;
  imageSources?: readonly (string | null)[];
};
/**
 * Checks the tables against the scene the loader built, and returns what was compared. Throws on
 * the first divergence: a scene the cache describes wrongly is not opened half way.
 */
export function checkPreparedScene({
  tables,
  source,
  associations,
  textureIndices,
  imageSources,
}: Inputs) {
  const groups = groupsOf(tables);
  // The table names its images by rank; the loader folded its textures on their sources.
  const textures = foldImageRanks(tables.textures, imageSources);
  const ranks: ReadonlyMap<Texture, number> = importTextureIndices(textureIndices) ?? new Map();
  // One surface is compared once per rank and per tangent state — everything else about it is a
  // property of the rank, and a scene of ten thousand meshes wears a handful of surfaces.
  const checkedMaterials = new Set<string>();
  let nodes = 0;
  for (const mesh of objects(source)) {
    const reference = associations.get(mesh);
    if (reference?.meshes === undefined || reference.primitives === undefined)
      refuse(`mesh "${mesh.name}" of the loaded scene names no glTF primitive`, {
        name: mesh.name,
      });
    const key = keyOf(reference.meshes, reference.primitives);
    const group = groups.get(key);
    if (!group || !group.left)
      refuse(`the node table declares no copy left of primitive ${key}`, { key, name: mesh.name });
    hostWorldChainInto(pose, mesh);
    const entry = takePose(group, pose, key);
    nodes++;
    const derivative = mesh.geometry.attributes.tangent === undefined;
    const surfaceKey = `${entry.material}:${derivative}`;
    if (checkedMaterials.has(surfaceKey)) continue;
    checkedMaterials.add(surfaceKey);
    const surface = importHostSurface(mesh.material);
    if (!surface) refuse(`mesh "${mesh.name}" carries no material to check`, { name: mesh.name });
    const divergence = materialDivergence(
      tables.materials[entry.material],
      surface,
      ranks,
      textures,
      derivative,
    );
    if (divergence)
      refuse(`material ${entry.material} of primitive ${key}: ${divergence}`, {
        material: entry.material,
        key,
      });
  }
  const left = [...groups].filter(([, group]) => group.left);
  if (left.length)
    refuse(`the node table declares ${left.length} primitive(s) the loaded scene does not draw`, {
      primitives: left.map(([key]) => key).slice(0, 8),
    });
  return { nodes, materials: checkedMaterials.size, textures: tables.textures.length };
}
