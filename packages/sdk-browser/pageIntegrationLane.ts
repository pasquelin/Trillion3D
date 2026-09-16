import { PAGE_INTEGRATION_PROTOCOL } from '../sdk-core/index.ts';
import type { PageIntegrationAnswer, PageIntegrationRequest } from '../sdk-core/index.ts';

const workerError = (id: number, url: string): PageIntegrationAnswer => ({
  protocol: PAGE_INTEGRATION_PROTOCOL,
  id,
  ok: false,
  url,
  code: 'PAGE_INTEGRATION_WORKER',
  message: 'PAGE_INTEGRATION_WORKER',
});

/**
 * Un seul worker, une seule file, l'ordre d'envoi rendu intact. Adaptateur navigateur : c'est le
 * seul fichier de l'intégration qui construit un `Worker`.
 *
 * Un seul fil, et non un pool : l'ordre d'intégration EST la priorité de l'image, et deux fils
 * rendraient leurs plans dans l'ordre de leur charge. Le travail planifié ici est de l'arithmétique
 * d'entiers sur quelques centaines d'enregistrements ; c'est le fil principal qu'il s'agit de
 * libérer, pas un cœur de plus qu'il s'agit d'occuper.
 *
 * `start` est la porte du démarrage : une requête d'épreuve part la première, et un démarrage qui
 * échoue — pas de `Worker`, module introuvable — laisse l'appelant à son repli en ligne. Après le
 * démarrage, la disparition du worker casse la file : les travaux en vol répondent
 * `PAGE_INTEGRATION_WORKER`, et tout ce qui suit repart en ligne.
 */
export function createPageIntegrationLane() {
  const pending = new Map<number, (answer: PageIntegrationAnswer) => void>();
  let worker: Worker | undefined,
    alive = true,
    nextId = 1;
  // Le module du worker porte l'extension du module qui le lance : `.ts` dans un arbre de sources
  // servi tel quel, `.js` dans un `dist/` construit.
  const source = new URL(
    import.meta.url.endsWith('.ts') ? './pageIntegrationWorker.ts' : './pageIntegrationWorker.js',
    import.meta.url,
  );
  const breakLane = () => {
    if (!alive) return;
    alive = false;
    const lost = [...pending.entries()];
    pending.clear();
    worker?.terminate();
    worker = undefined;
    for (const [id, settle] of lost) settle(workerError(id, ''));
  };
  const spawn = () => {
    const spawned = new Worker(source, { type: 'module' });
    spawned.onmessage = (event: MessageEvent) => {
      const answer = event.data as PageIntegrationAnswer;
      const settle = pending.get(answer.id);
      pending.delete(answer.id);
      settle?.(answer);
    };
    spawned.onerror = breakLane;
    spawned.onmessageerror = breakLane;
    return spawned;
  };

  const submit = (url: string, words: number, specs: ArrayBuffer | null) => {
    const request: PageIntegrationRequest = {
      protocol: PAGE_INTEGRATION_PROTOCOL,
      id: nextId++,
      url,
      words,
      specs,
    };
    if (!alive || !worker) return Promise.resolve(workerError(request.id, url));
    return new Promise<PageIntegrationAnswer>((resolve) => {
      pending.set(request.id, resolve);
      try {
        worker!.postMessage(request, specs ? [specs] : []);
      } catch {
        breakLane();
      }
    });
  };

  let ready: Promise<boolean> | undefined;
  return {
    get alive() {
      return alive;
    },
    /** Vraie une fois que le worker a répondu à l'épreuve de démarrage ; fausse et file close sinon. */
    start() {
      ready ??= (async () => {
        if (typeof Worker === 'undefined') {
          breakLane();
          return false;
        }
        try {
          worker = spawn();
          const answer = await submit('', 0, new Int32Array(0).buffer as ArrayBuffer);
          if (!answer.ok) breakLane();
          return answer.ok;
        } catch {
          breakLane();
          return false;
        }
      })();
      return ready;
    },
    submit,
    retire: breakLane,
  };
}
