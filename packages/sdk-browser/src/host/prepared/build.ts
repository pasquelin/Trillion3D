/**
 * The prepared scene, built from the cache alone: the scene tables say what it is made of, the
 * document's binary holds its vertices, and its images are read from where the tables locate them.
 * No glTF is parsed and no loader runs — the host objects are made by the files beside this one,
 * each under the rules the host loader applied, so the scene is the one it built.
 */
import type { ClusterManifest } from '../../../../sdk-core/src/index.ts';
import type { PreparedSceneTables } from '../../../../sdk-core/src/scene/core/tableContracts.ts';
import type { BackendContext } from '../../backend/types.ts';
import { checked } from '../../cluster/pages.ts';
import { unmetered, type ByteMeter } from '../../cluster/byteMeter.ts';
import { sceneDocument } from '../../scene/tables.ts';
import { bakedImageUrls } from '../../texture/skip.ts';
import type { HostTexture } from '../resources.ts';
import type { HostGraphNode } from '../scene/graphNodes.ts';
import { preparedGeometries } from './geometry.ts';
import { preparedGraph } from './graph.ts';
import { imageAddress, preparedImages } from './images.ts';
import { preparedMaterials } from './materials.ts';
import { preparedTextures, type TextureRanks } from './textures.ts';

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
  const binary = bufferUrl
    ? await track(
        bufferUrl,
        checked(bufferUrl, signal).then((response) =>
          meter.read(response, bufferUrl).arrayBuffer(),
        ),
      )
    : null;
  const skipped =
    skipBaked && metadata.textures
      ? bakedImageUrls(metadata, document.images, (uri) => imageAddress(uri, documentUrl))
      : new Set<string>();
  const images = preparedImages({ document, documentUrl, binary, skipped, signal, track, meter });
  const ranks: TextureRanks = new Map();
  const slot = preparedTextures(tables, document, images, ranks);
  const { scene, ranks: meshes } = await preparedGraph({
    tables,
    meshes: document.meshes,
    geometryOf: preparedGeometries(document, binary),
    materialOf: preparedMaterials(tables.materials, slot),
  });
  signal?.throwIfAborted();
  const source: HostGraphNode = scene;
  const associations: BackendContext['associations'] = meshes;
  const textureIndices: Map<HostTexture, number> = ranks;
  return { source, associations, textureIndices, bakedImages: skipped.size };
}
