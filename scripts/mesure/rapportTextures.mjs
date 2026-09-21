export const go = (b) => (typeof b === 'number' ? `${(b / 1e9).toFixed(3)} GB` : 'unmeasured');
export const mo = (b) => (typeof b === 'number' ? `${(b / 1e6).toFixed(1)} MB` : 'unmeasured');
const n = (v) => (typeof v === 'number' ? String(v) : 'unmeasured');
const n2 = (v) => (typeof v === 'number' ? v.toFixed(2) : 'unmeasured');

/**
 * Virtual textures of one side, read from the nineteen counters the engine publishes. The pool is
 * COMPUTED from its dimensions and format — WebGPU does not publish occupied memory — and it is
 * fixed: "resident on pool" says what the view occupies, never what the scene weighs. Image
 * feedback says what the pixels asked for and what they are missing; "unmeasured" is not zero.
 */
export function textures(metrics, resultat = {}) {
  const m = metrics ?? {};
  const reseau = resultat.reseau
    ? Object.entries(resultat.reseau)
        .sort((a, b) => b[1] - a[1])
        .map(([kind, bytes]) => `${kind} ${go(bytes)}`)
        .join(', ')
    : 'unmeasured';
  const preparation =
    typeof resultat.preparationMs === 'number'
      ? `${(resultat.preparationMs / 1000).toFixed(2)} s`
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
    `- Prepare ${preparation}; network since prepare: ${reseau}`,
    '',
  ];
}
