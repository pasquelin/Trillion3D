import { PAGE_INTEGRATION_PROTOCOL } from '../sdk-core/index.ts';
import { createPageIntegrationRunner } from './pageIntegrationTask.ts';
import type { PageIntegrationRequest } from '../sdk-core/index.ts';

/**
 * Point d'entrée du worker d'intégration des pages. Adaptateur de plateforme : ce fichier n'est
 * chargé que dans un `Worker` de module, il ne prend aucune décision, et il ne voit jamais les
 * octets d'une page — seulement la fiche de sa requête et la longueur du paquet arrivé.
 *
 * La portée d'un worker dédié n'est pas typée par la bibliothèque DOM du dépôt ; la forme minimale
 * dont ce fichier a besoin est déclarée ici plutôt que d'ajouter une bibliothèque entière.
 */
type IntegrationWorkerScope = {
  onmessage: ((event: { data: unknown }) => void) | null;
  postMessage(message: unknown, transfer: ArrayBuffer[]): void;
};

const scope = globalThis as unknown as IntegrationWorkerScope;
const runner = createPageIntegrationRunner();

scope.onmessage = (event) => {
  const request = event.data as PageIntegrationRequest;
  if (!request || request.protocol !== PAGE_INTEGRATION_PROTOCOL) return;
  const answer = runner.run(request);
  scope.postMessage(answer, runner.transferOf(answer));
};
