// La section « lampes, ombres, rebond » du rapport global : ce que coûte la lumière, par différence
// entre exécutions, et la porte d'identité des cartes d'ombre.
import { barres, deuxCols, nombre, pixels as px, tableau } from './rapportGlobalGraphes.mjs';
import { DEUX_VUES, LIBELLE, trouve } from './rapportGlobalLecture.mjs';

export function sectionLumiere(ex) {
  const runs = [
    ['sans-lumiere', 'no light (raw albedo)'],
    ['mobile', 'sun only'],
    ['soleil-sans-ombres', 'sun without shadow maps'],
    ['lampes-4-sans-ombres', 'sun + 4 point lights, no shadows'],
    ['lampes-4', 'sun + 4 point lights with shadows'],
    ['lampes-16', 'sun + 16 point lights with shadows'],
    ['rebond', 'sun + 4 point lights + bounce'],
  ];
  const enveloppe = runs.map(([run, libelle]) => ({
    libelle,
    valeurs: DEUX_VUES.map((v) => trouve(ex, run, v, 1)?.gpuP50 ?? null),
  }));
  const ombres = runs.map(([run, libelle]) => ({
    libelle,
    valeurs: DEUX_VUES.map((v) => trouve(ex, run, v, 1)?.etape('shadows')?.gpuP50 ?? null),
  }));
  const compteurs = runs.map(([run, libelle]) => {
    const r = trouve(ex, run, 'sol', 1);
    const o = r?.ombres;
    const b = r?.rebond;
    return [
      libelle,
      nombre(r?.lampesActives, 0),
      o
        ? `${nombre(o.lampesRedessinees, 0)} lights, ${nombre(o.cascadesRedessinees, 0)} cascades, ${nombre(o.pagesRedessinees, 0)} pages, ${nombre(o.appelsDeDessin, 0)} calls`
        : 'not measured',
      o ? `${nombre(o.pagesEnAttente, 0)} pages, ${nombre(o.retardMaxMs, 1)} ms lag` : '—',
      b ? `${nombre(b.sondesMisesAJour, 0)} probes, ${nombre(b.rayonsParImage, 0)} rays` : '—',
    ];
  });
  const mobile = [
    ['lampe-mobile', 'shadow pages only (default)'],
    ['ombres-pages-off', 'full shadow face'],
    ['budget-ombres-0-25', '0.25 ms budget'],
  ].map(([run, libelle]) => {
    const r = trouve(ex, run, 'sol', 1);
    const o = r?.ombres;
    return [
      libelle,
      nombre(r?.gpuP50, 2),
      nombre(r?.etape('shadows')?.gpuP50 ?? null, 3),
      o
        ? `${nombre(o.pagesInvalidees, 0)} invalidated, ${nombre(o.pagesRedessinees, 0)} redrawn, ${nombre(o.pagesEnAttente, 0)} pending, lag ${nombre(o.retardMaxMs, 1)} ms / ${nombre(o.retardMaxImages, 0)} frames`
        : 'not measured',
      r?.atlasOmbres
        ? `${String(r.atlasOmbres.hash).slice(0, 12)} (${nombre(r.atlasOmbres.written, 0)} written)`
        : 'not sampled',
      px(r?.temoinAA),
    ];
  });
  return [
    '<p>What lighting costs, by difference between runs: with no light the engine draws raw albedo; the sun adds its cascades; each point light its shadow map; bounce its probes.</p>',
    deuxCols(
      barres({
        id: 'g-lum-env',
        titre: 'Whole frame by lighting, p50',
        unite: 'ms',
        series: DEUX_VUES.map((v) => LIBELLE[v]),
        lignes: enveloppe,
      }),
      barres({
        id: 'g-lum-ombres',
        titre: '“Shadows” step, GPU p50',
        sousTitre: 'pass label: indicative, see the timestamp note',
        unite: 'ms',
        decimales: 3,
        series: DEUX_VUES.map((v) => LIBELLE[v]),
        lignes: ombres,
      }),
    ),
    tableau(
      [
        'Lighting',
        'Active lights',
        'Shadows redrawn (street view)',
        'Pending pages, lag',
        'Bounce',
      ],
      compteurs,
    ),
    '<h3>A moving light, locked camera</h3><p>Only the moving light’s shadow redraws; that is the work of an almost still scene. The first two rows must share the same atlas fingerprint: that is the map identity gate.</p>',
    tableau(
      ['Mode', 'Whole frame p50', 'Shadows p50', 'Pages', 'Atlas fingerprint', 'A/A witness'],
      mobile,
    ),
  ].join('');
}
