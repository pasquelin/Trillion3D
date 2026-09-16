/**
 * Une lampe de scène, version 2. Les unités sont radiométriques et linéaires (P1) : `color` est une
 * couleur linéaire et `intensity` une intensité radiométrique strictement positive.
 *
 * Trois types, et rien d'autre ne fait de lumière dans ce moteur (P6) :
 * - `point` : une position et une portée en mètres au-delà de laquelle elle n'éclaire plus rien ;
 * - `spot` : la même chose plus une direction et un demi-angle de cône en radians ;
 * - `directional` : le soleil ou un ciel couvert — une direction de propagation, aucune position et
 *   aucune portée, la même irradiance partout, et des ombres en cascades qui suivent la caméra.
 *
 * Les champs qu'un type n'utilise pas sont refusés à la validation : une lampe directionnelle avec
 * une position serait une promesse que le moteur ne tiendrait pas.
 */
export interface SceneLight {
  id: string;
  kind: 'point' | 'spot' | 'directional';
  /** Ponctuelle et projecteur seulement : le point d'où part la lumière, en mètres. */
  position?: [number, number, number];
  /** Projecteur : l'axe du cône. Directionnelle : le sens de propagation (du soleil vers le sol). */
  direction?: [number, number, number];
  color: [number, number, number];
  intensity: number;
  /** Ponctuelle et projecteur seulement : la portée en mètres, où l'énergie s'annule exactement. */
  range?: number;
  coneAngle?: number;
  /**
   * Ponctuelle et projecteur seulement : le rayon, en mètres, de l'enveloppe qui porte la source.
   * Une lampe réelle est toujours logée dans quelque chose — verre de lanterne, réflecteur, abat-jour
   * —, et cette enveloppe est de la géométrie comme une autre : sans ce champ, elle entre dans la
   * carte d'ombre de sa propre lampe et l'éteint. Déclaré, il devient le plan proche de cette carte,
   * donc rien de ce qui se tient à moins de ce rayon de la source n'y projette d'ombre. C'est une
   * propriété de la lampe, jamais un nom d'objet ni un type de matériau : le moteur ne connaît que
   * des surfaces. Strictement positif et strictement inférieur à la portée ; absent, rien ne change.
   */
  emitterRadius?: number;
  castsShadow: boolean;
}
/**
 * L'exposition de la caméra, appliquée à la radiance linéaire juste avant ACES (P4). Ce n'est pas
 * une lumière : elle ne peut pas éclairer une surface que rien n'éclaire, elle ne fait que régler
 * la conversion de la radiance en image. Une scène sans lampe reste noire quelle que soit sa valeur.
 */
export interface SceneEnvironment {
  exposure: number;
}
export const SCENE_LIGHT_VERSION = 2;
/**
 * Ce que l'hôte demande à voir. `lit` est l'éclairage réel et lui seul ; `unlit` est la vue de
 * diagnostic d'albédo brut — la couleur des matériaux telle quelle, sans lampe, sans ambiance et
 * sans émission — pour les bancs de géométrie qui comparent des images au pixel près. `auto`, la
 * valeur par défaut, rend `unlit` tant qu'aucune lampe n'est déclarée et `lit` dès qu'il y en a une.
 *
 * `bounce` est la troisième vue de diagnostic : l'irradiance indirecte seule, multipliée par
 * l'exposition et sortie en valeurs linéaires sans ACES ni sRGB. C'est ce que le harnais compare à
 * l'oracle du compilateur ; ce n'est pas une image à regarder, et elle vaut noir sans rebond gréé.
 */
export type SceneLightingView = 'auto' | 'lit' | 'unlit' | 'bounce';
/**
 * Réglages publiés de l'éclairage direct. Ce sont des choix de produit nommés, pas des constantes
 * enfouies : chaque borne du runtime les relit, et le diagnostic les publie telles quelles.
 */
