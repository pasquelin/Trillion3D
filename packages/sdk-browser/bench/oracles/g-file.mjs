// Oracles des points G5 et G6, recopiés tels quels avant le lot G.

/**
 * `streamingQueue.ts` : une demande encore en file, dont le dernier consommateur se retire, était
 * retrouvée par un balayage de la file entière, puis retirée par un décalage du tableau.
 */
export function referenceRetireDeLaFile(queue, job) {
  const at = queue.indexOf(job);
  if (at >= 0) queue.splice(at, 1);
}

/**
 * `explorerDraw.ts` : les adresses manquantes étaient empilées dans un tableau dont l'appartenance
 * se testait par `includes`, donc par un balayage complet pour chaque adresse ajoutée.
 */
export function referenceEmpileEnAttente(attente, urls) {
  for (const url of urls) if (!attente.includes(url)) attente.push(url);
}
