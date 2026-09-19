import { PAGE_DECODE_PROTOCOL } from '../sdk-core/index.ts';
import { runPageDecodeTask } from './pageDecodeTask.ts';
import { SHARED_READY, STATE, attachPageArena, slotField } from './pageDecodeShared.ts';
import { writeSharedPage } from './pageDecodeSharedPage.ts';
import type { PageArena } from './pageDecodeShared.ts';
import type {
  PageDecodeAnswer,
  PageDecodeCancel,
  PageDecodeRequest,
  PageDecodeShare,
} from '../sdk-core/index.ts';

/**
 * Entry point of the decode worker. Platform adapter: this file is loaded only in a module
 * `Worker`, and it contains no decision — it receives a contract message, calls the shared
 * task, and returns its answer.
 *
 * Two paths for the bytes, one job. With a shared-memory lease, a decoded page is written in
 * the worker slot's region — its region, of which it is the only writer — and nothing travels
 * by message. Without a lease, or when the page does not fit in the region, or for any refuse
 * and any cancel, the answer leaves by message with its buffers transferred, as before. The
 * slot goes to `ready` in both cases: the main thread's wait never stays suspended.
 *
 * A dedicated worker's scope is not typed by the repository's DOM library; the minimal shape
 * this file needs is declared here rather than adding a whole library.
 */
type DecodeWorkerScope = {
  onmessage: ((event: { data: unknown }) => void) | null;
  postMessage(message: unknown, transfer: ArrayBuffer[]): void;
};

const scope = globalThis as unknown as DecodeWorkerScope;
/** Requests cancelled before they started. A decode already begun has no stop point: it goes
 *  to its end, and it is the answer that becomes a cancel. */
const cancelled = new Set<number>();
let arena: PageArena | undefined,
  slot = 0;

/** Answer by message, doubled by publishing the slot when a lease is in flight: the main
 *  thread waits for the state, whether it reads the region or the message. */
function reply(answer: PageDecodeAnswer, transfer: ArrayBuffer[], shared: boolean) {
  scope.postMessage(answer, transfer);
  if (!shared || !arena) return;
  Atomics.store(arena.control, slotField(slot, STATE), SHARED_READY);
  Atomics.notify(arena.control, slotField(slot, STATE));
}

scope.onmessage = async (event) => {
  const message = event.data as PageDecodeRequest | PageDecodeCancel | PageDecodeShare;
  if (!message || message.protocol !== PAGE_DECODE_PROTOCOL) return;
  if (message.op === 'share') {
    arena = attachPageArena(message.buffer, message.slots);
    slot = message.slot;
    return;
  }
  if (message.op === 'cancel') {
    cancelled.add(message.id);
    return;
  }
  const request = message as PageDecodeRequest;
  // Only a decoded page goes through the region: `verify` must return its source, which is not there.
  const shared = !!arena && request.op === 'decode';
  if (cancelled.delete(request.id)) {
    reply(
      {
        protocol: PAGE_DECODE_PROTOCOL,
        id: request.id,
        ok: false,
        code: 'PAGE_DECODE_CANCELLED',
        message: 'PAGE_DECODE_CANCELLED',
      },
      [],
      shared,
    );
    return;
  }
  const { answer, transfer } = await runPageDecodeTask(request);
  cancelled.delete(request.id);
  if (shared && answer.ok && writeSharedPage(arena!, slot, answer)) return;
  reply(answer, transfer, shared);
};
