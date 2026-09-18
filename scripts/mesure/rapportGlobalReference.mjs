// Les chiffres publiés de la référence, tels que `docs/REFERENCE_UE5.md` les cite, mis en regard
// des relevés de la campagne. Rien d'autre que ce document : une grandeur sans chiffre publié dit
// « non publié », et une comparaison qui n'est pas honnête (machine, scène, résolution différentes)
// le dit dans sa colonne « lecture ».
import { nombre, octets, tableau } from './rapportGlobalGraphes.mjs';
import { OCTETS_PAR_TRIANGLE, sommePasses, UNREAL, visibilite } from './rapportGlobalChiffres.mjs';

/**
 * Le tableau « la référence / nous ». `mobile` est le relevé de la campagne à pleine résolution en
 * vue sol, `fixe` le même à caméra fixe. Les millisecondes de la référence sont celles de sa démo
 * sur console, pas de cette machine : la colonne « lecture » le rappelle à chaque ligne.
 */
export function tableauReference({ mobile, fixe, instances12 }) {
  const cpu = mobile?.cpuP50 ?? null;
  const lignes = [
    [
      'Triangles par grappe',
      String(UNREAL.trianglesParGrappe),
      String(UNREAL.trianglesParGrappe),
      'identique (constante vérifiée par le test)',
    ],
    [
      'Grappes par groupe',
      UNREAL.grappesParGroupe.join(' à '),
      UNREAL.grappesParGroupe.join(' à '),
      'identique ; le plancher 8 n’est pas appliqué (Géométrie 16)',
    ],
    [
      'Page de diffusion',
      `${UNREAL.pageKio} Kio (source secondaire)`,
      `${UNREAL.pageKio} Kio`,
      'identique',
    ],
    [
      'Budget de résidence',
      `${UNREAL.poolMo} Mo, pages racines épinglées`,
      mobile
        ? `${nombre(mobile.pagesDemandees, 0)} pages demandées, ${nombre(mobile.pagesResidentes, 0)} résidentes, ${octets(mobile.geometrieOctets)}`
        : 'non mesuré',
      'compté en pages chez nous, en octets chez eux',
    ],
    [
      'Géométrie en mémoire',
      `${nombre(UNREAL.octetsParTriangle, 1)} octets par triangle`,
      `~${OCTETS_PAR_TRIANGLE.nous} octets par triangle (docs/FORMAT.md, non mesuré ici)`,
      'le banc publie des octets résidents, pas des octets par triangle : ~6× au-dessus par la doc',
    ],
    [
      'Triangles rastérisés par image',
      `${nombre(UNREAL.trianglesParImage / 1e6, 0)} M quelle que soit la scène`,
      mobile ? nombre(mobile.triangles, 0) : 'non mesuré',
      'notre compte suit la scène et la qualité demandée, le leur est fixe',
    ],
    [
      'Coût processeur par image',
      '« presque nul »',
      nombre(cpu, 2, 'ms'),
      'la seule milliseconde comparable d’une machine à l’autre',
    ],
    [
      'Tampon de visibilité (GPU)',
      `~${nombre(UNREAL.visibiliteMs, 1)} ms (PS5, 2496×1404)`,
      nombre(sommePasses(mobile, visibilite), 2, 'ms'),
      'même résolution, machine différente : forme du profil, pas verdict',
    ],
    [
      'Passe matériaux (GPU)',
      `~${nombre(UNREAL.materiauxMs, 1)} ms (Emit GBuffer)`,
      nombre(mobile?.passe('WG material surfaces v1')?.p50 ?? null, 2, 'ms'),
      'même réserve',
    ],
    [
      'Appels de dessin',
      'un par matériau',
      mobile ? nombre(mobile.appelsDeDessin, 0) : 'non mesuré',
      'un seul pour les grappes exactes ; un par item et par face pour le mélange',
    ],
    [
      'Travail dans une scène immobile',
      'aucun',
      fixe
        ? fixe.gpuReleves === 0 && fixe.imageTenue
          ? 'aucune passe carte : image tenue'
          : `${fixe.gpuReleves} relevés carte`
        : 'non mesuré',
      fixe ? `processeur ${nombre(fixe.cpuP50, 2, 'ms')} par image à caméra fixe` : '',
    ],
    [
      'Antialiasing temporel',
      'non publié (rendu à 2496×1404, remonté en 4K)',
      nombre(mobile?.passe('WG temporal antialiasing')?.p50 ?? null, 2, 'ms'),
      'à résolution native, sans remontée',
    ],
    [
      'Instances',
      'une fiche par grappe, l’instance en index',
      instances12
        ? `12 copies : ${octets(instances12.geometrieOctets)} de géométrie`
        : 'non mesuré',
      'douze copies des grappes (Géométrie 5)',
    ],
    [
      'Textures',
      'pool physique fixe, comprimé à la cuisson (non sourcé)',
      mobile
        ? `${octets(mobile.texturesEngagees)} engagés sur ${octets(mobile.texturesPool)} de pool RGBA brut`
        : 'non mesuré',
      'ni pool fixe ni compression (Textures T4, T5)',
    ],
    [
      'Matériaux du chemin virtualisé',
      'opaque et masqué seulement',
      'opaque, masqué et mélange',
      'le mélange coûte un appel par item et par face (Compilateur 10)',
    ],
  ];
  return tableau(
    ['Grandeur', 'La référence', 'Nous (cette campagne)', 'Lecture'],
    lignes,
    'reference',
  );
}

/** Le profil de la référence par passe, en regard des nôtres, pour la FORME du profil. */
export function tableauProfilReference(mobile) {
  const nous = (test) =>
    nombre(
      sommePasses(mobile, (p) => test(p.nom)),
      3,
      'ms',
    );
  const lignes = [
    ['Clear VisBuffer', '0,066', nous((n) => n === 'WG clear')],
    [
      'InstanceCull + ClusterCull',
      '0,514',
      nous((n) => /^WG (DAG selection|draw compaction|partition)$/.test(n)),
    ],
    [
      'Rasterize (matériel + calcul)',
      '1,148',
      nous((n) => /^WG (visibility|raster |small triangle|hybrid)/.test(n)),
    ],
    ['BuildHZB', '0,099', nous((n) => n.startsWith('WG HiZ'))],
    ['Post Pass (2e passe d’occultation)', '0,410', nous((n) => n === 'WG visibility secondary')],
    [
      'Emit GBuffer / passe matériaux',
      '2,084',
      nous((n) => /^WG (material surfaces|empty surfaces)/.test(n)),
    ],
    [
      'Ombres (cartes d’ombre virtuelles)',
      'non publié dans ce talk',
      nous((n) => /^WG shadow/.test(n)),
    ],
    [
      'Éclairage différé',
      'non publié dans ce talk',
      nous((n) => /^WG (deferred lighting|light tiles)/.test(n)),
    ],
    ['Antialiasing temporel', 'non publié', nous((n) => n === 'WG temporal antialiasing')],
    ['Présentation', 'non publié', nous((n) => /^WG (HDR composition|direct present)/.test(n))],
  ];
  return tableau(
    ['Passe', 'Référence, ms (PS5, 2496×1404 → 4K)', 'Nous, ms p50 (vue sol, 2496×1404)'],
    lignes,
  );
}