export const LIGHT_SETTINGS = {
  /** Lampes que le contrat accepte au total ; au-delà, `addLight` refuse. */
  maxLights: 64,
  /** Lampes qu'une tuile d'écran retient ; la boucle du pixel est bornée par ce nombre (X2). */
  maxLightsPerTile: 32,
  /** Côté en pixels d'une tuile d'écran de la liste de lampes. */
  tileSize: 16,
  /**
   * Régions d'ombre au plus par image : le plafond des tampons, jamais un réglage de qualité. Le
   * budget en millisecondes s'arrête presque toujours avant ; ce plafond ne sert que d'ultime borne,
   * et de seule limite sur un appareil sans horloge carte graphique.
   */
  shadowUpdatesPerFrame: 4,
  /**
   * Côté d'une page de l'atlas d'ombres, en texels : la maille d'invalidation d'une face. Un objet
   * qui bouge ne périme que les pages que sa boîte projetée recouvre, jamais la face entière.
   */
  shadowPage: 128,
  /**
   * Budget de l'étape Ombres, en millisecondes de carte graphique par image (X4, RX3). Les pages
   * invalidées au-delà attendent leur tour ; elles ne sont jamais perdues, et leur retard est publié.
   */
  shadowBudgetMs: 1,
  /** Poids de l'attente dans la priorité d'une page, par image passée en file : contre la famine. */
  shadowAgingPerFrame: 0.05,
  /** Part du relevé d'une image dans le coût moyen d'une page : lissage exponentiel du chronomètre. */
  shadowCostBlend: 0.25,
  /** Côté de l'atlas d'ombres de profondeur, en texels. */
  shadowAtlasSize: 4096,
  /** Côté maximal d'une tranche d'ombre ; une face de ponctuelle en occupe un sixième d'aire. */
  shadowSliceMax: 1024,
  /** Côté minimal d'une tranche d'ombre : en dessous, la lampe garde sa tranche sans la raffiner. */
  shadowSliceMin: 128,
  /** Prises de PCF par pixel et par lampe à ombre (X2). */
  pcfTaps: 16,
  /** Largeur du bord adouci du cône d'un projecteur, en unités de cosinus : contre l'escalier. */
  spotEdgeSoftness: 0.02,
  /** Cascades d'une lampe directionnelle : au moins trois, jamais plus que les faces d'une tranche. */
  sunCascades: 4,
  /**
   * Part du tronc de la caméra que les cascades couvrent, du plan proche vers le lointain. Au-delà,
   * une surface reste éclairée sans ombre portée : approximation nommée, publiée dans le diagnostic.
   */
  sunShadowFarFraction: 0.2,
  /**
   * Rapport entre deux bornes consécutives de la découpe des cascades. À une couture, la densité de
   * texels change exactement de ce rapport : c'est lui, et rien d'autre, qui décide du saut de
   * netteté visible d'une cascade à la suivante, et le tenir constant est tout ce qu'on demande à
   * une découpe. Le plancher du plan proche s'en déduit — `distance d'ombre / rapport^cascades` —
   * au lieu de partir du plan proche de la caméra, un dix-millième du lointain, qui écrasait la
   * suite géométrique et obligeait à la rattraper par un mélange avec une suite uniforme.
   */
  sunCascadeRatioMax: 4,
  /**
   * Décalage de l'origine du rayon d'ombre lointain le long de la normale, en mètres. Il ne sert
   * qu'à quitter le plan de la surface éclairée ; le vrai remède contre l'auto-ombrage est le
   * départ le long du rayon, ci-dessous.
   */
  sunFarShadowOffsetMetres: 0.05,
  /**
   * Départ du rayon d'ombre lointain le long de sa propre direction, en mailles du proxy. Le point
   * éclairé vient de la géométrie fine, l'occulteur du proxy grossier : là où le proxy passe
   * au-dessus de la vraie surface, un rayon parti de zéro se cognerait à la surface qu'il éclaire.
   * Une maille du proxy est l'échelle en dessous de laquelle le proxy ne dit rien ; partir de là
   * saute ce faux contact sans inventer d'ombre. La conséquence est nommée : un occulteur à moins
   * d'une maille le long du rayon ne porte pas d'ombre lointaine, et celle-là reste aux cascades.
   */
  sunFarShadowStartCells: 1,
  /**
   * Recul du plan proche d'une cascade, en rayons de sa sphère : ce qui se tient au-dessus de la
   * cascade, entre elle et le soleil, doit entrer dans la carte pour y projeter son ombre.
   */
  sunCascadeDepthScale: 4,
  /**
   * Biais d'ombre en mètres, jamais en unités de profondeur : la profondeur projetée d'une tranche
   * est très non linéaire, une constante en profondeur normalisée vaudrait des mètres près de la
   * lampe et des millimètres au loin. Le shader ramène ces mètres en profondeur au point considéré.
   */
  shadowDepthBias: 0.02,
  /** Biais par pente, en mètres par unité de `tan(acos(N·L))`, plafonné par `shadowSlopeBiasMax`. */
  shadowSlopeBias: 0.08,
  shadowSlopeBiasMax: 0.5,
  /** Plan proche d'une tranche : une fraction de la portée, jamais moins que ce plancher. */
  shadowNearFraction: 1 / 200,
  shadowNearMin: 0.05,
  /**
   * Décalage du point de lecture le long de la normale, en texels de la tranche. C'est lui qui
   * referme la couture entre deux faces d'une ponctuelle et qui supprime l'acné rasante ; il est en
   * texels et non en mètres pour rester proportionnel à la résolution que la lampe a obtenue.
   */
  shadowNormalOffsetTexels: 1.5,
} as const;
/** Lampes qu'une tranche d'ombre peut adresser dans l'atlas : une par lampe à ombre déclarée. */
export const MAX_SHADOW_SLICES = LIGHT_SETTINGS.maxLights;
/** Faces d'une tranche : six pour une ponctuelle, une pour un projecteur, les cascades du soleil. */
export const POINT_FACES = 6;
/** Flottants d'une lampe dans le tampon GPU : quatre `vec4f`, jamais réalloués. */
export const SCENE_LIGHT_FLOATS = 16;
/** Entête du tampon de lampes : compte, tuiles en X, tuiles en Y, réserve. */
export const SCENE_LIGHT_HEADER_FLOATS = 4;
export const SCENE_LIGHT_BUFFER_FLOATS =
  SCENE_LIGHT_HEADER_FLOATS + LIGHT_SETTINGS.maxLights * SCENE_LIGHT_FLOATS;
/** Le rang d'un type de lampe dans le tampon GPU : le shader s'y réfère par ce nombre, pas par nom. */
export const LIGHT_KIND = { point: 0, spot: 1, directional: 2 } as const;
/**
 * L'axe d'une lampe qui en a un — projecteur ou directionnelle. Le contrat l'a déjà normalisé et
 * refuse une lampe de ce type sans direction : lire ce champ ici ne suppose rien de plus.
 */
export const lightDirection = (light: SceneLight) => light.direction as [number, number, number];
/** Ce que l'ordonnanceur sait de la vue : une caméra, pas une matrice, pour rester sans dépendance. */
export interface ShadowViewpoint {
  position: readonly [number, number, number];
  forward: readonly [number, number, number];
  halfFovY: number;
  aspect: number;
  near: number;
  far: number;
}
