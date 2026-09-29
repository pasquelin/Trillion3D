/**
 * The prepared scene, built from the cache alone: the scene tables say what it is made of, the
 * document's binary holds its vertices — read on their first load, never up front —, and its
 * images are read from where the tables locate them.
 * No glTF is parsed and no loader runs — the host objects are made by the files beside this one,
 * each under the rules the host loader applied, so the scene is the one it built.
 */
import { EngineError, type ClusterManifest } from '../../../../sdk-core/src/index.ts';
import type { PreparedSceneTables } from '../../../../sdk-core/src/scene/core/tableContracts.ts';
import type { BackendContext } from '../../backend/types.ts';
import { readOnce } from '../../../../sdk-core/src/world/buffer/pending.ts';
import { checked } from '../../cluster/checked.ts';
import { unmetered, type ByteMeter } from '../../cluster/byteMeter.ts';
import { sceneDocument } from '../../scene/tables.ts';
import { bakedImages } from '../../texture/skip.ts';
import type { HostTexture } from '../resources.ts';
import { preparedGeometries } from './geometry.ts';
import { preparedGraph } from './graph.ts';
import { preparedImages } from './images.ts';
import { preparedMaterials } from './materials.ts';
import { preparedTextures, type TextureRanks } from './textures.ts';
import type { Object3D } from '../../../../sdk-core/src/world/object/object3d.ts';

/** The published source document: the one the cache's pages were cut from. */
const SOURCE_FILE = 'source.gltf';

type Inputs = {
  tables: PreparedSceneTables;
  metadata: ClusterManifest;
  /** The published document the session draws: `source.gltf`, or the autonomous scene. */
  sceneFile: string;
  base: string;
  /** Whether the images whose chain the cache baked are skipped (`textureSource` not `'host'`). */
  skipBaked: boolean;
  signal: AbortSignal | undefined;
  /** Wraps each resource read, for the session's progress. */
  track: <T>(resource: string, read: Promise<T>) => Promise<T>;
  /** Counts the bytes of each file read as they arrive; unset, nothing counts them. */
  meter?: ByteMeter;
};

/** The scene, the mesh and primitive ranks each drawn host mesh answers to, the rank each host
 *  texture answers to, and how many images the cache spared. */
export async function buildPreparedScene(inputs: Inputs) {
  const { tables, metadata, sceneFile, base, skipBaked, signal, track } = inputs;
  const meter = inputs.meter ?? unmetered;
  const { document, documentUrl, bufferUrl } = sceneDocument(tables, sceneFile, base);
  // The binary is read on the first need of a host vertex or an embedded image, once: most
  // sessions draw from the cache's pages and never read it. Read while the scene is built (an
  // embedded image a surface samples), it joins the load's progress, byte count and signal; read
  // after, none of them: an aborted or timed-out load signal must not refuse every later read. A
  // failed read is not kept: the next need reads again.
  let building = true;
  const binary = readOnce(() => {
    if (!bufferUrl)
      return Promise.reject(
        new EngineError('PREPARED_SCENE_MISMATCH', 'the scene document names no binary'),
      );
    if (!building) return checked(bufferUrl).then((response) => response.arrayBuffer());
    const read = checked(bufferUrl, signal).then((response) =>
      meter.read(response, bufferUrl).arrayBuffer(),
    );
    return track(bufferUrl, read);
  });
  const skipped = skipBaked ? bakedImages(metadata, document.images.length) : new Set<number>();
  const images = preparedImages({ document, documentUrl, binary, skipped, signal, track, meter });
  const ranks: TextureRanks = new Map();
  const slot = preparedTextures(tables, document, images, ranks);
  const {
    scene,
    ranks: meshes,
    nodes,
    placed,
  } = await preparedGraph({
    tables,
    meshes: document.meshes,
    ...(sceneFile === SOURCE_FILE ? {} : pagedSource(tables, base)),
    geometryOf: preparedGeometries(document, binary),
    materialOf: preparedMaterials(tables.materials, slot),
  }).finally(() => {
    building = false;
  });
  signal?.throwIfAborted();
  const source: Object3D = scene;
  const associations: BackendContext['associations'] = meshes;
  const textureIndices: Map<HostTexture, number> = ranks;
  return { source, associations, textureIndices, bakedImages: skipped.size, nodes, placed };
}

/** The source document the autonomous one's pages were cut from: its meshes, and its geometries,
 *  each view of whose binary is read alone, by an HTTP Range, on the first need of a vertex — a
 *  class change cutting pages again (#846): the session never reads the whole `source.bin`. */
function pagedSource(tables: PreparedSceneTables, base: string) {
  if (!tables.documents[SOURCE_FILE]) return {};
  const { document, bufferUrl } = sceneDocument(tables, SOURCE_FILE, base);
  // A server that ignores the Range answers the whole file: kept, then read no more. Until the
  // first answer says which, the views asked at once wait on it rather than each fetching.
  let whole: Promise<ArrayBuffer> | undefined, first: Promise<unknown> | undefined;
  const range = async (offset: number, length: number): Promise<ArrayBuffer> => {
    if (!bufferUrl) throw new EngineError('PREPARED_SCENE_MISMATCH', 'the source names no binary');
    if (first) await first.catch(() => {});
    if (!whole) {
      const asked = checked(bufferUrl, undefined, undefined, {
        Range: `bytes=${offset}-${offset + length - 1}`,
      });
      first ??= asked;
      const response = await asked;
      if (response.status === 206) return response.arrayBuffer();
      whole ??= response.arrayBuffer();
      // A failed read is not kept: the next need reads again.
      whole.catch(() => (whole = undefined));
    }
    return (await whole).slice(offset, offset + length);
  };
  return { pagedFrom: document.meshes, pagedGeometryOf: preparedGeometries(document, { range }) };
}
