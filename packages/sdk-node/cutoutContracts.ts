/**
 * The cutout review's own contracts: what it reads of an already compiled model, how it asks its
 * question, and what it reports. Apart from `contracts.ts`, which is the compilation contract:
 * the review neither compiles nor submits a job.
 */
import type { AssetScope } from '../sdk-core/index.ts';
import type { ProgressStream } from './contracts.ts';

/**
 * A model already compiled, as the cutout review reads it: where its product lives, where its
 * scene came from — the review shows the texture's own file when there is one — and the scope its
 * pointer names. Not a `BatchJob`: that one is what gets SUBMITTED to the compiler, and the review
 * neither submits nor needs a triangle budget to ask a question.
 */
export interface CutoutModel {
  id?: string;
  cache: string;
  source: string;
  scope?: AssetScope;
}

export interface CutoutReviewOptions {
  stream?: ProgressStream;
  input?: NodeJS.ReadStream;
  /** Defaults to whether the stream is a terminal. */
  interactive?: boolean;
}

/**
 * What the pass did. `changed` names the models an answer moved: compiling them again is the
 * caller's to do, with its own budget, its own progress and its own cancellation — the review has
 * none of those and has no business guessing them.
 */
export interface CutoutReviewSummary {
  pending: number;
  answered: number;
  changed: CutoutModel[];
}
