import { EngineError } from '../../../../sdk-core/src/index.ts'
import {
  PAGE_TASK_PROTOCOL,
  type PageTaskAnswer,
  type PageTaskDone,
  type PageTaskRequest,
} from '../../../../sdk-core/src/page/taskContracts.ts'

/** A task's success: `fields` over an answer that carries nothing else, `transfer` beside it. */
function done(
  request: PageTaskRequest,
  started: number,
  fields: Partial<PageTaskDone>,
  transfer: ArrayBuffer[],
) {
  const answer: PageTaskDone = {
    protocol: PAGE_TASK_PROTOCOL,
    id: request.id,
    ok: true,
    taskMs: performance.now() - started,
    ...fields,
  }
  return { answer, transfer }
}

/**
 * The work itself, written once. The worker runs it, and the synchronous fallback runs exactly
 * the same function on the main thread: that sharing — and not a re-read of both codes — is what
 * guarantees the same output byte on both sides of the thread.
 */
export async function runPageTask(
  request: PageTaskRequest,
): Promise<{ answer: PageTaskAnswer; transfer: ArrayBuffer[] }> {
  const started = performance.now()
  try {
    if (request.op === 'cut') {
      // Loaded on the first cut alone: a worker that only reads cells never loads the cutter.
      const cutter = await import('../../world/page/runtimeCut.ts')
      const { drawn, cones, blended, recut, held } = cutter.unpackDrawn(request.source)
      const cut = await cutter.cutDrawnTriangles(drawn, cones, blended, { recut, held })
      const transfer = cut.pages.flatMap((page) => [page.index, page.geometry])
      return done(request, started, { cut }, transfer)
    }
    if (request.op === 'cells') {
      const { decodeCellFile } = await import('../../partition/cellDecode.ts')
      const cells = decodeCellFile(request.source, request.name)
      return done(request, started, { cells }, [cells.ranks, cells.locals])
    }
    // `cellPage`.
    const { readCellPage } = await import('../../../../sdk-core/src/scene/core/tablePartition.ts')
    const cellPage = readCellPage(new Uint8Array(request.source), request.name ?? 'a scene page')
    return done(request, started, { cellPage }, [])
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      answer: {
        protocol: PAGE_TASK_PROTOCOL,
        id: request.id,
        ok: false,
        code: 'PAGE_TASK_FAILED',
        message,
        // A named refusal keeps its code across the thread (#575).
        ...(error instanceof EngineError ? { refusal: error.code } : {}),
      },
      transfer: [],
    }
  }
}
