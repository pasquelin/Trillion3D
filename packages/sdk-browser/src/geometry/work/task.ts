import { cpuNow, msSince } from '../../diagnostic/stopwatch.ts'
import { rayTracingTreeOf, soupIndices } from '../../../../sdk-core/src/lighting/rayTracingTree.ts'
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
  // Rays meet the triangles of a mesh as they stand at rest: the faces of one that does not deform.
  const tree =
    faces && !drawn.deformation ? rayTracingTreeOf(drawn.positions, drawn.indices) : undefined
  if (tree) cut.rayTracing = tree
  const transfer = cut.pages.flatMap((page) => [page.index, page.geometry])
  if (tree) transfer.push(tree.nodes.buffer as ArrayBuffer, tree.triangles.buffer as ArrayBuffer)
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

/** The triangles a field task carries, nine floats each, and the indices naming their corners in turn. */
function fieldTriangles(request: PageTaskRequest) {
  const positions = new Float32Array(request.source)
  return { positions, indices: soupIndices(positions) }
}

/** The first CPU half of the distance field of the triangles `request` carries (`prepareDistanceField`). */
async function runFieldPlan(request: PageTaskRequest, started: number) {
  const { prepareDistanceField } =
    await import('../../../../sdk-core/src/lighting/distanceFieldBuild.ts')
  const { positions, indices } = fieldTriangles(request)
  const fieldPlan = prepareDistanceField(positions, indices, request.field) ?? null
  return done(request, started, { fieldPlan }, fieldPlan ? [fieldPlan.words.buffer] : [])
}

/** The second half (`finishDistanceField`), the voxels the device measured and the ones it was in doubt of being in `request.field`. */
async function runFieldFinish(request: PageTaskRequest, started: number) {
  const { finishDistanceField } =
    await import('../../../../sdk-core/src/lighting/distanceFieldBuild.ts')
  const { doubtfulOf } = await import('../../../../sdk-core/src/lighting/distanceFieldGpu.ts')
  const { positions, indices } = fieldTriangles(request)
  const { mesh, voxels, doubtfulAt, doubtfulSettled } = request.field!
  const measured = {
    voxels: new Uint8Array(voxels!),
    doubtful: doubtfulOf(new Uint32Array(doubtfulAt!), new Float64Array(doubtfulSettled!)),
  }
  const distanceField =
    finishDistanceField(mesh!, positions, indices, measured, request.field) ?? null
  const transfer =
    distanceField?.mips.flatMap((mip) => [mip.indirection.buffer, mip.bricks.buffer]) ?? []
  return done(request, started, { distanceField }, transfer as ArrayBuffer[])
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
    if (request.op === 'fieldPlan') return await runFieldPlan(request, started)
    if (request.op === 'fieldFinish') return await runFieldFinish(request, started)
    return await runCellPage(request, started)
  } catch (error) {
    return failed(request, error)
  }
}
