import type {
  AssetScope,
  DagWarning,
  JobSnapshot,
  PreparationProgress,
} from '../../../sdk-core/src/index.ts';

/** One JSON event from the native compiler's stderr. */
export interface CompilerEvent {
  /** What happened: `progress`, `phase`, `done`… */ event: string;
  /** The job the event belongs to. */ job: string;
  /** Share of the work done, 0 to 1. */ ratio?: number;
  /** The step the compiler is in. */ phase?: string;
  /** How the job ended. */ status?: string;
  /** An error's stable name. */ code?: string;
  /** Words for a person to read. */ message?: string;
  /** The file the event is about. */ file?: string;
  /** The sub-step inside the phase. */ step?: string;
  /** Units of work done. */ completed?: number;
  /** Units of work in all. */ total?: number;
  /** Bytes written or read. */ bytes?: number;
  /** Primitives handled. */ primitives?: number;
  /** Cache entries the prune removed. */ removedKeys?: number;
  /** Bytes the prune freed. */ removedBytes?: number;
  /** Jobs in the batch. */ jobs?: number;
  /** The finished pointer, on the last event. */ pointer?: ProgressPointer;
  /** The mesh the event is about. */ mesh?: number;
  /** The primitive the event is about. */ primitive?: number;
  /** DAG warnings of a primitive, carried by its `primitive` event. */
  warnings?: DagWarning[];
  [key: string]: unknown;
}

/** What a finished job's pointer says, as progress shows it. */ export interface ProgressPointer {
  /** Triangles kept. */ selectedTriangles?: number;
  /** Primitives compiled. */ primitives?: number;
  /** How long it took. */ metrics?: { wallMs?: number };
}

/** Where progress is written. */ export interface ProgressStream {
  /** Whether it is a live terminal. */ isTTY?: boolean;
  /** Terminal width, in characters. */ columns?: number;
  /** Writes text out. */ write(text: string): unknown;
}

/** A terminal progress display. */ export interface TerminalProgress {
  /** Shows one event. */ event(event: CompilerEvent): void;
  /** Prints a note. */ note(text: string): void;
  /** Prints a failure. */ fail(message: string): void;
}

/** How a terminal progress display looks. */ export interface TerminalProgressOptions {
  /** The job's name. */ label?: string;
  /** The job's number. */ index?: number;
  /** How many jobs in all. */ total?: number;
  /** Where to write. */ stream?: ProgressStream;
  /** Bar width. */ width?: number;
  /** Least milliseconds between redraws. */ interval?: number;
}

/** How `prepare` compiles a model. */ export interface PrepareOptions {
  /** The address the model's files load from. */ resourceBaseUrl: string;
  /** The compiler program to run. */ executable?: string;
  /** Threads the compiler may use. @defaultValue 2 */ threads?: number;
  /** Memory the compiler may use, in MB. @defaultValue 256 */ ramBudgetMb?: number;
  /** How meshes are simplified. @defaultValue 'none' */ simplification?: 'none' | 'qem-endpoints';
  /** Stops the job when aborted. */ signal?: AbortSignal;
  /** Called on each event. */
  onProgress?: (event: CompilerEvent & Partial<PreparationProgress>) => void;
}

/** What a finished compilation reports. */ export interface CompilationSummary {
  /** Always `'ready'`. */ status: 'ready';
  /** The cache key. */ key: string;
  /** Full or streamed. */ scope: AssetScope;
  /** Where a page loads it. */ url: string;
  /** The pointer file. */ pointer: string;
  /** The cache folder. */ cache: string;
  /** The compiler's version. */ compilerVersion: string;
  /** Triangles kept. */ selectedTriangles: number;
  /** Triangles in the source. */ sourceTriangles?: number | null;
  /** Nodes in the hierarchy. */ totalNodes?: number | null;
  /** Whether meshes were simplified. */ simplification?: boolean;
  /** What the compiler could not do. */ unsupported?: unknown;
}

/** What a job proved before keeping an existing folder instead of writing it (`null` when it compiled; `clusterHierarchyPagesMs` is then `null` too). */
export interface ReusedFolder {
  /** Files checked. */ files: number;
  /** Bytes of those files. */ fileBytes: number;
  /** Cache objects checked. */ objects: number;
  /** Bytes of those objects. */ objectBytes: number;
  /** Texture levels checked. */ textureLevels: number;
  /** Time the check took. */ validateMs: number;
}

