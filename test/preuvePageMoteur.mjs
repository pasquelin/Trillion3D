// Ce que les preuves « moteur réel dans Chromium » partagent : empaqueter un module de page avec
// esbuild — celui de Vite, pris dans `render-tech-lab` en lecture seule —, l'exécuter dans une page
// locale avec un vrai appareil WebGPU, et rendre ce que la page a répondu, erreurs comprises.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  dansPageWebgpu,
  requireDuLab,
} from '../packages/sdk-browser/bench/justesse/pageWebgpu.mjs';

const ici = dirname(fileURLToPath(import.meta.url));

/**
 * Exécute `executer()` du module de page `fixture` dans Chromium. `nom` est le nom global sous
 * lequel le paquet s'expose, `titre` celui de la page. Rend le résultat de la page, son tableau
 * `erreurs` complété par les erreurs non rattrapées du document.
 */
export async function preuveDansLaPage(fixture, nom, titre) {
  const esbuild = createRequire(requireDuLab().resolve('vite'))('esbuild');
  const paquet = await esbuild.build({
    entryPoints: [resolve(ici, 'browserFixtures', fixture)],
    bundle: true,
    write: false,
    format: 'iife',
    globalName: nom,
    platform: 'browser',
    target: 'es2022',
    logLevel: 'error',
  });
  const erreursPage = [];
  const resultat = await dansPageWebgpu((global) => globalThis[global].executer(), nom, {
    titre,
    script: paquet.outputFiles[0].text,
    erreursPage,
  });
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
