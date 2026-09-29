import {
  EngineError,
  PAGE_DECODE_PROTOCOL,
  pageDecodeFailureCode,
} from '../../../../sdk-core/src/index.ts';
import type { DecodedGeometryPage } from './geometryPage.ts';
import { pageViews } from './geometryPageBlock.ts';
import { sha256Hex } from '../../measurement/sha256Hex.ts';
import type {
  PageDecodeAnswer,
  PageDecodeDone,
  PageDecodeGeometryPayload,
  PageDecodeRequest,
} from '../../../../sdk-core/src/index.ts';

/**
 * The page decoder, chosen once and kept. First the module compiled to WebAssembly: it names no
 * dependency, so a dedicated worker loads it even at a host that serves its modules as-is,
 * without an import map or a bundler. If it does not instantiate — no `WebAssembly`, no SIMD,
 * missing resource — the JavaScript decoder takes its place, and if that one cannot load either,
 * the task says so and the caller does the work again on its side.
 *
 * Both yield the same buffers and the same refusals: the H2b bench proves it value by value.
 */
type Decodeur = {
  decode: (data: Uint8Array, maxDecodedBytes: number) => Promise<DecodedGeometryPage>;
  wasm: boolean;
};
let decodeur: Promise<Decodeur> | undefined;

async function chargeDecodeur(): Promise<Decodeur> {
  const codec = await import('./geometryPageWasm.ts');
  if (await codec.prepareSdkWasm()) return { decode: codec.decodeGeometryPageWasm, wasm: true };
  const js = await import('./geometryPage.ts');
  return { decode: async (data, max) => js.decodeGeometryPage(data, max), wasm: false };
}

/** No decoder on this side of the thread: the caller will redo the work on its side, rejecting nothing. */
function indisponible(id: number, cause: unknown) {
  return {
    answer: {
      protocol: PAGE_DECODE_PROTOCOL,
      id,
      ok: false as const,
      code: 'PAGE_DECODE_UNAVAILABLE' as const,
      message: cause instanceof Error ? cause.message : String(cause),
    },
    transfer: [] as ArrayBuffer[],
  };
}

/** A task's success: `fields` over an answer that carries nothing else, `transfer` beside it. */
function done(
  request: PageDecodeRequest,
  started: number,
  fields: Partial<PageDecodeDone>,
  transfer: ArrayBuffer[],
) {
  const answer: PageDecodeDone = {
    protocol: PAGE_DECODE_PROTOCOL,
    id: request.id,
    ok: true,
    sha256: null,
    source: null,
    decoded: null,
    wasm: false,
    taskMs: performance.now() - started,
    ...fields,
  };
  return { answer, transfer };
}

/**
 * The work itself, written once. The worker runs it, and the synchronous fallback runs exactly
 * the same function on the main thread: that sharing — and not a re-read of both codes — is what
 * guarantees the same output byte on both sides of the thread.
 */
export async function runPageDecodeTask(
  request: PageDecodeRequest,
): Promise<{ answer: PageDecodeAnswer; transfer: ArrayBuffer[] }> {
  const started = performance.now();
  try {
    if (request.op === 'cut') {
      // Loaded on the first cut alone: a worker that only decodes never reads the encoder.
      const cutter = await import('../../world/page/runtimeCut.ts');
      const { drawn, cones, blended, recut } = cutter.unpackDrawn(request.source);
      const cut = await cutter.cutDrawnTriangles(drawn, cones, blended, recut);
      const transfer = cut.pages.flatMap((page) => [page.index, page.geometry]);
      return done(request, started, { cut }, transfer);
    }
    if (request.op === 'cells') {
      const { decodeCellFile } = await import('../../scene/partition/cellDecode.ts');
      const cells = decodeCellFile(request.source, request.name);
      return done(request, started, { cells }, [cells.ranks, cells.locals]);
    }
    if (request.op === 'cellPage') {
      const { readCellPage } =
        await import('../../../../sdk-core/src/scene/core/tablePartition.ts');
      const cellPage = readCellPage(new Uint8Array(request.source), request.name ?? 'a scene page');
      return done(request, started, { cellPage }, []);
    }
    if (request.op === 'verify') {
      const sha256 = await sha256Hex(request.source);
      return done(request, started, { sha256, source: request.source }, [request.source]);
    }
    let choisi: Decodeur;
    try {
      choisi = await (decodeur ??= chargeDecodeur());
    } catch (cause) {
      decodeur = undefined;
      return indisponible(request.id, cause);
    }
    const decoded = await choisi.decode(new Uint8Array(request.source), request.maxDecodedBytes);
    const payload = geometryPayload(decoded);
    return done(request, started, { decoded: payload, wasm: choisi.wasm }, [payload.block]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      answer: {
        protocol: PAGE_DECODE_PROTOCOL,
        id: request.id,
        ok: false,
        code: pageDecodeFailureCode(message),
        message,
        // A named refusal keeps its code across the thread (#575).
        ...(error instanceof EngineError ? { refusal: error.code } : {}),
      },
      transfer: [],
    };
  }
}

/**
 * The decoded page, ready to be transferred: its indices and attributes are views on one block
 * that owns its buffer whole, so `block` is exactly the page, and the transfer loses nothing
 * and copies nothing.
 */
function geometryPayload(page: DecodedGeometryPage): PageDecodeGeometryPayload {
  return {
    block: page.indices.buffer,
    names: Object.keys(page.attributes),
    vertexCount: page.vertexCount,
    morphTargets: page.morphTargets,
    flags: page.flags,
    decodedBytes: page.decodedBytes,
    quantizationError: page.quantizationError,
  };
}

/** The decoded page rebuilt on its block. `names` yields the decode's write order, so the
 *  attribute `Record` finds its fields in the same order as an in-place decode. */
export function restorePageDecode(payload: PageDecodeGeometryPayload): DecodedGeometryPage {
  return {
    ...pageViews(payload.block, payload.names, payload.vertexCount, payload.morphTargets),
    vertexCount: payload.vertexCount,
    morphTargets: payload.morphTargets,
    flags: payload.flags,
    decodedBytes: payload.decodedBytes,
    quantizationError: payload.quantizationError,
  };
}
