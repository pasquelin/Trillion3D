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
 */
export type SceneLightingView = 'auto' | 'lit' | 'unlit';
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
  /** Lampes à ombre remises à jour par image, les plus prioritaires (X5). */
  shadowUpdatesPerFrame: 4,
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
  /** Mélange des découpes logarithmique et uniforme des cascades : 1 tout log, 0 tout uniforme. */
  sunCascadeLambda: 0.8,
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
