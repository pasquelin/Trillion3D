// Banc du lot M1 « socle mathématique ».
import { rejoueEnProcessusNeuf, rapport } from '../../sdk-core/bench/mesure.mjs';

if (process.env.SOCLE_PARTIE === 'performance') {
  const { entete, publie } = await import('./socleMesure.mjs');
  const { lignesPerformance } = await import('./soclePerf.mjs');
  publie(entete(), lignesPerformance());
} else {
  const { lignesEquivalence, noeudsHierarchie } = await import('./socleEquivalence.mjs');
  const { lignesConsommateursCore } = await import('./socleConsommateursCore.mjs');
  const { lignesConsommateursBrowser } = await import('./socleConsommateursBrowser.mjs');
  await import('./socleEcarts.mjs');
  const lignes = [
    ...(await lignesEquivalence()),
    ...(await lignesConsommateursCore()),
    ...(await lignesConsommateursBrowser()),
  ];
  rapport(
    'socle-math',
    lignes,
    `le socle rend les bits de la référence et du code qu'il remplace (${noeudsHierarchie.length} nœuds hiérarchiques)`,
  );
  rejoueEnProcessusNeuf(import.meta.url, 'SOCLE_PARTIE');
}
