/**
 * La lumière qui rebondit : les réglages publiés, et ce qu'ils bornent.
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
   * n'est pas tenu, et publie celle qu'il a prise.
   */
  proxyCellMetres: 0.5,
  /** Triangles d'une feuille du BVH : la boucle d'une feuille est bornée par ce nombre (X2). */
  proxyLeafTriangles: 8,
  /**
   * Nœuds visités par rayon : la traversée est bornée avant l'image, jamais par la profondeur. Un
   * nœud en porte quatre, donc cette borne couvre quatre fois plus d'arbre qu'un arbre binaire.
   * Un rayon de sonde qui l'épuise ne rapporte rien, ce qui assombrit ; un rayon d'ombre qui
   * l'épuise ne trouve pas d'occulteur, ce qui éclaire. Les deux sont déclarés (P5).
   */
  traversalSteps: 128,
  /**
   * Profondeur de la pile de traversée. Un nœud large empile trois enfants au plus et l'arbre est
   * équilibré par construction : trente-deux couvrent un proxy de plusieurs millions de triangles.
   * Un débordement abandonnerait un enfant, ce qui assombrit et ne fuit jamais.
   */
  traversalStack: 32,
  /**
   * Niveaux de la cascade de sondes. Les `cascadeLevels - 1` premiers suivent la caméra, chacun
   * deux fois plus écarté que le précédent ; le dernier est fixe dans le monde et couvre l'emprise
   * entière du proxy, pour que rien de la scène ne soit hors de portée d'une sonde.
   */
  cascadeLevels: 4,
  /** Sondes sur un axe et par niveau : un niveau est un cube de `cascadeSize³` sondes. */
  cascadeSize: 16,
  /**
   * Plafond de l'écartement du niveau le plus fin, en mètres. Deux mètres : la mesure du lot
   * précédent a montré que quatre perdent le contact avec les surfaces.
   */
  cascadeSpacingMetres: 2,
  /**
   * Couches de sondes qu'un niveau garde au moins en travers de la plus petite dimension de la
   * scène. Une pièce de trois mètres de haut n'aurait qu'une couche intérieure à deux mètres
   * d'écartement, et l'irradiance d'un plafond serait extrapolée depuis le voisinage du sol. Rien
   * ici ne nomme une scène : c'est l'emprise du proxy qui décide, pour n'importe quel modèle.
   */
  cascadeLayersAcross: 3,
  /**
   * Part du budget d'un niveau, du plus fin au plus grossier. Le niveau le plus fin entoure la
   * caméra : c'est celui que l'image lit le plus, et c'est pour cela qu'il reçoit le plus. Rien ici
   * ne teste un tronc de vue — une caméra qui pivote n'attendrait alors rien de bon.
   */
  cascadeShares: [8, 4, 2, 1],
  /** Rayons lancés par sonde à chaque mise à jour. Budget fixe et réglable (X2). */
  raysPerProbe: 64,
  /**
   * Plafond des rayons de sonde d'une image. C'est une borne connue avant l'image (X2), jamais la
   * consigne : la consigne est une durée, et l'asservissement ne peut que descendre sous ce plafond.
   */
  raysPerFrame: 49152,
  /** Lampes testées sur une maille du cache : la boucle est bornée par ce nombre (X2). */
  lightsPerRay: 4,
  /** Plafond des mailles du cache de surfaces mises à jour par image, même règle que les rayons. */
  surfaceTexelsPerFrame: 16384,
  /**
   * Durée visée de l'étape « Rebond » sur la carte graphique, par image, en millisecondes (LR1).
   * C'est la consigne de l'ordonnanceur : le travail de l'image suivante monte ou descend d'après
   * le chronomètre de l'étape, la cadence ne cède jamais, et c'est la convergence qui s'allonge.
   */
  budgetMs: 0.8,
  /** Part de l'écart reprise à chaque relevé : l'asservissement suit sans osciller. */
  budgetSmoothing: 0.25,
  /** Plancher de la fraction de travail : sous cela, la convergence n'avancerait plus du tout. */
  budgetFloor: 0.02,
  /**
   * Amortissement plancher d'une sonde stable : une moyenne courante finit par s'y arrêter, et
   * c'est ce plancher qui fixe le nombre de rayons dont l'image finale garde la mémoire.
   */
  blendStable: 0.2,
  /** Amortissement d'une sonde qui saute : elle reprend presque tout, donc le retard reste court. */
  blendMoving: 0.8,
  /** Résidu relatif au-delà duquel une sonde est déclarée en mouvement (hystérésis adaptative). */
  movingResidual: 0.05,
  /**
   * Balayages complets sans changement après lesquels la passe n'est plus encodée du tout. Chaque
   * balayage ajoute un ordre de rebond à la série : il en faut assez pour que la série soit close,
   * sans quoi l'état « stable » dépendrait de l'histoire de la scène et non d'elle seule.
   */
  settledSweeps: 16,
  /**
   * Distance moyenne en deçà de laquelle une sonde se déclare enterrée dans une surface, en
   * fraction de l'écartement de son niveau. Une sonde enterrée ne pèse plus rien : sans cela, la
   * lumière de l'intérieur d'un mur se répandrait dans la pièce d'à côté.
   */
  buriedFraction: 0.15,
  /**
   * Fraction de la portée au-delà de laquelle une sonde qui n'a rien touché se déclare en plein
   * ciel. Enterrée ou en plein ciel, elle est mise en sommeil : les mises à jour suivantes la
   * sautent sans lancer un rayon, jusqu'à ce qu'une lampe change ou qu'elle change de maille.
   */
  skyFraction: 0.98,
  /** Marge de visibilité d'une sonde, en fraction de l'écartement : au-delà elle est derrière un mur. */
  visibilityMargin: 0.6,
  /** Décalage du point d'application le long de la normale, en fraction de l'écartement. */
  normalBias: 0.35,
  /** Portée d'un rayon de sonde, en fraction de la diagonale de l'emprise : au-delà, rien à toucher. */
  rayReachFraction: 1,
} as const;

/**
 * Plafond des sondes mises à jour par image : le budget de rayons publié divisé par les rayons
 * d'une sonde. L'ordonnanceur y dimensionne sa file, et le budget en millisecondes n'en encode
 * qu'une fraction — il ne peut que descendre sous ce plafond, jamais le franchir (X2).
 */
export const BOUNCE_PROBES_PER_FRAME = Math.max(
  1,
  Math.floor(BOUNCE_SETTINGS.raysPerFrame / BOUNCE_SETTINGS.raysPerProbe),
);

/**
 * Flottants d'une sonde dans le tampon GPU : onze `vec4f`, jamais réalloués.
 *
 * Neuf portent la base d'harmoniques sphériques d'ordre 2 — un terme constant, trois linéaires,
 * cinq quadratiques —, deux les six distances moyennes de la visibilité. Les `w` des neuf premiers
 * portent l'état de la sonde : compte de mises à jour, résidu, utilisabilité, maille tenue, et la
 * révision à laquelle elle s'est endormie.
 */
export const PROBE_FLOATS = 44;
