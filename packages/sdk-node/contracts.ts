import type {
  AssetScope,
  DagWarning,
  JobSnapshot,
  PreparationProgress,
} from '../sdk-core/index.ts';

/** One JSON event from the native compiler's stderr. */
export interface CompilerEvent {
  event: string;
  job: string;
  ratio?: number;
  phase?: string;
  status?: string;
  code?: string;
  message?: string;
  file?: string;
  step?: string;
  completed?: number;
  total?: number;
  bytes?: number;
  primitives?: number;
  removedKeys?: number;
  removedBytes?: number;
  jobs?: number;
  pointer?: ProgressPointer;
  mesh?: number;
  primitive?: number;
  /** DAG warnings of a primitive, carried by its `primitive` event. */
  warnings?: DagWarning[];
  [key: string]: unknown;
}

export interface ProgressPointer {
  selectedTriangles?: number;
  primitives?: number;
  metrics?: { wallMs?: number };
}

export interface ProgressStream {
  isTTY?: boolean;
  columns?: number;
  write(text: string): unknown;
}

export interface TerminalProgress {
  event(event: CompilerEvent): void;
  note(text: string): void;
  fail(message: string): void;
}

export interface TerminalProgressOptions {
  label?: string;
  index?: number;
  total?: number;
  stream?: ProgressStream;
  width?: number;
  interval?: number;
}

/** What the cluster DAG may hold above the exact clusters: nothing (`none`), coarse levels whose
 *  collapses are ranked on the geometry alone (`qem-endpoints`), or on the attributes as well
 *  (`qem-attributes`). Both draw source vertices. */
export const SIMPLIFICATIONS = ['none', 'qem-endpoints', 'qem-attributes'] as const;
export type Simplification = (typeof SIMPLIFICATIONS)[number];
export function isSimplification(value: string): value is Simplification {
  return (SIMPLIFICATIONS as readonly string[]).includes(value);
}

export interface PrepareOptions {
  resourceBaseUrl: string;
  executable?: string;
  threads?: number;
  ramBudgetMb?: number;
  simplification?: Simplification;
  signal?: AbortSignal;
  onProgress?: (event: CompilerEvent & Partial<PreparationProgress>) => void;
}

export interface CompilationSummary {
  status: 'ready';
  key: string;
  scope: AssetScope;
  url: string;
  pointer: string;
  cache: string;
  compilerVersion: string;
  selectedTriangles: number;
  sourceTriangles?: number | null;
  totalNodes?: number | null;
  simplification?: boolean;
  unsupported?: unknown;
}

/** What a job proved before keeping an existing folder instead of writing it (`null` when it compiled; `clusterHierarchyPagesMs` is then `null` too). */
export interface ReusedFolder {
  files: number;
  fileBytes: number;
  objects: number;
  objectBytes: number;
  textureLevels: number;
  validateMs: number;
}

export interface CompilationPointer extends CompilationSummary {
  formatVersion: number;
  selectedNodes: number;
  primitives: number;
  metrics: {
    importMs: number;
    clusterHierarchyPagesMs: number | null;
    wallMs: number;
    pruneMs: number;
    outputGeometryBytes: number;
    threads: number;
    ramBudgetMb: number;
  };
  reused: ReusedFolder | null;
}

export interface CompilationResult extends CompilationSummary {
  schema: number;
  formatVersion?: number;
  selectedNodes: number[];
  primitives: unknown[];
  reused?: ReusedFolder | null;
  [key: string]: unknown;
}

export interface BatchJob {
  id?: string;
  source: string;
  cache: string;
  resourceBaseUrl: string;
  scope?: AssetScope;
  triangles?: number;
  threads?: number;
  ramBudgetMb?: number;
  simplification?: Simplification;
}

export interface BatchOptions {
  workers?: number;
  ramBudgetMb?: number;
  threads?: number;
  executable?: string;
  signal?: AbortSignal;
  onEvent?: (event: CompilerEvent) => void;
}

export interface BatchOutcome {
  job: string;
  status: 'ready' | 'error';
  pointer?: CompilationPointer;
  code?: string;
  message?: string;
}

export interface BatchSummary {
  status: 'ready' | 'partial' | 'failed';
  completed: number;
  failed: number;
  cancelled: number;
  jobs: BatchOutcome[];
}

export interface CompilationJob {
  promise: Promise<CompilationResult>;
  cancel(reason?: unknown): void;
  getSnapshot(): JobSnapshot<CompilationResult>;
  subscribe(listener: () => void): () => void;
}

export interface CompilationJobOptions extends PrepareOptions {
  scope?: AssetScope;
  triangleBudget?: number;
  telemetry?: (snapshot: JobSnapshot<CompilationResult>) => void;
}
