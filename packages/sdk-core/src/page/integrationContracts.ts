/**
 * Contract of integrating an arrived page, off the main thread, version 1.
 *
 * Decode is already off-thread; this contract carries what comes AFTER: the integration plan
 * of a streaming pack. Nothing here touches the platform — no `Worker`, no clock, no DOM.
 * The browser adapter carries the transport; this file only carries the message shape.
 *
 * What the executor receives is a DESCRIPTION, never the page bytes: a request
 * sheet holds only integers already known from the catalogue (offset in the pack, triangles, page
 * rank), and the arrived pack length is enough for the rest. No cache buffer is therefore
 * copied or detached to be planned — the transfer question does not arise.
 */
export const PAGE_INTEGRATION_PROTOCOL = 1;

/** Integers per record in a request sheet. */
export const PAGE_SPEC_STRIDE = 3;
/** Byte offset of the record in the pack, or `-1` when the request carries only one page. */
export const SPEC_STREAM_OFFSET = 0;
/** Triangles of the record: three index words each. */
export const SPEC_TRIANGLES = 1;
/** Rank of the page in the table, or `-1` when it is not in it. */
export const SPEC_PAGE_INDEX = 2;

/** Integers per record in the returned plan. */
export const PAGE_SLICE_STRIDE = 3;
/** First word of the record in the pack. */
export const SLICE_OFFSET_WORDS = 0;
/** Index words of the record. */
export const SLICE_WORDS = 1;
/** Page rank, copied from the sheet: the main thread no longer looks it up. */
export const SLICE_PAGE_INDEX = 2;

export interface PageIntegrationRequest {
  protocol: number;
  id: number;
  /** Address of the arrived request: the key under which the executor keeps its sheet. */
  url: string;
  /** Length of the arrived pack, in index words. */
  words: number;
  /**
   * The request sheet, transferred on the first arrival of this address and `null` afterwards:
   * it depends only on the catalogue, which does not move, and the executor keeps it.
   */
  specs: ArrayBuffer | null;
}

export interface PageIntegrationDone {
  protocol: number;
  id: number;
  ok: true;
  url: string;
  /** `PAGE_SLICE_STRIDE` integers per record, in the sheet order. Transferred. */
  slices: ArrayBuffer;
  /** Records described by `slices`. */
  count: number;
  /** Distinct and increasing page ranks that the arrival moves. Transferred. */
  pages: ArrayBuffer;
  pageCount: number;
  /** Task time, measured by the executor itself. */
  taskMs: number;
}

/**
 * Closed list of rejections. `PAGE_INTEGRATION_UNKNOWN` answers an arrival whose executor has no
 * sheet — a lost message, or a restarted executor; `PAGE_INTEGRATION_WORKER` an executor that
 * vanished. Both allow the in-line fallback, which remakes the same plan on the main thread.
 */
export const PAGE_INTEGRATION_FAILURES = [
  'PAGE_INTEGRATION_UNKNOWN',
  'PAGE_INTEGRATION_WORKER',
] as const;
export type PageIntegrationFailureCode = (typeof PAGE_INTEGRATION_FAILURES)[number];

export interface PageIntegrationFailed {
  protocol: number;
  id: number;
  ok: false;
  url: string;
  code: PageIntegrationFailureCode;
  message: string;
}

export type PageIntegrationAnswer = PageIntegrationDone | PageIntegrationFailed;
