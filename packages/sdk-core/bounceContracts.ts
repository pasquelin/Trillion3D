/**
 * La lumière qui rebondit : les réglages publiés, et la grille de sondes qu'ils décident.
 *
 * Rien ici ne nomme une scène. Le proxy est une représentation grossière de toute la géométrie,
 * construite à la compilation et indépendante de la caméra (LC1) ; les sondes lancent leurs rayons
 * contre lui, jamais contre la coupe visible, et l'irradiance qu'elles accumulent s'applique à la
 * résolution différée opaque multipliée par l'albédo (LR4).
 *
 * Aucune lumière n'apparaît sans source déclarée (P6) : sans lampe, l'irradiance indirecte est
 * exactement nulle, parce que rien n'a éclairé le point que le rayon a touché.
 */

/** Réglages du rebond. Ce sont des choix de produit nommés : chaque borne du runtime les relit. */
export const BOUNCE_SETTINGS = {
  /**
   * Plancher de l'erreur géométrique certifiée d'un cluster retenu dans le proxy, en mètres (LC1).
   * Le seuil réellement obtenu double tant que la coupe ne tient pas dans le budget de triangles ;
   * le manifeste publie celui qu'elle a pris.
   */
  proxyErrorMetres: 0.05,
  /** Triangles du proxy d'une scène entière, toutes instances posées : ce qui reste résident. */
  proxyTriangleBudget: 300_000,
  /**
   * Plancher de la maille du proxy, en mètres : la taille d'un triangle après simplification, donc
   * la résolution du cache de surfaces. Le compilateur la double tant que le budget de triangles
   * n'est pas tenu, et publie celle qu'il a prise. Plus fin que cela ne se verrait pas dans un
   * indirect que huit sondes interpolent, et coûterait des mailles à balayer.
   */
  proxyCellMetres: 0.25,
  /** Triangles d'une feuille du BVH : la boucle d'une feuille est bornée par ce nombre (X2). */
  proxyLeafTriangles: 8,
  /** Nœuds visités par rayon : la traversée est bornée avant l'image, jamais par la profondeur. */
  traversalSteps: 512,
  /**
   * Profondeur de la pile de traversée. Un nœud large empile trois enfants au plus et l'arbre est
   * équilibré par construction : trente-deux couvrent un proxy de plusieurs millions de triangles.
   * Un débordement abandonnerait un enfant, ce qui assombrit et ne fuit jamais.
   */
  traversalStack: 32,
  /** Sondes de la grille, au plus. Au-delà, la grille s'écarte au lieu de s'agrandir. */
  maxProbes: 16384,
  /** Sondes sur un axe, au plus : une grille très plate reste lisible dans les deux autres. */
  maxProbesPerAxis: 64,
  /** Écartement visé entre deux sondes, en mètres. Une emprise plus grande écarte les sondes. */
  probeSpacingMetres: 2,
  /** Rayons lancés par sonde à chaque mise à jour. Budget fixe et réglable (X2). */
  raysPerProbe: 64,
  /**
   * Sondes mises à jour par image : la grille est balayée en `probes / probesPerFrame` images.
   * C'est le budget de rayons de l'image, et il ne bouge pas : c'est la lumière qui converge, pas
   * la cadence qui cède. Une petite scène balaie tout d'un coup, une grande y met le temps qu'il
   * faut, et le harnais publie ce temps.
   */
  probesPerFrame: 8192,
  /** Lampes testées sur une maille du cache : la boucle est bornée par ce nombre (X2). */
  lightsPerRay: 4,
  /**
   * Mailles du cache de surfaces mises à jour par image. C'est l'autre budget fixe de l'image : le
   * cache entier est balayé en `mailles / surfaceTexelsPerFrame` images, et c'est ce nombre qui
   * décide du retard autant que celui des sondes.
   */
  surfaceTexelsPerFrame: 65536,
  /**
   * Amortissement plancher d'une sonde stable : une moyenne courante finit par s'y arrêter, et
   * c'est ce plancher qui fixe le nombre de rayons dont l'image finale garde la mémoire.
   */
  blendStable: 0.1,
  /** Amortissement d'une sonde qui saute : elle reprend presque tout, donc le retard reste court. */
  blendMoving: 0.8,
  /** Résidu relatif au-delà duquel une sonde est déclarée en mouvement (hystérésis adaptative). */
  movingResidual: 0.12,
  /**
   * Balayages complets sans changement après lesquels la passe n'est plus encodée du tout. Chaque
   * balayage ajoute un ordre de rebond à la série : il en faut assez pour que la série soit close,
   * sans quoi l'état « stable » dépendrait de l'histoire de la scène et non d'elle seule.
   */
  settledSweeps: 16,
  /**
   * Distance moyenne en deçà de laquelle une sonde se déclare enterrée dans une surface, en
   * fraction du plus petit pas de la grille. Une sonde enterrée ne pèse plus rien : sans cela, la
   * lumière de l'intérieur d'un mur se répandrait dans la pièce d'à côté.
   */
  buriedFraction: 0.15,
  /** Marge de visibilité d'une sonde, en fraction de l'écartement : au-delà elle est derrière un mur. */
  visibilityMargin: 0.6,
  /** Décalage du point d'application le long de la normale, en fraction de l'écartement. */
  normalBias: 0.35,
  /** Portée d'un rayon de sonde, en fraction de la diagonale de l'emprise : au-delà, rien à toucher. */
  rayReachFraction: 1,
} as const;

/** Flottants d'une sonde dans le tampon GPU : six `vec4f`, jamais réalloués. */
export const PROBE_FLOATS = 24;

/**
 * La grille de sondes d'une emprise.
 *
 * Les sondes sont au centre des mailles, jamais à leurs coins : une sonde posée sur l'emprise
 * tombe dans le mur, le sol ou le plafond qui la borne, n'y voit rien et ne sait plus rien dire de
 * la pièce. L'écartement visé fixe le nombre de mailles, le budget le plafonne, et l'écartement
 * réellement obtenu est publié. Rien ici ne connaît de scène : une emprise et deux bornes suffisent.
 */
export function probeGridOf(bounds: readonly number[]) {
  const extent = [
    Math.max(bounds[3] - bounds[0], 0),
    Math.max(bounds[4] - bounds[1], 0),
    Math.max(bounds[5] - bounds[2], 0),
  ];
  let counts = extent.map((size) =>
    Math.min(
      BOUNCE_SETTINGS.maxProbesPerAxis,
      Math.max(1, Math.round(size / BOUNCE_SETTINGS.probeSpacingMetres)),
    ),
  );
  // Le budget se tient en écartant les sondes, jamais en tronquant l'emprise : une pièce entière
  // reste couverte, plus grossièrement, plutôt que couverte à moitié.
  while (counts[0] * counts[1] * counts[2] > BOUNCE_SETTINGS.maxProbes) {
    const axis = counts.indexOf(Math.max(...counts));
    if (counts[axis] <= 1) break;
    counts = counts.map((value, index) => (index === axis ? value - 1 : value));
  }
  const spacing = extent.map((size, axis) => Math.max(size / counts[axis], 1e-3));
  return {
    counts: counts as [number, number, number],
    origin: [
      bounds[0] + spacing[0] / 2,
      bounds[1] + spacing[1] / 2,
      bounds[2] + spacing[2] / 2,
    ] as [number, number, number],
    spacing: spacing as [number, number, number],
    probes: counts[0] * counts[1] * counts[2],
  };
}
