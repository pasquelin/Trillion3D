// The "memory" and "engines" sections of the global report: instances, page budget, textures;
// the three engines of the repository and the SDK Three witness, with refused runs.
import { nombre, octets, pixels as px, secondes, tableau } from './rapportGlobalGraphes.mjs';
import { trouve, VIEW_IDS } from './rapportGlobalLecture.mjs';

export function sectionMemoire(ex) {
  const inst = [
    ['mobile', '1 copy'],
    ['instances-4', '4 copies'],
    ['instances-12', '12 copies'],
  ].map(([run, libelle]) => {
    const r = trouve(ex, run, 'generale', 1);
    return [
      libelle,
      octets(r?.geometrieOctets),
      nombre(r?.pagesResidentes, 0),
      nombre(r?.triangles, 0),
      nombre(r?.gpuP50, 2),
      nombre(r?.cpuP50, 2),
    ];
  });
  const budget = VIEW_IDS.map((vue) => {
    const a = trouve(ex, 'mobile', vue, 1);
    const b = trouve(ex, 'budget-3000', vue, 1);
    return [
      vue,
      `${nombre(a?.pagesResidentes, 0)} / ${nombre(a?.pagesDemandees, 0)}`,
      `${nombre(b?.pagesResidentes, 0)} / ${nombre(b?.pagesDemandees, 0)}${b?.couvertureLimitee ? ' (coverage limited)' : ''}`,
      nombre(a?.trianglesNonCouverts, 0),
      nombre(b?.trianglesNonCouverts, 0),
      octets(a?.geometrieOctets),
      octets(b?.geometrieOctets),
      nombre(b?.gpuP50, 2),
    ];
  });
  const r = trouve(ex, 'mobile', 'sol', 1);
  const h = trouve(ex, 'textures-host', 'sol', 1);
  const textures = [
    ['cooked pyramid (cache)', r],
    ['source images (host)', h],
  ].map(([libelle, x]) => [
    libelle,
    octets(x?.texturesPool),
    octets(x?.texturesEngagees),
    `${nombre(x?.tuilesAuNiveau, 0)} / ${nombre(x?.tuilesDemandees, 0)}`,
    nombre(x?.texturesEvictions, 0),
    x?.reseau ? `png ${octets(x.reseau.png)}, bin ${octets(x.reseau.bin)}` : 'not measured',
    secondes(x?.preparationMs),
  ]);
  return [
    '<p>Parity is a memory criterion as much as a speed one: fixed budgets, residency driven by the frame, compression at cook time. Here is what the engine holds in memory on this scene.</p>',
    '<h3>Instances</h3>',
    tableau(
      ['Copies', 'Resident geometry', 'Resident pages', 'Selected triangles', 'GPU p50', 'CPU p50'],
      inst,
    ),
    '<h3>Page budget: 100,000 vs 3,000</h3>',
    tableau(
      [
        'View',
        'Resident / requested (100,000)',
        'Resident / requested (3,000)',
        'Uncovered (100,000)',
        'Uncovered (3,000)',
        'Geometry (100,000)',
        'Geometry (3,000)',
        'GPU p50 (3,000)',
      ],
      budget,
    ),
    '<h3>Textures</h3>',
    tableau(
      [
        'Source',
        'Tile pool',
        'Committed',
        'Tiles at requested level / requested',
        'Evictions',
        'Network',
        'Prepare',
      ],
      textures,
    ),
  ].join('');
}

export function sectionMoteurs(ex) {
  const lignes = [];
  for (const vue of VIEW_IDS)
    for (const [run, side, libelle] of [
      ['mobile', null, 'WebGPU (webgpu-page-raster)'],
      ['webgl', null, 'WebGL (exact-cluster-pages)'],
      ['webgl2', null, 'Standalone WebGL2'],
      ['temoin-three', 'avant', 'Three witness, locked camera, no shadows'],
      ['temoin-three', 'apres', 'WebGPU, locked camera, no shadows'],
    ]) {
      const r = trouve(ex, run, vue, 1, side);
      if (!r) continue;
      lignes.push([
        `${vue} · ${libelle}`,
        nombre(r.cpuP50, 2),
        nombre(r.cpuSelectP50, 2),
        nombre(r.gpuP50, 2),
        nombre(r.triangles, 0),
        nombre(r.appelsDeDessin, 0),
        nombre(r.decodageWasm, 0),
        px(r.temoinAA),
        r.ecart ? px(r.ecart) : '—',
      ]);
    }
  const refus = ex
    .filter((e) => e.absent || e.erreurs?.length)
    .map((e) => [
      e.name,
      e.absent ? e.erreur : e.erreurs.map((x) => x.message ?? JSON.stringify(x)).join(' · '),
    ]);
  return [
    '<p>The three engines in the repo on the same path, and the Three witness versus the WebGPU engine at a locked pose with no shadows — the witness does not draw them — which gives a fidelity delta in pixels, not a comparison between two campaigns.</p>',
    tableau(
      [
        'Engine',
        'CPU p50',
        'CPU select p50',
        'GPU p50',
        'Triangles',
        'Calls',
        'Wasm-decoded pages',
        'A/A witness',
        'Before/after delta',
      ],
      lignes,
    ),
    refus.length ? `<h3>Refused or failed runs</h3>${tableau(['Run', 'Reason'], refus)}` : '',
  ].join('');
}
