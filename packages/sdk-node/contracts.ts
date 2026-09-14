import type { AssetScope, JobSnapshot, PreparationProgress } from '../sdk-core/index.ts';

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

export interface PrepareOptions {
  resourceBaseUrl: string;
  executable?: string;
  threads?: number;
  ramBudgetMb?: number;
  simplification?: 'none' | 'qem-endpoints';
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

export interface CompilationPointer extends CompilationSummary {
  formatVersion: number;
  selectedNodes: number;
  primitives: number;
  metrics: {
    importMs: number;
    clusterHierarchyPagesMs: number;
    wallMs: number;
    outputGeometryBytes: number;
    threads: number;
    ramBudgetMb: number;
  };
}

export interface CompilationResult extends CompilationSummary {
  schema: number;
  formatVersion?: number;
  selectedNodes: number[];
  primitives: unknown[];
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
  simplification?: 'none' | 'qem-endpoints';
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
