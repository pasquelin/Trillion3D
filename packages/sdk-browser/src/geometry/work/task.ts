import { cpuNow, msSince } from '../../diagnostic/stopwatch.ts'
import { EngineError } from '../../../../sdk-core/src/contracts/cache.ts'
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
    taskMs: msSince(started),
    ...fields,
  }
  return { answer, transfer }
}

type Block = NonNullable<PageTaskRequest['blocks']>

/** The texels of one level of blocks, in the kind a float pool asks. */
async function decodeBlocks(source: Uint8Array, blocks: Block) {
  const { decodeBcLevel } = await import('../../materials/texture/blockDecode.ts')
  const { width, height, twoChannel, codec, single, to } = blocks
  const more = () => import('../../materials/texture/blockDecodeMore.ts')
  const floats = () => import('../../materials/texture/floatTexels.ts')
  if (codec === 'rgba32f' || codec === 'r32f' || codec === 'r16f')
    return (await floats()).decodeFloatLevel(source, width, height, codec, to!)
  const texels =
    codec === 'bc4'
      ? (await more()).decodeBc4Level(source, width, height, single)
      : codec === 'g8' || codec === 'a8'
        ? (await more()).decodeRawLevel(source, width, height, codec, single)
        : codec === 'bc6h'
          ? (await more()).decodeBc6hLevel(source, width, height)
          : decodeBcLevel(source, width, height, twoChannel)
  // The texels the codec gave, in the kind a float pool asks.
  const own = codec === 'bc6h' ? 'rgba16' : single ? 'r8' : 'rgba8'
  return to && to !== own ? (await floats()).convertTexels(texels, own, to) : texels
}

/** The cut of the drawn triangles `request` carries. */
async function runCut(request: PageTaskRequest, started: number) {
  // Loaded on the first cut alone: a worker that only reads cells never loads the cutter.
  const cutting = import('../runtime/runtimeCut.ts')
  const { unpackDrawn } = await import('../runtime/runtimePack.ts')
  const { cutDrawnTriangles } = await cutting
  const { drawn, faces, blended } = unpackDrawn(request.source)
  const cut = await cutDrawnTriangles(drawn, faces, blended)
  const transfer = cut.pages.flatMap((page) => [page.index, page.geometry])
  return done(request, started, { cut }, transfer)
}

/** The cell file `request` carries, decoded. */
async function runCells(request: PageTaskRequest, started: number) {
  const { decodeCellFile, CELL_COLUMNS } = await import('../partition/cellDecode.ts')
  const cells = decodeCellFile(request.source, request.name)
  return done(
    request,
    started,
    { cells },
    CELL_COLUMNS.map((name) => cells[name]),
  )
}

/** The level of blocks `request` carries, decoded to texels. */
async function runBlocks(request: PageTaskRequest, started: number) {
  const texels = await decodeBlocks(new Uint8Array(request.source), request.blocks!)
  const buffer = texels.buffer as ArrayBuffer
  return done(request, started, { texels: buffer }, [buffer])
}

/** The page of the cell index `request` carries, read. */
async function runCellPage(request: PageTaskRequest, started: number) {
  const { readCellPage } = await import('../../../../sdk-core/src/scene/core/tablePartition.ts')
  const cellPage = readCellPage(new Uint8Array(request.source), request.name ?? 'a scene page')
  return done(request, started, { cellPage }, [])
}

/** A task's failure: its message, and the code of a named refusal. */
function failed(
  request: PageTaskRequest,
  error: unknown,
): { answer: PageTaskAnswer; transfer: ArrayBuffer[] } {
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

/**
 * The work itself, written once. The worker runs it, and the synchronous fallback runs exactly
 * the same function on the main thread: that sharing — and not a re-read of both codes — is what
 * guarantees the same output byte on both sides of the thread.
 */
export async function runPageTask(
  request: PageTaskRequest,
): Promise<{ answer: PageTaskAnswer; transfer: ArrayBuffer[] }> {
  const started = cpuNow()
  try {
    if (request.op === 'cut') return await runCut(request, started)
    if (request.op === 'cells') return await runCells(request, started)
    if (request.op === 'blocks') return await runBlocks(request, started)
    return await runCellPage(request, started)
  } catch (error) {
    return failed(request, error)
  }
}
