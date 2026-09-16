import type { ShadowFrameMetrics } from './shadowMetricsContracts.ts';
import type { OcclusionFrameMetrics } from './occlusionMetricsContracts.ts';
export type { ShadowFrameMetrics } from './shadowMetricsContracts.ts';
export type { OcclusionFrameMetrics } from './occlusionMetricsContracts.ts';

/** One timed GPU pass. `gpuMs` is null when the device returned no usable pair of timestamps. */
export interface GpuPassTiming {
  name: string;
  gpuMs: number | null;
  reason?: string;
}
/**
 * GPU durations of one image, pass by pass, as the device itself reported them. `totalMs` is the sum
 * of the listed passes and nothing else: it is never added to a `cpu*` field, and it is null as soon
 * as one pass is unmeasured or the list was truncated. `frame` names the image the sample describes,
 * which lags the current one because the readback never blocks an image.
 */
export interface GpuPassTimings {
  frame: number;
  totalMs: number | null;
  passes: GpuPassTiming[];
  truncated: boolean;
  error?: string;
}
/**
 * GPU duration of one image: the sum of its per-submission spans, each span being the earliest pass
 * beginning to the latest pass end of one command buffer, from the device's own timestamps. A
 * submission is one contiguous GPU execution, so passes the device runs concurrently are inside its
 * span once — unlike `gpuPassMs.totalMs`, a sum of passes, which counts an overlap twice. The host
 * time between two submissions of the same image is NOT in here; `gpuHostGapMs` carries it alone.
 * Null when a pass of the image went unmeasured, the list was truncated, or the device exposes no
 * timestamp query.
 */
