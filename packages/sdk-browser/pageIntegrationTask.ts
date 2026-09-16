import {
  createPageIntegrationPlan,
  PAGE_INTEGRATION_PROTOCOL,
  PAGE_SLICE_STRIDE,
  PAGE_SPEC_STRIDE,
  planPageIntegration,
} from '../sdk-core/index.ts';
import type {
  PageIntegrationAnswer,
  PageIntegrationPlan,
  PageIntegrationRequest,
} from '../sdk-core/index.ts';

/**
 * La tâche du contrat d'intégration, une seule fois pour les deux transports : le worker l'exécute
 * sur son fil, le repli l'exécute sur le fil principal, et tous deux rendent la même réponse.
 *
 * L'exécutant retient la fiche de chaque adresse : elle ne dépend que du catalogue, donc la
 * deuxième arrivée d'une même requête n'a plus qu'un entier à envoyer. Une arrivée dont la fiche
 * manque est refusée plutôt que devinée — l'appelant repasse alors en ligne, avec la sienne.
 */
export function createPageIntegrationRunner() {
  const specsByUrl = new Map<string, Int32Array>();
  /** Un seul plan, réutilisé : la réponse en recopie les tampons à sa taille pour les transférer. */
  let plan: PageIntegrationPlan | undefined;

  const run = (request: PageIntegrationRequest): PageIntegrationAnswer => {
    const started = performance.now();
    if (request.specs) specsByUrl.set(request.url, new Int32Array(request.specs));
    const specs = specsByUrl.get(request.url);
    if (!specs)
      return {
        protocol: PAGE_INTEGRATION_PROTOCOL,
        id: request.id,
        ok: false,
        url: request.url,
        code: 'PAGE_INTEGRATION_UNKNOWN',
        message: 'PAGE_INTEGRATION_UNKNOWN',
      };
    const records = (specs.length / PAGE_SPEC_STRIDE) | 0;
    if (!plan || plan.pages.length < records) plan = createPageIntegrationPlan(records);
    planPageIntegration(specs, request.words, plan);
    const slices = plan.slices.slice(0, plan.count * PAGE_SLICE_STRIDE),
      pages = plan.pages.slice(0, plan.pageCount);
    return {
      protocol: PAGE_INTEGRATION_PROTOCOL,
      id: request.id,
      ok: true,
      url: request.url,
      slices: slices.buffer as ArrayBuffer,
      count: plan.count,
      pages: pages.buffer as ArrayBuffer,
      pageCount: plan.pageCount,
      taskMs: performance.now() - started,
    };
  };

  /** Les tampons qu'une réponse cède à son destinataire, dans l'ordre où le message les porte. */
  const transferOf = (answer: PageIntegrationAnswer) =>
    answer.ok ? [answer.slices, answer.pages] : [];

  return { run, transferOf };
}
