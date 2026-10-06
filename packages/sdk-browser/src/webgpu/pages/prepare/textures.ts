import { importTextureIndices } from '../../../host/surfaceImport.ts';
import { materialsAndTangentsCount } from '../io/catalogue.ts';
import { collectWebgpuMaterialTextures } from '../../core/materialTextures.ts';
import { previewsByAtlas, tileCatalogue } from '../../tile/catalogue.ts';
import { createWebgpuTileStreamer } from '../../tile/streamer.ts';
import { chooseBlockFormat, laneCounts, poolEncoding } from '../../../texture/blockFormats.ts';
import { prepareHostReductions } from '../../../texture/mips.ts';
import { texturePoolFor, type TexturePool } from '../../residency/memoryBudgets.ts';
import { grantedTexturePool, sameLayers } from '../../residency/poolGrants.ts';
import { grantedLatest } from './grantLatest.ts';
import { shadowsFollowTextures } from './lightResources.ts';
import {
  PREVIEW_ATLAS_COLOR,
  PREVIEW_ATLAS_DATA,
  PREVIEW_BASE,
  TEXTURE_PREVIEW_VERSION,
} from '../../../../../sdk-core/src/index.ts';
import type { WebgpuPagesRuntime } from '../runtime.ts';
import type { TileTexture } from '../../tile/tileTexture.ts';
import type { WebgpuTileStreamer } from '../../tile/streamer.ts';

/** The atlases among `catalogues` holding a host texture: those whose mips the device reduces. */
const hostKinds = (catalogues: Record<'color' | 'data', readonly TileTexture[]>) =>
  (['color', 'data'] as const).filter((kind) =>
    catalogues[kind].some(({ source }) => source.kind === 'host'),
  );

/** `each` of the live textures, summed per lane. The white fill (slot 0) never opens a lane: it
 *  counts only in one a map opens, read from the white stand-in otherwise (`lanes.ts`), so no
 *  layer is allocated before the first map. */
const perLane = (textures: readonly TileTexture[], each: (texture: TileTexture) => number) => {
  const counts = laneCounts(),
    [fill] = textures;
  for (let slot = 1; slot < textures.length; slot++)
    if (!textures[slot].retired) counts[textures[slot].lane] += each(textures[slot]);
  if (fill && counts[fill.lane]) counts[fill.lane] += each(fill);
  return counts;
};
/** Tiles each lane's textures would hold at full residency: their tails and streamed entries. */
export const laneDemand = (textures: readonly TileTexture[]) =>
  perLane(textures, (texture) => 1 + texture.layout.entries);
/** Textures per lane: the tails the pool keeps resident whole, one tile each. */
export const laneTails = (textures: readonly TileTexture[]) => perLane(textures, () => 1);

/** What a diagnostic says of a catalogue: how many textures per source and per lane, their tiles. */
export const catalogueReport = (textures: readonly TileTexture[]) => ({
  count: textures.filter((texture) => !texture.retired).length - 1,
  baked: textures.filter((texture) => texture.source.kind === 'baked').length,
  tailOnly:
    textures.filter((texture) => !texture.retired && texture.source.kind === 'bytes').length - 1,
  host: textures.filter((texture) => texture.source.kind === 'host').length,
  lanes: laneTails(textures),
  streamedTiles: textures.reduce((total, texture) => total + texture.layout.entries, 0),
});

/** What a diagnostic says of each atlas's page table: its textures and the bytes of its buffer. */
export const pageTablesReport = ({ color, data }: Pick<WebgpuTileStreamer, 'color' | 'data'>) =>
  Object.fromEntries(
    [color, data].map(({ kind, textures, pages }) => [
      kind,
      { slots: textures.length, bytes: pages.buffer.size },
    ]),
  );

/** The census of the scene's material textures, their slots written in the atlases' layers: taken
 *  before the frame targets, which make a feedback target only for a scene that wears one
 *  (`./feedbackVariant.ts`). */
export function takeMaterialTextures(rt: WebgpuPagesRuntime) {
  const { mapLayer, dataLayer } = rt.vis;
  mapLayer.clear();
  dataLayer.clear();
  return collectWebgpuMaterialTextures(
    rt.setup.allPages,
    rt.setup.blendCopies,
    mapLayer,
    dataLayer,
  );
}

/**
 * Builds the virtual textures of the census over the geometry prepare concatenated
 * (`prepareWebgpuGeometry`, `takeMaterialTextures`): for each atlas one tile pool per lane its
 * textures take — the block family the session chose for the chains the gate kept in it, RGBA8 for
 * the others and for a host image —, sized together by the host budget, their page tables, each
 * texture's queue pinned from the start, and the sampler the passes read.
 */
