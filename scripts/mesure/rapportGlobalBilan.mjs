// The summary at the head of the report: what to do, in order. One line per point, each figure taken from the campaign readings.
import { moins, ms, nombre } from './rapportGlobalGraphes.mjs';
import { paire, trouve } from './rapportGlobalLecture.mjs';
import { OCTETS_PAR_TRIANGLE, UNREAL } from './rapportGlobalChiffres.mjs';
const li = (points) => points.map((p) => `<li>${p}</li>`).join('');

export function bilan(ex) {
  const [nuS, mS] = paire(ex, 'three-nu', 'sol');
  // Three's bytes per triangle, measured on the scene as it reads it (the whole glTF).
  const nuSans = trouve(ex, 'three-nu-sans-ombres', 'sol', 1, 'avant');
  const octetsThree =
    nuSans?.trianglesUniques > 0 ? nuSans.geometrieOctets / nuSans.trianglesUniques : null;
  const sol = trouve(ex, 'mobile', 'sol', 1);
  const sansLum = trouve(ex, 'sans-lumiere', 'sol', 1);
  const inst = trouve(ex, 'instances-12', 'generale', 1);
  const faire = [
    '<strong>Memory</strong>: when it runs out, the engine stops instead of showing a coarser image; and its cap (288 MB) is hard-coded, the same on every machine. <em>Critical, first.</em>',
    sol && sansLum
      ? `<strong>Sun shadows</strong>: ${ms(moins(sol.gpuP50, sansLum.gpuP50))} of ${ms(sol.gpuP50)} from the street. Keep them from frame to frame instead of redrawing.`
      : '',
    `<strong>Geometry</strong>: ${OCTETS_PAR_TRIANGLE.nous} bytes per triangle, ${nombre(OCTETS_PAR_TRIANGLE.nous / UNREAL.octetsParTriangle, 0)}× Unreal (${nombre(UNREAL.octetsParTriangle, 1)}), ${octetsThree === null ? '' : `versus ${nombre(octetsThree, 0)} for Three which keeps the whole glTF, tangents included`}. Compress at cook time, like Unreal.${inst ? ` And twelve copies of the model = ${nombre(inst.geometrieOctets / 1e6, 0, 'MB')}: one copy, the instance as an index.` : ''}`,
    sol
      ? `<strong>Textures</strong>: ${nombre(sol.texturesEngagees / 1e9, 1, 'GB')} in memory, uncompressed. Unreal compresses and sets a pool.`
      : '',
    nuS && mS && sansLum
      ? `<strong>From the street, the engine matches Three.js</strong> (${ms(mS.gpuP50)} vs ${ms(nuS.imageSyncP50)}): even with no light, its base costs ${ms(sansLum.gpuP50)}. The full-screen materials pass is next to measure.`
      : '',
  ].filter(Boolean);
  return `<div class="bilan"><div class="bilan-faire"><h3>What to do, in order</h3><ol>${li(faire)}</ol></div></div>`;
}

export const STYLE_BILAN = `
.bilan{margin:16px 0 28px}.bilan>div{border-radius:12px;padding:20px 24px;background:var(--surface);border:1px solid var(--bord)}.bilan-faire{border-left:6px solid var(--mauvais)}.bilan h3{margin:0 0 10px;font-size:21px}.bilan ul,.bilan ol{margin:0;padding-left:22px}.bilan li{font-size:17px;line-height:1.45;margin:8px 0}
`;
