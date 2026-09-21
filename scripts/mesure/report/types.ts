// Shared shapes of the harness measurement: what `serie.ts` builds, `banc.ts` assembles into
// `mesure.json`, and everything under `scripts/mesure/` (`rapport.ts`, `rapportCalcul.ts`,
// `rapportMemoire.ts`, `rapportTextures.ts`, `report/`) reads back. One record type here, typed
// once from the engine contracts, rather than cast at every reader.
import type { CameraPose, FrameMetrics, StageProfile } from '../../../packages/sdk-core/index.ts';
import type { MemoryBudgetsReport } from '../../../packages/sdk-browser/index.ts';
import type { Distribution, PassesGpu } from '../rapportPasses.ts';
import type { BenchSettings } from '../options.ts';
import type { Bounds } from '../poses.ts';
import type { LightsPlan } from '../lampes.ts';

/** What `banc.ts` builds before playing series, and `serie.ts` reads to run one. */
export interface RunContext {
  MANIFEST: string | null;
  OUT: string;
  settings: BenchSettings;
  lights: LightsPlan | null;
  poses: CameraPose[] | null;
  bounds?: Bounds;
}

/** The selected cut of a series, read inside the page (`pageCoupe.ts`). */
export interface Coupe {
  source: string | null;
  ids: string[];
}

/** Contract occlusion counters, under their own names; `image` names the frame they describe. */
export interface HiZCounters {
  tested: number | null;
  rejected: number | null;
  beyond16Texels: number | null;
  testedTriangles: number | null;
  rejectedTriangles: number | null;
  beyond16TexelsTriangles: number | null;
  image: number | null;
}

/** The page budget as the last frame saw it (`serieReservoirs.ts`). */
export interface BudgetPages {
  demande: number | null;
  residentes: number | null;
  couvertureLimiteeParBudget: boolean | null;
  seuilBudget: number | null;
}

/** The geometry pool as the engine held it (`serieReservoirs.ts`). */
export interface PoolGeometrie {
  octets: number | null;
  fentes: number | null;
  alloues: number | null;
  borne: string | null;
  saturees: number | null;
}

/** In-session reservoir tuning report, plus the frames it took the pose to hold again. */
export type ReglageVivant = MemoryBudgetsReport & { imagesReprise: number | null };

/** Bytes transferred on the network since a reading, by file kind. */
export type Reseau = Record<string, number>;

/** A moving node's own report: what it moved, or why it could not. */
export type MovingNode =
  { noeud: string; rayon: number; images: number } | { noeud: string; erreur: string } | null;

/** One reported page error: an uncaught page error, an HTTP failure, or a console error. */
export type ErreurPage =
  | { kind: 'pageerror'; message: string }
  | { kind: 'http'; status: number; url: string }
  | { kind: 'console'; message: string }
  | { kind: 'cut-analysis'; message: string };

/** A generic-rule light placement summary (`lampes.ts`), for `mesure.json` and `resume.md`. */
export interface LightsSummary {
  nombre: number;
  ponctuelles: number;
  soleil: boolean;
  ombres: boolean;
  maille: number;
  intensite: number;
  portee: number;
  mobile: boolean;
}

/** Delta between two RGBA captures (`rapport.ts::imageDiff`). */
export type ImageDiff =
  null | { erreur: string } | { pixels: number; maxCanal: number; total: number };

/** One row of the series table: one side, one view, one threshold (`serie.ts::runSerie`). */
export interface Row {
  cpuFrameMs: Distribution;
  cpuSelectMs: Distribution;
  moteur: string;
  gpuFrameMs: Distribution;
  imageSyncMs: Distribution;
  rafIntervalMs: Distribution;
  profilParEtape: StageProfile | null;
  passesGpu: PassesGpu | null;
  preparationMs: number | null;
  imagesCalme: number | null;
  reglageVivant: ReglageVivant | null;
  reseau: Reseau | null;
  variante: string | null;
  erreur: string;
  selectedTriangles: number | null;
  uncoveredTriangles: number | null;
  drawnTriangles: number | null;
  submittedTriangles: number | null;
  totalSubmittedTriangles: number | null;
  imageDuReleve: number | null;
  imageTenue: boolean | null;
  repliSelectionGpu: boolean | null;
  hiZ: HiZCounters;
  selection: { source: Coupe['source']; sha256: string | null; taille: number };
  geometrieOctets: number | null;
  budgetPages: BudgetPages;
  poolGeometrie: PoolGeometrie;
  cheminCalcul: FrameMetrics['mathBatch'] | null;
  lampes: LightsSummary | null;
  lampesFichier: { nombre: number; ids: string[] } | null;
  lampesTemoin: unknown;
  atlasOmbres: unknown;
  objetMobile: MovingNode;
  charge: { debut: number[]; fin: number[] };
  png: string | null;
  captureStatus: number;
  incidentsGpu: string[] | null;
  avertissementsDag: unknown;
  bornesCpu: unknown;
  canvas: { width: number; height: number; dpr?: number };
  metrics: Partial<FrameMetrics> & Record<string, unknown>;
  cutAnalysis?: unknown;
}

/** One series: one view, one threshold, every side's row. */
export interface Serie {
  view: string;
  pixelError: number;
  segment: string;
  index: number;
  pose: CameraPose;
  sides: Record<string, Row>;
  temoinAA?: ImageDiff;
  ecartAvantApres?: ImageDiff;
  coupeIdentique?: boolean | null;
}

/** What a side publishes about itself in the report: dist, cache, engine, variant. */
export interface SideIdentity {
  dist: string;
  from: string;
  cache: string | null;
  moteur: string;
  variante: string | null;
  erreur: string;
  assetKey?: string;
  buildHash?: string;
}

/** The whole harness report: `mesure.json`, built by `banc.ts` and read by `rapport.ts`. */
export interface Report {
  startedAt: string;
  provenance: { machine: unknown; browser: unknown; displayCapHz: number | null };
  campaignIdentity: string | null;
  commande: string;
  head: string;
  scene: string;
  engine: string;
  pathVersion: number;
  settings: BenchSettings & { port?: number };
  flags: string[];
  ressources: string | null;
  sides: Record<string, SideIdentity>;
  series: Serie[];
  errors: ErreurPage[];
  bounds?: Bounds;
  lampes?: LightsSummary | null;
  finishedAt?: string;
}
