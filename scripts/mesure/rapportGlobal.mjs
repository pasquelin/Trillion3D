#!/usr/bin/env node
// =====================================================================================
// Le rapport global d'une campagne : un seul fichier HTML, lisible sans serveur, qui met tous les
// relevés de `campagne.mjs` en regard — une colonne par scène de référence, l'image entière par
// vue, les résolutions, les passes, les étapes, les portes, la lumière, la mémoire, la fidélité,
// les autres moteurs, la référence — et dit ce que les chiffres orientent.
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
import { trouve } from './rapportGlobalLecture.mjs';
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
import {
  colonnesSimple,
  enteteCampagne,
  lireScenes,
  pourChaqueScene,
} from './rapportGlobalScenes.mjs';
import { sectionCoupe } from './rapportGlobalCoupe.mjs';

const ROOT = resolve(import.meta.dirname, '../..');
const flags = parseArgs(process.argv.slice(2));
const dossier = resolve(flags.get('dossier') ?? join(ROOT, '.mesure/out/global'));
const scenes = lireScenes(dossier, CAMPAGNE);
const tous = scenes.flatMap((s) => s.executions);
const jouees = tous.filter((e) => !e.absent);

const lacunesDe = (ex) => {
  const items = [];
  const mobile = trouve(ex, 'mobile', 'sol', 1);
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
      `Témoin A/A bruyant (plus de 1 % des pixels) : ${bruyants.map((r) => `${r.run} · ${r.vue} · qualité ${r.seuil} (${nombre((100 * r.temoinAA.pixels) / r.temoinAA.total, 1)} %)`).join(' ; ')}.`,
    );
  items.push(
    'Le témoin Three du SDK (`temoin-three`) dessine SANS textures. Le témoin Three nu le replace. Écart d’image : tout pixel d’un niveau, sans seuil. Octets par triangle : ~48 o/tri (`docs/FORMAT.md`), non mesurés ici. `vramBytes` : non publié. Millisecondes Unreal : sa console, pas ici (Géométrie 25). Oracle du rebond : scène pièce absente. `profil-off` : pas d’enveloppe carte.',
  );
  return `<ul>${items.map((i) => `<li class="lacune">${html(i)}</li>`).join('')}</ul>`;
};

const referenceDe = (s) => {
  const mobile = trouve(s.executions, 'mobile', 'sol', 1);
  return (
    '<p>Les chiffres de la référence sont ceux de <code>docs/REFERENCE_UE5.md</code>. Les constantes se comparent ; les millisecondes donnent la forme du profil, pas un verdict.</p>' +
    tableauReference({
      mobile,
      fixe: trouve(s.executions, 'fixe', 'sol', 1),
      instances12: trouve(s.executions, 'instances-12', 'generale', 1),
    }) +
    '<h3>La forme du profil</h3>' +
    tableauProfilReference(mobile)
  );
};

const sections = [
  { id: 'simple', titre: '1. Où on en est', corps: colonnesSimple(scenes, sectionSimple) },
  { id: 'coupe', titre: '2. D’où viennent les triangles', corps: sectionCoupe(scenes) },
  {
    id: 'resume',
    titre: '3. Ce qu’il faut retenir, en détail',
    corps: pourChaqueScene(scenes, (s) => tuiles(s.executions) + verdicts(s.executions)),
  },
  {
    id: 'campagne',
    titre: '4. La campagne',
    corps: enteteCampagne(scenes, {
      hostname: hostname(),
      cpus: cpus().length,
      memoire: totalmem(),
      octets,
      tableau,
    }),
  },
  {
    id: 'vues',
    titre: '5. L’image entière, vue par vue',
    corps: pourChaqueScene(scenes, (s) => sectionVues(s.executions)),
  },
  {
    id: 'resolutions',
    titre: '6. La courbe des résolutions',
    corps: pourChaqueScene(scenes, (s) => sectionResolutions(s.executions)),
  },
  {
    id: 'passes',
    titre: '7. Les passes de la carte graphique',
    corps: pourChaqueScene(scenes, (s) => sectionPasses(s.executions)),
  },
  {
    id: 'etapes',
    titre: '8. Les étapes du processeur',
    corps: pourChaqueScene(scenes, (s) => sectionEtapes(s.executions)),
  },
  {
    id: 'portes',
    titre: '9. Les portes : une option, deux exécutions',
    corps: pourChaqueScene(scenes, (s) => sectionPortes(s.executions)),
  },
  {
    id: 'lumiere',
    titre: '10. Lampes, ombres, rebond',
    corps: pourChaqueScene(scenes, (s) => sectionLumiere(s.executions)),
  },
  {
    id: 'memoire',
    titre: '11. Mémoire',
    corps: pourChaqueScene(scenes, (s) => sectionMemoire(s.executions)),
  },
  {
    id: 'moteurs',
    titre: '12. Les moteurs et le témoin',
    corps: pourChaqueScene(scenes, (s) => sectionMoteurs(s.executions)),
  },
  {
    id: 'three-nu',
    titre: '13. Face à Three.js nu : les points faibles',
    corps: pourChaqueScene(scenes, (s) => sectionThreeNu(s.executions)),
  },
  {
    id: 'reference',
    titre: '14. Face à la référence (UE5, Nanite)',
    corps: pourChaqueScene(scenes, referenceDe),
  },
  {
    id: 'lacunes',
    titre: '15. Ce qui n’est pas mesuré, et pourquoi',
    corps: pourChaqueScene(scenes, (s) => lacunesDe(s.executions)),
  },
];

const sortie = join(dossier, 'rapport.html');
writeFileSync(
  sortie,
  page({
    titre: 'Le moteur, mesuré',
    sousTitre: `Campagne complète sur ${scenes.map((s) => s.nom).join(', ')} — ${jouees.length} exécutions, ${tous.reduce((n, e) => n + e.releves.length, 0)} relevés`,
    sections,
  }),
);
console.log(`Rapport : ${sortie}`);
