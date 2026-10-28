// Diagnostic, removable: who moves a revision of the frame gate (`frame/revisions.ts`: scene, view, resources — what `hold.same` compares), and on which image.
// `traceRevisions` replaces the three counters of the runtime's `run.gate.revisions` by accessors as the runtime is made, and keeps each write's image, the
// revision it moved and the two lines of its callers, the engine's own revision bumps left out. Only the images from the third are kept.
import type { WebgpuPagesRuntime } from '../../../packages/sdk-browser/src/frame/backend/runtime.ts'

/** A write of a revision: the image it was made on, the revision, and its callers, the nearest first. */
type RevisionCall = { frame: number; revision: string; callers: string[] }

const calls = new WeakMap<object, RevisionCall[]>()
const FIRST_FRAME = 3
/** The stack lines that are the revision's own bump, which name no origin. */
const OWN = /\/frame\/(revisions|gate\/gateCore|gate\/gateState)\.ts/

/** The place of a stack line in the engine's sources: `fn (file:line)`, the path before `src/` dropped. */
const placeOf = (line: string) =>
  line
    .trim()
    .replace(/^at /, '')
    .replace(/\(?file:\/\/[^)]*?\/src\//, '(')

/** `onWrite`, when given, hears every write of a revision, whatever its image: the reading of what else moved with it. */
export function traceRevisions(
  run: WebgpuPagesRuntime['run'],
  onWrite?: (revision: string) => void,
) {
  const made: RevisionCall[] = []
  calls.set(run, made)
  const { revisions } = run.gate
  for (const revision of ['scene', 'view', 'resources'] as const) {
    let value = revisions[revision]
    Object.defineProperty(revisions, revision, {
      configurable: true,
      enumerable: true,
      get: () => value,
      set: (next: number) => {
        value = next
        onWrite?.(revision)
        if (run.frame < FIRST_FRAME) return
        // Line 0 is the error, line 1 this accessor: the callers follow, the revision's own bump left out.
        const stack = (new Error().stack ?? '')
          .split('\n')
          .slice(2)
          .filter((line) => !OWN.test(line))
        made.push({ frame: run.frame, revision, callers: stack.slice(0, 2).map(placeOf) })
      },
    })
  }
}

/** The writes of the runtime's revisions since `traceRevisions`, `last` of them. */
export const revisionCalls = (run: WebgpuPagesRuntime['run'], last = 24) =>
  (calls.get(run) ?? []).slice(-last)