export type GpuFrameMs = number | null;
export interface FrameMetrics extends ShadowFrameMetrics, OcclusionFrameMetrics {
  rafIntervalMs: number | null;
  cpuFrameMs: number;
  cpuSubmitMs: number | null;
  gpuMs: number | null;
  drawCalls: number;
  triangles: number;
  clusters: number | null;
  selectedTriangles: number | null;
  residentPages: number | null;
  /** Triangles soumis : sur le chemin WebGPU par pages, toutes les lignes dessinables — l'occultation
   *  rejette après la soumission —, tenues par la table, donc exact et de cette image-ci. */
  submittedTriangles?: number | null;
  /** All submitted triangles, including transparent passes. Null when a backend cannot count them. */
  totalSubmittedTriangles?: number | null;
  /** Clusters that left the drawn cut this session. A moving camera detaches clusters every frame;
   *  this is not a cache pressure signal. Null on a backend that does not track a cut. */
  pagesDetached?: number | null;
  /** Pages actually evicted from the cache that feeds the drawn geometry: the backend's own GPU page
   *  cache when it owns one, the host page streamer otherwise. This is the cache pressure signal. */
  cacheEvictions?: number | null;
  geometryAllocationBytes: number | null;
  vramBytes: number | null;
  pageLoads: number;
  pageBytesRead: number;
  pagesRequested?: number | null;
  pagesLoading?: number | null;
  cacheHits?: number | null;
  cacheMisses?: number | null;
  frustumRejected?: number | null;
  lodLevel?: number | null;
  /**
   * WebGPU transparent counters. `transparentDrawCalls` counts every draw, both halves of a two-pass
   * material included; `transparentSubmittedTriangles` counts the triangles of the transparent cut
   * once each, whatever the number of passes that rasterise them — the per-pass multiplication is
   * the GPU's own, since the instance counts are written by the compaction and never read back.
   * Null when unavailable.
   */
  transparentMeshes?: number | null;
  transparentFrustumRejected?: number | null;
  transparentDrawCalls?: number | null;
  transparentSubmittedTriangles?: number | null;
  /** Complete initial GPU fallback is available; null on backends without this guarantee. */
  coverageReady?: boolean | null;
  /** Requested detail cannot coexist with the pinned fallback within the GPU page budget. */
  coverageBudgetLimited?: boolean | null;
  /**
   * Vrai quand l'image a été tenue : ni la scène, ni la vue, ni les ressources n'ont bougé, aucun
   * travail asynchrone n'était en attente, et aucune étape processeur n'a été exécutée. Les pixels
   * affichés sont ceux de l'image d'origine, au bit près.
   *
   * Ce que l'image tenue a FAIT est publié comme tel, jamais recopié du dernier rendu complet :
   * `drawCalls`, `triangles`, `submittedTriangles` et `totalSubmittedTriangles` ne comptent que la
   * présentation, et les durées processeur et graphiques d'étape valent zéro quand l'étape n'a pas
   * tourné, `null` quand rien ne l'a chronométrée. Un moteur qui ne soumet pas lui-même son image —
   * l'hôte redessinant le graphe qu'il tient — compte en revanche les appels que cet hôte émet.
   *
   * Ce que l'image tenue MONTRE reste décrit par la coupe qu'elle réaffiche : `clusters`,
   * `selectedTriangles`, `frustumRejected`, `lodLevel` et `residentPages` sont ceux de l'image
   * d'origine, puisque c'est la même coupe.
   * Absent d'un moteur qui ne tient pas ses images.
   */
  frameHeld?: boolean | null;
  /** Sticky loading error; failed URLs require an explorer reload after three attempts. */
  streamingError?: string | null;
  /**
   * Le transfert découpé des textures source vers les atlas, compté par la pompe elle-même. Champs
   * facultatifs ajoutés après coup : un lecteur plus ancien les ignore, un moteur qui ne découpe pas
   * ses transferts les laisse absents, et `null` dit « non mesuré », jamais une estimation.
   *
   * `textureUploaded` : textures transférées en entier, dernière tranche comprise.
   * `texturePending` : textures encore en file, entamées ou intactes.
   * `textureInFlight` : textures dont une tranche au moins est passée et qui en attendent d'autres.
   * `textureSlicesUploaded` : tranches réellement transférées depuis le début de la session.
   * `textureBytesLastFrame` : octets admis par la dernière passe de la pompe. Le budget
   * `maxTextureTransferBytesPerFrame` le borne à une ligne de texture près : la ligne est l'unité
   * indivisible d'une tranche et la première ligne d'une image passe même si elle dépasse à elle
   * seule le budget, sans quoi une texture plus large que le budget n'avancerait jamais.
   * `textureSkipped` : niveaux sortis de la file après trois refus de transfert de l'appareil.
   * Une texture trop grosse pour le budget d'une image n'y est jamais comptée : elle est découpée.
   * `textureLevelsUploaded` : niveaux progressifs transférés en entier, ceux que le sidecar porte
   * entre l'aperçu le plus grossier et la pleine résolution.
   */
  textureUploaded?: number | null;
  texturePending?: number | null;
  textureInFlight?: number | null;
  textureSlicesUploaded?: number | null;
  textureBytesLastFrame?: number | null;
  textureSkipped?: number | null;
  textureLevelsUploaded?: number | null;
  /**
   * Les octets que les atlas de matériaux occupent en mémoire graphique, **calculés** depuis les
   * dimensions, le nombre de couches, la chaîne de mips et le format de chaque classe allouée — ce
   * ne sont pas des octets mesurés sur l'appareil, que WebGPU ne publie pas. `vramBytes` reste
   * `null` tant que rien ne le mesure vraiment.
   *
   * `textureAtlasBytesCalculated` : total des deux atlas. `textureAtlasClassBytesCalculated` : le
   * détail par classe, atlas couleur d'abord puis atlas de données. `textureAtlasClassesUsed` :
   * classes réellement peuplées, une seule valant l'allocation à la taille maximale.
   */
  textureAtlasBytesCalculated?: number | null;
  textureAtlasClassBytesCalculated?: number[] | null;
  textureAtlasClassesUsed?: number | null;
  /** Latest GPU pass sample of this backend; null when the device exposes no timestamp queries. */
  gpuPassMs?: GpuPassTimings | null;
  /** GPU duration of the image `gpuPassMs.frame` describes. Never added to a `cpu*` field. */
  gpuFrameMs?: GpuFrameMs;
  /** CPU time the same image spent between two of its own submissions, and zero when it submits once.
   *  It is host time, not GPU time, which is why `gpuFrameMs` excludes it. Null when unmeasured. */
  gpuHostGapMs?: number | null;
  /** Triangles of clusters the published cut names but the frame cannot draw — no resident page and no
   *  covering ancestor. A real hole in the image: zero is the only healthy value. Null when a backend
   *  cannot tell (it draws the cut it selected, so it never has one). */
  uncoveredTriangles?: number | null;
  /** Temps CPU de la coupe de clusters de cette image, mesuré autour de la sélection seule.
   *  Null sur un moteur qui ne choisit pas sa coupe sur le processeur. */
  cpuSelectMs?: number | null;
  /** Vrai quand le moteur avait une sélection GPU et l'a abandonnée : ce qui est mesuré depuis est la
   *  coupe processeur de secours. Un repli émet aussi le diagnostic `gpu-selection-fallback`, une
   *  fois ; l'hôte le recopie tel quel, et il est absent d'un moteur sans sélection GPU. */
  gpuSelectionFallback?: boolean;
  /** Nœuds de hiérarchie sur lesquels la coupe de cette image a posé un test — tronc de vision ou
   *  décision de niveau de détail. Un nœud déjà tranché et entièrement visible n'en reçoit aucun :
   *  il est traversé, pas testé. C'est la mesure du travail réel d'une coupe hiérarchique ; une
   *  coupe à plat en teste zéro et parcourt tous les clusters.
   *  Null sur un moteur qui ne choisit pas sa coupe sur le processeur, ou qui ne le compte pas. */
  cpuSelectNodesTested?: number | null;
  /**
   * Le décodage des pages hors du fil principal. `pagesDecodedOffThread` compte les tâches — contrôle
   * d'intégrité SHA-256 ou lecture des attributs par sommet — qu'un worker a menées à bien, jamais
   * celles que le repli a exécutées sur le fil principal. `pageDecodeMs` est le temps cumulé de ces
   * tâches, mesuré par l'exécutant lui-même, quel que soit le fil : c'est du temps de décodage, il
   * n'est jamais additionné à un `cpu*` ni à un `gpu*` par image. Les deux valent `null` tant
   * qu'aucune page n'a été décodée — non mesuré, et non pas zéro.
   */
  pagesDecodedOffThread?: number | null;
  /** Pages dont les attributs ont été lus par le décodeur compilé en WebAssembly plutôt que par le
   *  décodeur JavaScript. Les deux rendent les mêmes octets ; ce compteur dit seulement lequel a
   *  tourné, donc si la ressource `.wasm` a bien été trouvée et instanciée par cet hôte. */
  pagesDecodedWasm?: number | null;
  pageDecodeMs?: number | null;
}
export interface BackendCapabilities {
  renderer: string;
  materials: string;
  hierarchy: boolean;
  gpuDriven: boolean;
  simplification: boolean;
  eviction: boolean;
  unsupported: string[];
}
