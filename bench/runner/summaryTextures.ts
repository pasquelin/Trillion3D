import type { FrameMetrics } from '../../packages/sdk-core/src/index.ts';
import type { Row } from './report/types.ts';

export const go = (b: number | null | undefined) =>
  typeof b === 'number' ? `${(b / 1e9).toFixed(3)} GB` : 'unmeasured';
export const mo = (b: number | null | undefined) =>
  typeof b === 'number' ? `${(b / 1e6).toFixed(1)} MB` : 'unmeasured';
const n = (v: number | null | undefined) => (typeof v === 'number' ? String(v) : 'unmeasured');
/** MiB, the unit `--pool-textures-vivant` takes, so a printed budget can be asked again as is. */
const mib = (b: number) => (b / 1024 / 1024).toFixed(2);
const n2 = (v: number | null | undefined) => (typeof v === 'number' ? v.toFixed(2) : 'unmeasured');

/**
 * Virtual textures of one side, read from the nineteen counters the engine publishes. The pool is
 * COMPUTED from its dimensions and format — WebGPU does not publish occupied memory — and it is
 * fixed: "resident on pool" says what the view occupies, never what the scene weighs. Image
 * feedback says what the pixels asked for and what they are missing; "unmeasured" is not zero.
 */
export function textures(
  metrics: Partial<FrameMetrics> | null | undefined,
  row: Partial<Row> = {},
) {
  const m = metrics ?? ({} as Partial<FrameMetrics>);
  const reseau = row.reseau
    ? Object.entries(row.reseau)
        .sort((a, b) => b[1] - a[1])
        .map(([kind, bytes]) => `${kind} ${go(bytes)}`)
        .join(', ')
    : 'unmeasured';
  const preparation =
    typeof row.preparationMs === 'number'
      ? `${(row.preparationMs / 1000).toFixed(2)} s`
      : 'unmeasured';
  return [
    `- Textures: pool ${go(m.texturePoolBytes)} computed in ${m.texturePoolFormat ?? 'unmeasured'}, ` +
      `${n(m.texturePoolLayers)} layer(s) over both atlases; resident ${go(m.textureResidentBytes)} in ` +
      `${n(m.textureTilesResident)} tiles`,
    `- Image feedback: ${n(m.textureTilesRequested)} tiles requested, ${n(m.textureTilesAtLevel)} ` +
      `served at the requested level, ${n2(m.textureMissingLevels)} missing level(s) on average, ` +
      `${n(m.textureTilesPending)} pending, ${n(m.textureTilesDeferred)} deferred by the budget`,
    `- Streamer: ${n(m.textureTilesServed)} tiles served, ${n(m.textureTilesEvicted)} evicted, ` +
      `${n(m.textureTilesRefused)} refused; last pass ${mo(m.textureBytesLastFrame)} in ` +
      `${n2(m.textureUploadMs)} ms, worst pass ${n2(m.textureUploadPeakMs)} ms; ` +
      `baked levels ${n(m.textureLevelReads)} in read, ${n(m.textureLevelsDecoded)} decoded, ` +
      `${mo(m.textureLevelCacheBytes)} held; ${n(m.textureScratchBuilds)} scratch textures`,
    ...liveTexturePool(row),
    `- Prepare ${preparation}; network since prepare: ${reseau}`,
    '',
  ];
}

/** The texture pool set in session, and what setting it cost; nothing when none was set (a live
 *  geometry pool alone still reports the texture pool in place). The eviction and upload time the
 *  moving series then spends is the streamer's passes above. */
function liveTexturePool({ reglageVivant: reglage }: Partial<Row>) {
  const pool = reglage?.texturePool;
  if (!reglage || !pool || reglage.texturePoolAskedBytes === undefined) return [];
  const fromResident =
    reglage.residentTextureBytes === undefined
      ? ''
      : ` (from ${mo(reglage.residentTextureBytes)} resident)`;
  return [
    `- Texture pool set live: ${mo(reglage.texturePoolAskedBytes)} (${mib(reglage.texturePoolAskedBytes)} MiB) asked${fromResident}, ${mo(pool.allocatedBytes)} ` +
      `held${pool.clamp ? ` (${pool.clamp})` : ''}; ${reglage.evictedTiles} tiles evicted in ` +
      `${n2(reglage.durationMs)} ms, pose held again after ${n(reglage.imagesReprise)} frames`,
  ];
}
