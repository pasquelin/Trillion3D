#!/usr/bin/env node
// =====================================================================================
// Le rapport global d'une campagne : un seul fichier HTML, lisible sans serveur, qui met tous les
// relevés de `campagne.mjs` en regard — l'image entière par vue, les résolutions, les passes, les
// étapes, les portes, la lumière, la mémoire, la fidélité, les autres moteurs, la référence, les
// micro-bancs, les captures — et dit ce que les chiffres orientent.
//
//   node scripts/mesure/rapportGlobal.mjs [--dossier .mesure/out/global]
//
// Aucun chiffre n'est calculé hors des relevés ; ce qui manque est écrit « non mesuré ».
// =====================================================================================
import { writeFileSync } from 'node:fs';
import { hostname, cpus, totalmem } from 'node:os';
import { join, resolve } from 'node:path';
import { CAMPAGNE } from './campagne.mjs';
import { parseArgs } from './options.mjs';
import { html, nombre, octets, tableau } from './rapportGlobalGraphes.mjs';
import { lireCampagne, trouve } from './rapportGlobalLecture.mjs';
import { page } from './rapportGlobalPage.mjs';
import { sectionVues, tuiles } from './rapportGlobalPerformance.mjs';
import { sectionEtapes, sectionPasses, sectionResolutions } from './rapportGlobalPasses.mjs';
import { sectionPortes } from './rapportGlobalPortes.mjs';
import { sectionLumiere } from './rapportGlobalLumiere.mjs';
import { sectionMemoire, sectionMoteurs } from './rapportGlobalMemoire.mjs';
import { sectionThreeNu } from './rapportGlobalThreeNu.mjs';
import { sectionSimple } from './rapportGlobalSimple.mjs';
import { tableauProfilReference, tableauReference } from './rapportGlobalReference.mjs';
import { verdicts } from './rapportGlobalVerdicts.mjs';

const ROOT = resolve(import.meta.dirname, '../..');
const flags = parseArgs(process.argv.slice(2));
const dossier = resolve(flags.get('dossier') ?? join(ROOT, '.mesure/out/global'));
const ex = lireCampagne(dossier, CAMPAGNE);
const mobile = trouve(ex, 'mobile', 'sol', 1);
const premier = ex.find((e) => !e.absent);

const entete = () => {
  const lignes = ex.map((e) => [
    e.nom,
    e.pourquoi,
    e.absent ? 'absente' : `${e.releves.length} relevés`,
    e.absent ? e.erreur : e.erreurs.length ? `${e.erreurs.length} erreur(s)` : 'ok',
    e.absent ? '' : `${((new Date(e.fin) - new Date(e.debut)) / 1000).toFixed(0)} s`,
  ]);
  return [
    `<p>Scène <code>${html(premier?.scene ?? '?')}</code>, dépôt <code>${html(premier?.head?.slice(0, 8) ?? '?')}</code>, machine <code>${html(hostname())}</code> (${cpus().length} cœurs, ${octets(totalmem())}), Chrome du poste, sans fenêtre sauf l’exécution <code>visible</code>. Campagne jouée du ${html(ex.find((e) => e.debut)?.debut ?? '?')} au ${html([...ex].reverse().find((e) => e.fin)?.fin ?? '?')}. Les chiffres d’une machine ne valent que sur elle.</p>`,
    tableau(['Exécution', 'Ce qu’elle isole', 'Relevés', 'État', 'Durée'], lignes),
  ].join('');
};