export async function prepareWebgpuTextures(
  rt: WebgpuPagesRuntime,
  gpuDevice: GPUDevice,
  { maps, dataMaps, coverage } = takeMaterialTextures(rt),
) {
  const { vis, diag, run } = rt,
    { allPages, blendCopies } = rt.setup,
    { geometryBlocks } = vis;
  const compte = materialsAndTangentsCount(allPages, geometryBlocks);
  diag.engineDiagnostic('material-textures', 'Textures needed for the render', {
    colorTextures: maps.length,
    dataTextures: dataMaps.length,
    materials: compte.materials,
    opaquePages: allPages.length,
    forwardMeshes: blendCopies.length,
    geometryWithTangents: compte.geometryWithTangents,
    geometryWithoutTangents: compte.geometryWithoutTangents,
  });
  const textureStarted = performance.now();
  const previews = rt.context.metadata.texturePreviews ?? [];
  const previewAt = previewsByAtlas(previews);
  // The family is settled here, the chains in hand: the one the device samples AND the cache
  // holds kept chains in — a device with both features takes the family the cook wrote.
  const choice = chooseBlockFormat(gpuDevice.features, previews, rt.context.textureCompression);
  const encoding = poolEncoding(choice.block);
  // The host names its textures by glTF rank on its own objects; the atlas addresses the engine's
  // records, so the table is rekeyed once, here, before a preview is looked up.
  const ranks = importTextureIndices(rt.context.textureIndices);
  const previewOf = (atlas: number, list: typeof maps) => (index: number) => {
    const source = ranks?.get(list[index]);
    return source === undefined ? undefined : previewAt(source, atlas);
  };
  const readLevel = rt.context.readTextureLevel;
  const color = tileCatalogue(
    maps,
    previewOf(PREVIEW_ATLAS_COLOR, maps),
    readLevel,
    encoding,
    coverage,
  );
  const data = tileCatalogue(
    dataMaps,
    previewOf(PREVIEW_ATLAS_DATA, dataMaps),
    readLevel,
    encoding,
  );
  // What the atlases holding a host texture reduce its mips with, compiled off the thread beside
  // the pools' grant, before the tails below are reduced (`../../../texture/mips.ts`); a scene of
  // cooked chains alone reduces nothing on the device, and compiles none.
  const reductions = prepareHostReductions(gpuDevice, encoding, hostKinds({ color, data }));
  // The lanes settle here, where the textures are known: each pool is sized by what its lane holds,
  // never below the tails it keeps resident whole, one tile each.
  const demand = { color: laneDemand(color), data: laneDemand(data) };
  const tails = { color: laneTails(color), data: laneTails(data) };
  const poolFor = (budgetBytes: number) =>
    texturePoolFor(budgetBytes, gpuDevice, demand, encoding.texelBytes, tails);
  const streamer = (layers: TexturePool['layers']) =>
    createWebgpuTileStreamer({
      device: gpuDevice,
      color,
      data,
      layers,
      encoding,
      budgetBytes: rt.setup.textureBudget,
      budgetMs: rt.setup.textureUploadMs,
      readLevel,
      onFailure: diag.diagnosticFailure,
      onColorChanged: (slots) => {
        // Origin of the resource change: colour tiles have just reached the pool or left it, or a
        // texture's sampling moved, and the shadow of the cutout foliage that reads them follows —
        // once per pump.
        run.gate.resourcesChanged();
        shadowsFollowTextures(
          rt.lights,
          rt.layout.rows,
          rt.layout.selectionRoots,
          rt.layout.placement.rootOfPacked,
          slots,
        );
      },
    });
  // Out of memory absorbed: the lane pools are those the device grants, allocated once, under the
  // out-of-memory scope (`poolGrants.ts`). One refused even at its floor is refused by name, never
  // allocated at the full request outside any scope: the material pipeline then drops. A budget
  // `setMemoryBudgets` records while the device answers is the later word (`grantedLatest`).
  const granted = await grantedLatest({
    budget: () => rt.setup.texturePoolBudget,
    draw: (asked) => ({ asked, pool: poolFor(asked) }),
    same: sameLayers,
    grant: ({ asked }) =>
      grantedTexturePool(gpuDevice, asked, { poolFor }, diag.engineDiagnostic, (pool) =>
        streamer(pool.layers),
      ),
    stopped: () => rt.signal.aborted || run.lost,
  });
  if (!granted) throw new Error('WEBGPU_TEXTURE_POOL_REFUSED');
  const pools = { choice, encoding, pool: granted.pool, poolFor, demand, tails, coverage };
  rt.setup.texturePools = pools;
  // The budget recorded is the one granted, not the one asked.
  rt.setup.texturePoolBudget = granted.pool.budgetBytes;
  const textures = granted.made;
  await reductions;
  textures.prepare();
  vis.textures = textures;
  diag.engineDiagnostic('material-textures-ready', 'Textures and filtering ready', {
    color: catalogueReport(color),
    data: catalogueReport(data),
    pool: {
      layers: pools.pool.layers,
      bytes: pools.pool.allocatedBytes,
      clamp: pools.pool.clamp,
      compression: choice,
      pools: [...textures.color.pools, ...textures.data.pools].map((pool) => ({
        label: pool.label,
        format: pool.texture.format,
        layers: pool.layers,
        tiles: pool.tiles,
        tileBytes: pool.tileBytes,
        pinnedTails: pool.resident,
      })),
      requestReduce: textures.requestReduce,
    },
    pageTables: pageTablesReport(textures),
    progressiveLevels: { version: TEXTURE_PREVIEW_VERSION, base: PREVIEW_BASE },
    preparationMs: performance.now() - textureStarted,
    lighting: 'GGX direct + diffuse hemisphere; no environment map',
    display: 'ACES once, sRGB once',
  });
  vis.mapsSampler = gpuDevice.createSampler({
    magFilter: 'linear',
    minFilter: 'linear',
    mipmapFilter: 'linear',
  });
}
