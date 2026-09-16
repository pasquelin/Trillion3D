import { PAGE_DECODE_PROTOCOL } from '../sdk-core/index.ts';
import {
  ID,
  SHARED_BY_REGION,
  SHARED_READY,
  STATUS,
  awaitSharedPage,
  beginSharedPage,
  freeSharedPage,
  loseSharedPage,
  sharedField,
} from './pageDecodeShared.ts';
import { readSharedPage } from './pageDecodeSharedPage.ts';
import type { PageArena } from './pageDecodeShared.ts';
import type { PageDecodeAnswer, PageDecodeRequest } from '../sdk-core/index.ts';

type Waiting = {
  request: PageDecodeRequest;
  transfer: ArrayBuffer[];
  settle: (answer: PageDecodeAnswer) => void;
};
const workerError = (id: number): PageDecodeAnswer => ({
  protocol: PAGE_DECODE_PROTOCOL,
  id,
  ok: false,
  code: 'PAGE_DECODE_WORKER',
  message: 'PAGE_DECODE_WORKER',
});

/**
 * Un pool borné de workers de module, un travail à la fois par worker, le reste en file. Adaptateur
 * navigateur : c'est le seul fichier qui construit un `Worker`.
 *
 * `ready` est la porte du démarrage : le premier worker reçoit une requête d'épreuve, et tant que sa
 * réponse n'est pas revenue, aucun tampon réel n'est transféré. Un démarrage qui échoue — pas de
 * `Worker`, module introuvable, `crypto` absent — laisse donc l'appelant avec ses octets intacts et
 * son repli synchrone. Après le démarrage, la disparition d'un worker casse le pool : les travaux en
 * vol répondent `PAGE_DECODE_WORKER`, et tout ce qui suit repart sur le repli.
 *
 * Avec une arène, chaque worker reçoit à sa naissance un créneau et la région qui lui correspond, et
 * les pages décodées reviennent par là plutôt que par message. Le créneau porte l'indice du worker :
 * un worker, une région, un seul écrivain. Sans arène, rien ne change.
 */
export function createPageDecodePool(size: number, arena?: PageArena) {
  const idle: Worker[] = [],
    all: Worker[] = [],
    queue: Waiting[] = [];
  const pending = new Map<number, Waiting>(),
    owner = new Map<number, Worker>();
  let nextId = 1,
    alive = true,
    retired = false;
  // Le module du worker porte l'extension du module qui le lance : `.ts` dans un arbre de sources
  // servi tel quel, `.js` dans un `dist/` construit. Une chaîne fixe viserait toujours le mauvais
  // fichier d'un des deux côtés, et un worker introuvable renverrait tout au repli sans le dire.
  const source = new URL(
    import.meta.url.endsWith('.ts') ? './pageDecodeWorker.ts' : './pageDecodeWorker.js',
    import.meta.url,
  );
  const spawn = () => {
    const worker = new Worker(source, { type: 'module' });
    worker.onmessage = (event: MessageEvent) => receive(worker, event.data as PageDecodeAnswer);
    worker.onerror = () => breakPool();
    worker.onmessageerror = () => breakPool();
    all.push(worker);
    if (arena)
      worker.postMessage(
        {
          protocol: PAGE_DECODE_PROTOCOL,
          id: 0,
          op: 'share',
          buffer: arena.buffer,
          slot: all.length - 1,
          slots: arena.slots,
        },
        [],
      );
    return worker;
  };
  const receive = (worker: Worker, answer: PageDecodeAnswer) => {
    const waiting = pending.get(answer.id);
    pending.delete(answer.id);
    owner.delete(answer.id);
    if (!retired) idle.push(worker);
    waiting?.settle(answer);
    if (!retired) pump();
    else if (pending.size) worker.terminate();
    else breakPool();
  };
  /** La page publiée dans le créneau, ou rien quand le worker l'a perdue ou répondue par message.
   *  Le créneau redevient libre dans tous les cas : une mort en plein décodage ne le confisque pas. */
  const collect = async (worker: Worker, shared: PageArena, slot: number, id: number) => {
    const state = await awaitSharedPage(shared, slot);
    const served =
      state === SHARED_READY &&
      sharedField(shared, slot, STATUS) === SHARED_BY_REGION &&
      sharedField(shared, slot, ID) === id;
    const answer = served ? readSharedPage(shared, slot) : undefined;
    freeSharedPage(shared, slot);
    if (answer && alive) receive(worker, answer);
  };
  const breakPool = () => {
    if (!alive) return;
    alive = false;
    if (arena) for (let slot = 0; slot < arena.slots; slot++) loseSharedPage(arena, slot);
    const lost = [...pending.values(), ...queue.splice(0)];
    pending.clear();
    owner.clear();
    idle.length = 0;
    for (const worker of all.splice(0)) worker.terminate();
    for (const waiting of lost) waiting.settle(workerError(waiting.request.id));
  };
  const pump = () => {
    while (alive && queue.length && (idle.length || all.length < size)) {
      const waiting = queue.shift()!;
      const worker = idle.pop() ?? spawn();
      pending.set(waiting.request.id, waiting);
      owner.set(waiting.request.id, worker);
      const slot = arena && waiting.request.op === 'decode' ? all.indexOf(worker) : -1;
      if (arena && slot >= 0) beginSharedPage(arena, slot, waiting.request.id);
      try {
        worker.postMessage(waiting.request, waiting.transfer);
      } catch {
        breakPool();
        return;
      }
      if (arena && slot >= 0) void collect(worker, arena, slot, waiting.request.id);
    }
  };
  const submit = (op: PageDecodeRequest['op'], source: ArrayBuffer, maxDecodedBytes: number) => {
    const request: PageDecodeRequest = {
      protocol: PAGE_DECODE_PROTOCOL,
      id: nextId++,
      op,
      source,
      maxDecodedBytes,
    };
    if (!alive || retired)
      return { id: request.id, answer: Promise.resolve(workerError(request.id)) };
    const answer = new Promise<PageDecodeAnswer>((resolve) => {
      queue.push({ request, transfer: [source], settle: resolve });
      pump();
    });
    return { id: request.id, answer };
  };
  let ready: Promise<boolean> | undefined;
  return {
    get alive() {
      return alive;
    },
    get workers() {
      return size;
    },
    /** Vraie une fois qu'un worker a répondu à l'épreuve de démarrage ; fausse et pool clos sinon. */
    start() {
      ready ??= (async () => {
        try {
          const answer = await submit('verify', new ArrayBuffer(8), 0).answer;
          if (!answer.ok) breakPool();
          return answer.ok;
        } catch {
          breakPool();
          return false;
        }
      })();
      return ready;
    },
    submit,
    /** Demande l'abandon d'une requête encore en file. Sans effet sur un décodage déjà commencé. */
    cancel(id: number) {
      const worker = owner.get(id);
      if (!alive || !worker) return;
      try {
        worker.postMessage({ protocol: PAGE_DECODE_PROTOCOL, id, op: 'cancel' }, []);
      } catch {
        breakPool();
      }
    },
    /** Ferme le pool sans couper un travail en vol : les workers oisifs s'arrêtent tout de suite. */
    retire() {
      retired = true;
      for (const worker of idle.splice(0)) worker.terminate();
      if (!pending.size) breakPool();
    },
  };
}
export type PageDecodePool = ReturnType<typeof createPageDecodePool>;