const lacunes = () => {
  const items = [];
  if (mobile) {
    for (const e of mobile.etapes)
      if (e.cpuP50 === null && e.gpuP50 === null)
        items.push(
          `Étape « ${e.libelle} » : ni processeur ni carte — ${e.raisonCpu ?? 'aucune raison publiée'} ; ${e.raisonGpu ?? ''}`,
        );
    if (mobile.rafP50 === null)
      items.push(
        'Cadence d’affichage : non publiée par le moteur WebGPU ; le banc ne donne pas de FPS, seulement des enveloppes.',
      );
  }
  const bruyants = ex
    .flatMap((e) => e.releves)
    .filter((r) => r.temoinAA && r.temoinAA.pixels > r.temoinAA.total * 0.01);
  if (bruyants.length)
    items.push(
      `Témoin A/A bruyant (plus de 1 % des pixels entre deux exécutions identiques) : ${bruyants.map((r) => `${r.run} · ${r.vue} · qualité ${r.seuil} (${nombre((100 * r.temoinAA.pixels) / r.temoinAA.total, 1)} %)`).join(' ; ')}. Sur ces relevés, un écart d’image entre deux options ne prouve rien tant que le bruit n’est pas expliqué.`,
    );
  items.push(
    'Le témoin Three du SDK (`temoin-three`, moteur `webgl`) dessine SANS textures — ses captures sont grises — : son écart d’image ne mesure pas les matériaux, seulement la géométrie et la lumière. Le témoin Three nu (<a href="#three-nu">face à Three.js nu</a>) le remplace ; les deux lignes du SDK meurent avec le retrait de Three.',
  );
  items.push(
    'Écart d’image : le banc compte tout pixel différent d’au moins un niveau sur un canal, sans seuil ; deux images visuellement identiques peuvent différer sur la moitié de leurs pixels (filtrage de texture, arrondi). Le `max canal` et les captures côte à côte disent si l’écart se voit.',
  );
  items.push(
    'Octets par triangle : le banc publie la géométrie résidente en octets et les pages, pas le nombre de triangles résidents ; la comparaison avec les 8,7 o/tri de la référence reste celle de `docs/FORMAT.md` (~48 o/tri), non mesurée ici.',
  );
  items.push(
    'Mémoire de la carte (`vramBytes`) : non publiée par le navigateur ; seuls les octets que le moteur alloue lui-même sont comptés.',
  );
  items.push(
    'Millisecondes de la référence : prises sur sa console, pas ici — aucune ligne « nous vs eux » en ms ne conclut tant que la campagne sur la même machine (Géométrie 25) n’est pas jouée.',
  );
  items.push(
    'Oracle du rebond (`oracle.mjs`) : non joué, il demande une scène de pièce compilée (`.mesure/cache-piece`) qui n’est pas dans les assets.',
  );
  items.push(
    'Exécution `profil-off` : sans profil, aucune enveloppe carte n’existe ; seule la différence de processeur et le témoin A/A se lisent.',
  );
  return `<ul>${items.map((i) => `<li class="lacune">${html(i)}</li>`).join('')}</ul>`;
};

const sections = [
  {
    id: 'simple',
    titre: '1. Où on en est',
    corps: sectionSimple(ex, dossier),
  },
  { id: 'resume', titre: '2. Ce qu’il faut retenir, en détail', corps: tuiles(ex) + verdicts(ex) },
  { id: 'campagne', titre: '3. La campagne', corps: entete() },
  { id: 'vues', titre: '4. L’image entière, vue par vue', corps: sectionVues(ex) },
  { id: 'resolutions', titre: '5. La courbe des résolutions', corps: sectionResolutions(ex) },
  { id: 'passes', titre: '6. Les passes de la carte graphique', corps: sectionPasses(ex) },
  { id: 'etapes', titre: '7. Les étapes du processeur', corps: sectionEtapes(ex) },
  { id: 'portes', titre: '8. Les portes : une option, deux exécutions', corps: sectionPortes(ex) },
  { id: 'lumiere', titre: '9. Lampes, ombres, rebond', corps: sectionLumiere(ex) },
  { id: 'memoire', titre: '10. Mémoire', corps: sectionMemoire(ex) },
  { id: 'moteurs', titre: '11. Les moteurs et le témoin', corps: sectionMoteurs(ex) },
  {
    id: 'three-nu',
    titre: '12. Face à Three.js nu : les points faibles',
    corps: sectionThreeNu(ex),
  },
  {
    id: 'reference',
    titre: '13. Face à la référence (UE5, Nanite)',
    corps:
      '<p>Les chiffres de la référence sont ceux de <code>docs/REFERENCE_UE5.md</code> (talk SIGGRAPH 2021, sources citées là). Les constantes se comparent ; les millisecondes donnent la forme du profil, pas un verdict.</p>' +
      tableauReference({
        mobile,
        fixe: trouve(ex, 'fixe', 'sol', 1),
        instances12: trouve(ex, 'instances-12', 'generale', 1),
      }) +
      '<h3>La forme du profil</h3>' +
      tableauProfilReference(mobile),
  },
  { id: 'lacunes', titre: '14. Ce qui n’est pas mesuré, et pourquoi', corps: lacunes() },
];

const sortie = join(dossier, 'rapport.html');
writeFileSync(
  sortie,
  page({
    titre: 'Le moteur, mesuré',
    sousTitre: `Campagne complète sur ${premier?.scene ?? '?'} — ${ex.filter((e) => !e.absent).length} exécutions, ${ex.reduce((n, e) => n + e.releves.length, 0)} relevés`,
    sections,
  }),
);
console.log(`Rapport : ${sortie}`);
