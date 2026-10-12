// Measurement base paths, written once: repo root, fragment directory deposited by benchmarks,
// baseline directory, the output folder of a batch, and rule mapping domain to filename.
import { join } from 'node:path'
import { REPOSITORY_ROOT } from '../../scripts/repository-files.ts'

export const FRAGMENTS = join(REPOSITORY_ROOT, '.mesure', 'perf')
export const BASELINES = join(REPOSITORY_ROOT, '.mesure', 'baselines')

/** Moves `measureOutput`'s root: the proof import test points its children at its own scratch. */
const MEASURE_OUT = 'TRILLION3D_MEASURE_OUT'

/** Where a bench, cook or browser proof writes: `.measure/out/<batch>/…`, off git (AGENTS.md). */
export const measureOutput = (...parts: string[]) =>
  join(process.env[MEASURE_OUT] ?? join(REPOSITORY_ROOT, '.mesure', 'out'), ...parts)

/** Sanitizes a domain name for use as a filename. */
const assainir = (domaine: string) => domaine.replace(/[/\\]/g, '-').replace(/^-+|-+$/g, '')

export const fragmentPath = (domaine: string) => join(FRAGMENTS, `${assainir(domaine)}.json`)
export const baselinePath = (domaine: string) => join(BASELINES, `${assainir(domaine)}.json`)
