/** `p50 / p95` d'une distribution, ou « non mesuré » : un tiret ne serait pas distinct d'un zéro. */
export const p50p95 = (d) => (d ? `${d.p50.toFixed(3)} / ${d.p95.toFixed(3)}` : 'non mesuré');
const BLOCS = [
  ['visibilityMs', 'Tampon de visibilité'],
  ['materialsMs', 'Passe matériaux'],
  ['otherMs', 'Le reste'],
];

/**
 * Les blocs comparables puis chaque passe d'un côté, sous son tableau par étape. Les blocs sont
 * ceux qu'un profil publié nomme — tampon de visibilité, passe matériaux — et rien d'autre : une
 * passe qu'aucun des deux ne couvre est dans « le reste », nommée dans le tableau du dessous.
 */
export function passes(passesGpu) {
  if (!passesGpu) return ['- Passes carte graphique : aucun relevé', ''];
  return [
    `- Blocs comparables sur ${passesGpu.releves} relevés, GPU ms p50/p95 : ` +
      BLOCS.map(([k, label]) => `${label} ${p50p95(passesGpu.blocs[k])}`).join(' · '),
    '',
    '| passe | GPU ms p50/p95 | bloc |',
    '|---|---|---|',
    ...passesGpu.passes.map((p) => `| ${p.name} | ${p50p95(p.gpuMs)} | ${p.bloc} |`),
    '',
  ];
}
