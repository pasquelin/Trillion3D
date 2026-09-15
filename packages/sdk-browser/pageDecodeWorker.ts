import { PAGE_DECODE_PROTOCOL } from '../sdk-core/index.ts';
import { runPageDecodeTask } from './pageDecodeTask.ts';
import type { PageDecodeCancel, PageDecodeRequest } from '../sdk-core/index.ts';

/**
 * Point d'entrée du worker de décodage. Adaptateur de plateforme : ce fichier n'est chargé que dans
 * un `Worker` de module, et il ne contient aucune décision — il reçoit un message du contrat, appelle
 * la tâche partagée, et rend sa réponse avec les tampons transférés.
 *
 * La portée d'un worker dédié n'est pas typée par la bibliothèque DOM du dépôt ; la forme minimale
 * dont ce fichier a besoin est déclarée ici plutôt que d'ajouter une bibliothèque entière.
 */
type DecodeWorkerScope = {
  onmessage: ((event: { data: unknown }) => void) | null;
  postMessage(message: unknown, transfer: ArrayBuffer[]): void;
};

const scope = globalThis as unknown as DecodeWorkerScope;
/** Les requêtes annulées avant d'avoir commencé. Un décodage entamé n'a pas de point d'arrêt : il va
 *  à son terme, et c'est la réponse qui devient une annulation. */
const cancelled = new Set<number>();

scope.onmessage = async (event) => {
  const message = event.data as PageDecodeRequest | PageDecodeCancel;
  if (!message || message.protocol !== PAGE_DECODE_PROTOCOL) return;
  if (message.op === 'cancel') {
    cancelled.add(message.id);
    return;
  }
  const request = message as PageDecodeRequest;
  if (cancelled.delete(request.id)) {
    scope.postMessage(
      {
        protocol: PAGE_DECODE_PROTOCOL,
        id: request.id,
        ok: false,
        code: 'PAGE_DECODE_CANCELLED',
        message: 'PAGE_DECODE_CANCELLED',
      },
      [],
    );
    return;
  }
  const { answer, transfer } = await runPageDecodeTask(request);
  cancelled.delete(request.id);
  scope.postMessage(answer, transfer);
};
