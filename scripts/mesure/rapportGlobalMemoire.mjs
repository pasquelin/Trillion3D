// Les sections « mémoire » et « moteurs » du rapport global : instances, budget de pages, textures ;
// les trois moteurs du dépôt et le témoin Three du SDK, avec les exécutions refusées.
import { nombre, octets, pixels as px, secondes, tableau } from './rapportGlobalGraphes.mjs';
import { trouve, VUES } from './rapportGlobalLecture.mjs';

export function sectionMemoire(ex) {
  const inst = [
    ['mobile', '1 copie'],
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
  const budget = VUES.map((vue) => {
    const a = trouve(ex, 'mobile', vue, 1);
    const b = trouve(ex, 'budget-3000', vue, 1);
    return [
      vue,
      `${nombre(a?.pagesResidentes, 0)} / ${nombre(a?.pagesDemandees, 0)}`,
      `${nombre(b?.pagesResidentes, 0)} / ${nombre(b?.pagesDemandees, 0)}${b?.couvertureLimitee ? ' (couverture limitée)' : ''}`,
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
    ['pyramide cuite (cache)', r],
    ['images sources (host)', h],
  ].map(([libelle, x]) => [
    libelle,
    octets(x?.texturesPool),
    octets(x?.texturesEngagees),
    `${nombre(x?.tuilesAuNiveau, 0)} / ${nombre(x?.tuilesDemandees, 0)}`,
    nombre(x?.texturesEvictions, 0),
    x?.reseau ? `png ${octets(x.reseau.png)}, bin ${octets(x.reseau.bin)}` : 'non mesuré',
    secondes(x?.preparationMs),
  ]);
  return [
    '<p>La parité est un critère de mémoire autant que de vitesse : budgets fixes, résidence pilotée par l’image, compression à la cuisson. Voici ce que le moteur tient en mémoire sur cette scène.</p>',
    '<h3>Instances</h3>',
    tableau(
      [
        'Copies',
        'Géométrie résidente',
        'Pages résidentes',
        'Triangles sélectionnés',
        'GPU p50',
        'CPU p50',
      ],
      inst,
    ),
    '<h3>Budget de pages : 100 000 contre 3 000</h3>',
    tableau(
      [
        'Vue',
        'Résidentes / demandées (100 000)',
        'Résidentes / demandées (3 000)',
        'Non couverts (100 000)',
        'Non couverts (3 000)',
        'Géométrie (100 000)',
        'Géométrie (3 000)',
        'GPU p50 (3 000)',
      ],
      budget,
    ),
    '<h3>Textures</h3>',
    tableau(
      [
        'Source',
        'Pool de tuiles',
        'Engagé',
        'Tuiles au niveau voulu / demandées',
        'Évictions',
        'Réseau',
        'Préparation',
      ],
      textures,
    ),
  ].join('');
}

export function sectionMoteurs(ex) {
  const lignes = [];
  for (const vue of VUES)
    for (const [run, cote, libelle] of [
      ['mobile', null, 'WebGPU (webgpu-page-raster)'],
      ['webgl', null, 'WebGL (exact-cluster-pages)'],
      ['webgl2', null, 'WebGL2 autonome'],
      ['temoin-three', 'avant', 'Témoin Three, caméra fixe, sans ombres'],
      ['temoin-three', 'apres', 'WebGPU, caméra fixe, sans ombres'],
    ]) {
      const r = trouve(ex, run, vue, 1, cote);
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
      e.nom,
      e.absent ? e.erreur : e.erreurs.map((x) => x.message ?? JSON.stringify(x)).join(' · '),
    ]);
  return [
    '<p>Les trois moteurs du dépôt sur la même trajectoire, et le témoin Three face au moteur WebGPU à pose fixe et sans ombres — le témoin n’en dessine pas —, ce qui donne un écart de fidélité en pixels et non une comparaison entre deux campagnes.</p>',
    tableau(
      [
        'Moteur',
        'CPU p50',
        'Sélection CPU p50',
        'GPU p50',
        'Triangles',
        'Appels',
        'Pages décodées wasm',
        'Témoin A/A',
        'Écart avant/après',
      ],
      lignes,
    ),
    refus.length
      ? `<h3>Exécutions refusées ou en erreur</h3>${tableau(['Exécution', 'Raison'], refus)}`
      : '',
  ].join('');
}
