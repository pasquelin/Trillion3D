import { gpuPassBlockOf, gpuPassBlockTotals } from '../../packages/sdk-browser/gpuPassBlocks.ts';
import { distribution } from './rapport.mjs';

/**
 * Les passes de la carte graphique et leurs blocs, résumés sur les relevés d'une série.
 *
 * Une passe absente d'un relevé n'y compte pas pour zéro : sa distribution ne porte que les relevés
 * où elle a une durée. Un bloc, lui, ne vaut que sur les relevés où toutes ses passes sont mesurées
 * — c'est la règle de `gpuPassBlockTotals`, et une distribution de sommes partielles la trahirait.
 * `null` sans relevé, jamais un tableau vide qui se lirait comme « mesuré, rien à dire ».
 */
export function passesGpu(samples) {
  if (!samples || !samples.length) return null;
  const parPasse = new Map();
  const blocs = { visibilityMs: [], materialsMs: [], otherMs: [] };
  for (const sample of samples) {
    if (sample.truncated) continue;
    for (const pass of sample.passes) {
      if (typeof pass.gpuMs !== 'number') continue;
      if (!parPasse.has(pass.name)) parPasse.set(pass.name, []);
      parPasse.get(pass.name).push(pass.gpuMs);
    }
    const totals = gpuPassBlockTotals(sample);
    for (const bloc of Object.keys(blocs))
      if (typeof totals[bloc] === 'number') blocs[bloc].push(totals[bloc]);
  }
  return {
    releves: samples.length,
    blocs: Object.fromEntries(Object.entries(blocs).map(([k, v]) => [k, distribution(v)])),
    passes: [...parPasse]
      .map(([name, values]) => ({ name, bloc: gpuPassBlockOf(name), gpuMs: distribution(values) }))
      .sort((a, b) => (b.gpuMs?.p50 ?? -1) - (a.gpuMs?.p50 ?? -1)),
  };
}
