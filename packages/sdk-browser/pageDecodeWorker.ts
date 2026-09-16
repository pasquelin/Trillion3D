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
 * Point d'entrée du worker de décodage. Adaptateur de plateforme : ce fichier n'est chargé que dans
 * un `Worker` de module, et il ne contient aucune décision — il reçoit un message du contrat, appelle
 * la tâche partagée, et rend sa réponse.
 *
 * Deux chemins pour les octets, un seul travail. Avec un bail de mémoire partagée, une page décodée
 * est écrite dans la région du créneau du worker — sa région, dont il est le seul écrivain — et rien
 * ne voyage par message. Sans bail, ou quand la page n'entre pas dans la région, ou pour tout refus
 * et toute annulation, la réponse part par message avec ses tampons transférés, comme avant. Le
 * créneau passe à `ready` dans les deux cas : l'attente du fil principal ne reste jamais suspendue.
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
let arena: PageArena | undefined,
  slot = 0;

/** La réponse par message, doublée de la publication du créneau quand un bail est en cours : le fil
 *  principal attend l'état, qu'il lise la région ou le message. */
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
  // Seule une page décodée passe par la région : `verify` doit rendre sa source, qui n'y est pas.
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
