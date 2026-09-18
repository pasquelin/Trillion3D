// La section « lampes, ombres, rebond » du rapport global : ce que coûte la lumière, par différence
// entre exécutions, et la porte d'identité des cartes d'ombre.
import { barres, deuxCols, nombre, pixels as px, tableau } from './rapportGlobalGraphes.mjs';
import { DEUX_VUES, LIBELLE, trouve } from './rapportGlobalLecture.mjs';

export function sectionLumiere(ex) {
  const runs = [
    ['sans-lumiere', 'aucune lampe (albédo brut)'],
    ['mobile', 'soleil seul'],
    ['lampes-4-sans-ombres', 'soleil + 4 ponctuelles sans ombres'],
    ['lampes-4', 'soleil + 4 ponctuelles avec ombres'],
    ['lampes-16', 'soleil + 16 ponctuelles avec ombres'],
    ['rebond', 'soleil + 4 ponctuelles + rebond'],
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
        ? `${nombre(o.lampesRedessinees, 0)} lampes, ${nombre(o.cascadesRedessinees, 0)} cascades, ${nombre(o.pagesRedessinees, 0)} pages, ${nombre(o.appelsDeDessin, 0)} appels`
        : 'non mesuré',
      o ? `${nombre(o.pagesEnAttente, 0)} pages, ${nombre(o.retardMaxMs, 1)} ms` : '—',
      b ? `${nombre(b.sondesMisesAJour, 0)} sondes, ${nombre(b.rayonsParImage, 0)} rayons` : '—',
    ];
  });
  const mobile = [
    ['lampe-mobile', 'pages d’ombre seulement (défaut)'],
    ['ombres-pages-off', 'face d’ombre entière'],
    ['budget-ombres-0-25', 'budget 0,25 ms'],
  ].map(([run, libelle]) => {
    const r = trouve(ex, run, 'sol', 1);
    const o = r?.ombres;
    return [
      libelle,
      nombre(r?.gpuP50, 2),
      nombre(r?.etape('shadows')?.gpuP50 ?? null, 3),
      o
        ? `${nombre(o.pagesInvalidees, 0)} invalidées, ${nombre(o.pagesRedessinees, 0)} redessinées, ${nombre(o.pagesEnAttente, 0)} en attente, retard ${nombre(o.retardMaxMs, 1)} ms / ${nombre(o.retardMaxImages, 0)} images`
        : 'non mesuré',
      r?.atlasOmbres
        ? `${String(r.atlasOmbres.hash).slice(0, 12)} (${nombre(r.atlasOmbres.written, 0)} écrites)`
        : 'non relevée',
      px(r?.temoinAA),
    ];
  });
  return [
    '<p>Ce que coûte la lumière, par différence entre exécutions : sans lampe, le moteur rend l’albédo brut ; le soleil ajoute ses cascades ; chaque ponctuelle sa carte d’ombre ; le rebond ses sondes.</p>',
    deuxCols(
      barres({
        id: 'g-lum-env',
        titre: 'Image entière selon l’éclairage, p50',
        unite: 'ms',
        series: DEUX_VUES.map((v) => LIBELLE[v]),
        lignes: enveloppe,
      }),
      barres({
        id: 'g-lum-ombres',
        titre: 'Étape « Ombres », GPU p50',
        sousTitre: 'étiquette de passe : indicative, voir la note sur l’horodatage',
        unite: 'ms',
        decimales: 3,
        series: DEUX_VUES.map((v) => LIBELLE[v]),
        lignes: ombres,
      }),
    ),
    tableau(
      [
        'Éclairage',
        'Lampes actives',
        'Ombres redessinées (vue sol)',
        'Pages en attente, retard',
        'Rebond',
      ],
      compteurs,
    ),
    '<h3>Une lampe qui bouge, caméra fixe</h3><p>Seule l’ombre de la lampe mobile se redessine ; c’est le travail d’une scène presque immobile. Les deux premières lignes doivent porter la même empreinte d’atlas : c’est la porte d’identité des cartes.</p>',
    tableau(
      ['Mode', 'Image entière p50', 'Ombres p50', 'Pages', 'Empreinte de l’atlas', 'Témoin A/A'],
      mobile,
    ),
  ].join('');
}
