// Ce que les preuves « moteur réel dans Chromium » partagent : empaqueter un module de page avec
// esbuild, l'exécuter dans une page locale avec un vrai appareil WebGPU, et rendre ce que la page a
// répondu, erreurs comprises.
import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dansPageWebgpu, empaquetePage } from '../justesse/pageWebgpu.mjs';

const ici = dirname(fileURLToPath(import.meta.url));

/**
 * Exécute `methode()` du module de page `fixture` dans Chromium — `executer` par défaut, le nom que
 * portent les pages du moteur. `nom` est le nom global sous lequel le paquet s'expose, `titre` celui
 * de la page. Rend le résultat de la page, son tableau `erreurs` complété par les erreurs non
 * rattrapées du document.
 */
export async function preuveDansLaPage(fixture, nom, titre, methode = 'executer') {
  const script = await empaquetePage(resolve(ici, fixture), nom);
  const erreursPage = [];
  const resultat = await dansPageWebgpu(
    (cible) => globalThis[cible.nom][cible.methode](),
    { nom, methode },
    {
      titre,
      script,
      erreursPage,
    },
  );
  return { ...resultat, erreurs: [...(resultat.erreurs ?? []), ...erreursPage] };
}

/** Les vérifications que toute preuve de ce genre doit passer avant d'examiner son propre relevé. */
export function preuveSaine(resultat) {
  assert.equal(resultat.indisponible ?? null, null, String(resultat.indisponible));
  assert.equal(resultat.erreur ?? null, null, String(resultat.erreur));
  assert.deepEqual(resultat.erreurs, []);
  assert.ok(
    !(resultat.evenements ?? []).some((evenement) =>
      /failed|uncaptured-error/.test(evenement.phase),
    ),
    JSON.stringify(resultat.evenements),
  );
}
