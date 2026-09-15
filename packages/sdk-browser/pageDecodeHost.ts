import { PAGE_DECODE_PROTOCOL, pageDecodeWorkerCount } from '../sdk-core/index.ts';
import { createPageDecodePool, type PageDecodePool } from './pageDecodePool.ts';
import { restorePageDecode, runPageDecodeTask } from './pageDecodeTask.ts';
import type { DecodedGeometryPage } from './geometryPage.ts';
import type { PageDecodeAnswer, PageDecodeOp } from '../sdk-core/index.ts';

/** Le plafond d'octets décodés d'une page, identique à celui du chemin synchrone d'origine. */
const MAX_DECODED_BYTES = 16 * 1024 * 1024;
const counters = { tasks: 0, offThread: 0, decodeMs: 0 };
let admissionLimit = 1,
  pool: PageDecodePool | undefined;
/** `undefined` tant que l'épreuve de démarrage n'a pas répondu, puis son verdict. */
let started: boolean | undefined;

/** Borne le pool sur l'admission déjà en vigueur pour les transferts de pages. À appeler avant le
 *  premier décodage ; un appel plus tard ne redimensionne pas un pool déjà ouvert. */
export function configurePageDecoders(limit: number) {
  admissionLimit = limit;
}

/**
 * Le pool si son épreuve de démarrage a déjà réussi, `undefined` sinon. L'épreuve est lancée mais
 * **jamais attendue** : tant qu'elle n'a pas répondu, et pour toujours si elle ne répond pas, le
 * décodage reste sur le fil principal. Une page ne dépend donc jamais du démarrage d'un worker, et
 * aucun tampon réel n'est transféré avant qu'un worker ait prouvé qu'il vit — un démarrage raté
 * (plateforme sans `Worker`, module introuvable, dépendance que l'hôte ne sait pas résoudre) laisse
 * à l'appelant ses octets intacts.
 */
function openPool() {
  if (started === false) return undefined;
  if (!pool) {
    if (typeof Worker === 'undefined') {
      started = false;
      return undefined;
    }
    const cores = (globalThis.navigator as { hardwareConcurrency?: number } | undefined)
      ?.hardwareConcurrency;
    pool = createPageDecodePool(pageDecodeWorkerCount(cores, admissionLimit));
    void pool.start().then((ok) => {
      started = ok;
      if (!ok) pool = undefined;
    });
  }
  // Un pool cassé après son démarrage ne revient pas : ses workers sont partis, et relancer l'épreuve
  // à chaque page transformerait une panne en boucle. Le repli reprend la main pour de bon.
  if (started && !pool.alive) started = false;
  return started ? pool : undefined;
}

function count(answer: PageDecodeAnswer, offThread: boolean) {
  counters.tasks++;
  if (offThread) counters.offThread++;
  if (answer.ok) counters.decodeMs += answer.taskMs;
  return answer;
}
function refuse(answer: PageDecodeAnswer): never {
  throw new Error(answer.ok ? 'PAGE_DECODE_FAILED' : answer.message);
}
/** Le tampon d'une vue, sans copie quand la vue le couvre en entier — ce que fait toute page du
 *  cache — et une copie sinon : la tâche lit un `ArrayBuffer`, jamais un reste de tampon partagé. */
function ownBuffer(bytes: Uint8Array) {
  return (
    bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
      ? bytes.buffer
      : bytes.slice().buffer
  ) as ArrayBuffer;
}
/** Le repli : la tâche du contrat, la même fonction, exécutée sur le fil principal. */
async function onThread(op: PageDecodeOp, source: ArrayBuffer) {
  const { answer } = await runPageDecodeTask({
    protocol: PAGE_DECODE_PROTOCOL,
    id: 0,
    op,
    source,
    maxDecodedBytes: MAX_DECODED_BYTES,
  });
  return count(answer, false);
}

/**
 * L'empreinte SHA-256 d'une page fraîchement lue. **L'appelant cède son tampon** : le worker le
 * reçoit transféré, donc sans copie, et le rend transféré lui aussi. C'est le tampon rendu — celui de
 * la valeur de retour — qu'il faut lire ensuite ; la référence d'origine est détachée.
 */
export async function verifyPageBytes(source: ArrayBuffer) {
  const open = openPool();
  const answer = open
    ? count(await open.submit('verify', source, 0).answer, true)
    : await onThread('verify', source);
  if (!answer.ok || !answer.source || answer.sha256 === null) refuse(answer);
  return { sha256: answer.sha256, source: answer.source };
}

/**
 * Les indices et les attributs d'une page de géométrie, décodés hors du fil principal quand la
 * plateforme le permet, et par la même fonction sur le fil principal sinon.
 *
 * Le worker reçoit une copie des octets compressés, et non le tampon du cache : détacher une entrée
 * du cache de pages fausserait sa comptabilité d'octets, que l'éviction lit sur le fil principal
 * pendant l'aller-retour. La copie porte la page compressée ; ce qui revient — les tampons décodés,
 * bien plus gros — est transféré sans copie.
 */
export async function decodePageOffThread(
  bytes: Uint8Array,
  signal?: AbortSignal,
): Promise<DecodedGeometryPage> {
  const open = openPool();
  let answer: PageDecodeAnswer;
  if (open) {
    const task = open.submit('decode', bytes.slice().buffer as ArrayBuffer, MAX_DECODED_BYTES);
    const cancel = () => open.cancel(task.id);
    signal?.addEventListener('abort', cancel, { once: true });
    try {
      answer = await task.answer;
    } finally {
      signal?.removeEventListener('abort', cancel);
    }
    // Un worker disparu ne perd rien : les octets compressés sont restés chez l'appelant.
    if (!answer.ok && answer.code === 'PAGE_DECODE_WORKER')
      answer = await onThread('decode', ownBuffer(bytes));
    else count(answer, true);
  } else answer = await onThread('decode', ownBuffer(bytes));
  signal?.throwIfAborted();
  if (!answer.ok || !answer.decoded) refuse(answer);
  return restorePageDecode(answer.decoded);
}

/** Pages décodées hors fil, temps cumulé des décodages, taille du pool. `null` quand rien n'a été
 *  décodé : une métrique non mesurée n'est pas un zéro. */
export function pageDecodeStats() {
  if (!counters.tasks) return { offThread: null, decodeMs: null, workers: null };
  return {
    offThread: counters.offThread,
    decodeMs: counters.decodeMs,
    workers: pool?.alive ? pool.workers : 0,
  };
}

/** Ferme le pool sans couper un décodage en vol et remet les compteurs à leur état non mesuré. */
export function releasePageDecoders() {
  pool?.retire();
  pool = undefined;
  started = undefined;
  counters.tasks = 0;
  counters.offThread = 0;
  counters.decodeMs = 0;
}