/** The pointer file of a compiled model. */
export interface CompilationPointer extends CompilationSummary {
  /** The cache format. */ formatVersion: number;
  /** Nodes kept. */ selectedNodes: number;
  /** Primitives kept. */ primitives: number;
  /** Time and size. */ metrics: {
    importMs: number;
    clusterHierarchyPagesMs: number | null;
    wallMs: number;
    pruneMs: number;
    outputGeometryBytes: number;
    threads: number;
    ramBudgetMb: number;
  };
  /** What was reused. */ reused: ReusedFolder | null;
}

/** What `prepare` returns. */ export interface CompilationResult extends CompilationSummary {
  /** Result format. */ schema: number;
  /** Cache format. */ formatVersion?: number;
  /** Nodes kept. */ selectedNodes: number[];
  /** Primitives. */ primitives: unknown[];
  /** Reuse proof. */ reused?: ReusedFolder | null;
  [key: string]: unknown;
}

/** One model in a batch. */ export interface BatchJob {
  /** Its name. */ id?: string;
  /** The source file. */ source: string;
  /** The cache folder. */ cache: string;
  /** Resource address. */ resourceBaseUrl: string;
  /** Full or streamed. */ scope?: AssetScope;
  /** Triangle budget. */ triangles?: number;
  /** Threads. */ threads?: number;
  /** Memory, in MB. */ ramBudgetMb?: number;
  /** Simplification. */ simplification?: 'none' | 'qem-endpoints';
}

/** How a batch runs. */ export interface BatchOptions {
  /** Jobs at once. */ workers?: number;
  /** Memory for all jobs, in MB. */ ramBudgetMb?: number;
  /** Threads per job. */ threads?: number;
  /** The compiler program. */ executable?: string;
  /** Stops the batch when aborted. */ signal?: AbortSignal;
  /** Called on each event. */ onEvent?: (event: CompilerEvent) => void;
}

/** How one batch job ended. */ export interface BatchOutcome {
  /** The job's name. */ job: string;
  /** Done or failed. */ status: 'ready' | 'error';
  /** The pointer, when done. */ pointer?: CompilationPointer;
  /** The error's name. */ code?: string;
  /** The error's words. */ message?: string;
}

/** How a whole batch ended. */ export interface BatchSummary {
  /** All, some or none done. */ status: 'ready' | 'partial' | 'failed';
  /** Jobs done. */ completed: number;
  /** Jobs failed. */ failed: number;
  /** Jobs cancelled. */ cancelled: number;
  /** Each job's outcome. */ jobs: BatchOutcome[];
}

/** A compilation running. */ export interface CompilationJob {
  /** Settles when done. */ promise: Promise<CompilationResult>;
  /** Stops it. */ cancel(reason?: unknown): void;
  /** Its state now. */ getSnapshot(): JobSnapshot<CompilationResult>;
  /** Hears each change. */ subscribe(listener: () => void): () => void;
}

/** How a compilation job runs. */ export interface CompilationJobOptions extends PrepareOptions {
  /** Full or streamed. */ scope?: AssetScope;
  /** Triangle budget. */ triangleBudget?: number;
  /** Hears each state. */ telemetry?: (snapshot: JobSnapshot<CompilationResult>) => void;
}

/** A model already compiled, as the cutout review reads it: its product, its source, its scope.
 *  Not a `BatchJob`: the review submits nothing and needs no triangle budget to ask a question. */
export interface CutoutModel {
  /** Its name. */ id?: string;
  /** The cache folder. */ cache: string;
  /** The source file. */ source: string;
  /** Full or streamed. */ scope?: AssetScope;
}

/** How the cut-out review asks. */ export interface CutoutReviewOptions {
  /** Where to write. */ stream?: ProgressStream;
  /** Where answers come from. */ input?: NodeJS.ReadStream;
  /** Defaults to whether the stream is a terminal. */
  interactive?: boolean;
}

/**
 * What the pass did. `changed` names the models an answer moved: compiling them again is the
 * caller's to do, with its own budget, its own progress and its own cancellation — the review has
 * none of those and has no business guessing them.
 */
export interface CutoutReviewSummary {
  /** Questions left. */ pending: number;
  /** Questions answered. */ answered: number;
  /** Models to compile again. */ changed: CutoutModel[];
}
