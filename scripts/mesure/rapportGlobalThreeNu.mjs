// La section « face à Three.js nu » du rapport global : le rendu naïf de la même scène, mêmes poses
// et mêmes lampes, face au moteur, dans la même exécution. C'est le témoin qui survit au retrait de
// Three du moteur, et c'est là que se lisent les points faibles : chaque endroit où le moteur est
// plus lent, plus lourd ou plus loin de l'image qu'un rendu qui ne fait rien d'intelligent.
import {
  barres,
  deuxCols,
  delta,
  nombre,
  octets,
  pixels as px,
  secondes,
  tableau,
} from './rapportGlobalGraphes.mjs';
import { DEUX_VUES, paire, VUES } from './rapportGlobalLecture.mjs';

export function sectionThreeNu(ex) {
  const paires = (run, vues) => vues.map((v) => [v, ...paire(ex, run, v)]).filter(([, t]) => t);
  const pleine = paires('three-nu', VUES);
  if (!pleine.length) return '<p>The <code>three-nu</code> run is missing.</p>';
  const lignesTemps = pleine.map(([v, t, m]) => ({
    libelle: v,
    valeurs: [t.imageSyncP50, m.gpuP50],
  }));
  const lignesCpu = pleine.map(([v, t, m]) => ({ libelle: v, valeurs: [t.cpuP50, m.cpuP50] }));
  const tableTemps = pleine.map(([v, t, m]) => [
    v,
    nombre(t.imageSyncP50, 2),
    nombre(t.imageSyncP95, 2),
    nombre(m.gpuP50, 2),
    nombre(m.gpuP95, 2),
    nombre(t.rafP50, 2),
    nombre(t.cpuP50, 2),
    nombre(m.cpuP50, 2),
    secondes(t.preparationMs),
    secondes(m.preparationMs),
  ]);
  const tableCharge = pleine.map(([v, t, m]) => [
    v,
    nombre(t.appelsDeDessin, 0),
    nombre(m.appelsDeDessin, 0),
    nombre(t.trianglesDessines, 0),
    nombre(m.triangles, 0),
    octets(t.geometrieOctets),
    octets(m.geometrieOctets),
    octets(t.texturesEngagees),
    octets(m.texturesEngagees),
    t.reseau ? octets(Object.values(t.reseau).reduce((a, b) => a + b, 0)) : '—',
    m.reseau ? octets(Object.values(m.reseau).reduce((a, b) => a + b, 0)) : '—',
  ]);
  const fidelite = [
    ['three-nu', 'sun and shadows'],
    ['three-nu-sans-ombres', 'sun, no shadows'],
    ['three-nu-lampes-4', 'sun + 4 shadowed point lights'],
    ['three-nu-1248', '1248×702, sun and shadows'],
  ].flatMap(([run, libelle]) =>
    paires(run, VUES).map(([v, t, m]) => [
      `${libelle} · ${v}`,
      nombre(t.imageSyncP50, 2),
      nombre(m.gpuP50, 2),
      delta(m.gpuP50, t.imageSyncP50, 2),
      px(m.ecart),
      px(m.temoinAA),
    ]),
  );
  const quart = paires('three-nu-1248', DEUX_VUES);
  return [
    '<p>Three.js vanilla: the source glTF loaded by <code>GLTFLoader</code>, <code>MeshStandardMaterial</code>, everything drawn every frame, one 4096² shadow map for the sun, a 1024² cube per point light, ACES and sRGB. No selection, no streaming, no temporal antialiasing, no bounce. Its frame time is a <strong>synced wall clock</strong> (<code>render</code> then a pixel read that waits for the GPU): one measurement, not a sum, and not the same as a GPU-pass envelope — the two columns are read side by side, not against each other to a tenth of a millisecond. WebGL does not give per-pass times.</p>',
    deuxCols(
      barres({
        id: 'g-nu-temps',
        titre: 'One frame: Three vanilla (synced wall time) and engine (GPU envelope), p50',
        unite: 'ms',
        series: ['Three vanilla', 'WebGPU engine'],
        lignes: lignesTemps,
      }),
      barres({
        id: 'g-nu-cpu',
        titre: 'CPU per frame, p50',
        unite: 'ms',
        series: ['Three vanilla', 'WebGPU engine'],
        lignes: lignesCpu,
      }),
    ),
    tableau(
      [
        'View',
        'Three wall p50',
        'Three wall p95',
        'Engine GPU p50',
        'Engine GPU p95',
        'Three rAF p50',
        'Three CPU p50',
        'Engine CPU p50',
        'Three prepare',
        'Engine prepare',
      ],
      tableTemps,
    ),
    '<h3>What each draws and holds</h3>',
    tableau(
      [
        'View',
        'Three calls',
        'Engine calls',
        'Three triangles (drawn)',
        'Engine triangles (selected)',
        'Three geometry',
        'Engine geometry',
        'Three textures (estimated, mips)',
        'Engine textures (committed)',
        'Three network',
        'Engine network',
      ],
      tableCharge,
    ),
    '<h3>Fidelity: image delta between the two, and what each lighting costs</h3><p>The pixel delta is from the last measured frame, same pose on both sides. Without shadows, only materials and direct light remain: that is the most telling delta. With shadows, Three has one map where the engine has cascades — the delta is mostly shadows.</p>',
    tableau(
      [
        'Run · view',
        'Three wall p50',
        'Engine GPU p50',
        'Δ (engine − Three)',
        'Image delta',
        'Engine A/A witness',
      ],
      fidelite,
    ),
    '<p>Images are compared in the “Do the images match?” card at the top of the report.</p>',
    quart.length
      ? `<h3>At 1248×702</h3><p>${quart.map(([v, t, m]) => `${v}: Three ${nombre(t.imageSyncP50, 2, 'ms')}, engine ${nombre(m.gpuP50, 2, 'ms')}`).join(' · ')}.</p>`
      : '',
  ].join('');
}
