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
          `Step “${e.libelle}”: neither CPU nor GPU — ${e.raisonCpu ?? 'no reason published'} ; ${e.raisonGpu ?? ''}`,
        );
    if (mobile.rafP50 === null)
      items.push(
        'Display cadence: not published by the WebGPU engine; the bench reports envelopes, not FPS.',
      );
  }
  const bruyants = ex
    .flatMap((e) => e.releves)
    .filter((r) => r.temoinAA && r.temoinAA.pixels > r.temoinAA.total * 0.01);
  if (bruyants.length)
    items.push(
      `Noisy A/A witness (more than 1% of pixels): ${bruyants.map((r) => `${r.run} · ${r.vue} · quality ${r.seuil} (${nombre((100 * r.temoinAA.pixels) / r.temoinAA.total, 1)} %)`).join(' ; ')}.`,
    );
  items.push(
    'The SDK Three witness (`temoin-three`) draws WITHOUT textures. The vanilla Three witness replaces it. Image delta: every pixel of a level, no threshold. Bytes per triangle: ~48 B/tri (`docs/FORMAT.md`), not measured here. `vramBytes`: not published. Unreal milliseconds: its console, not here (Geometry 25). Bounce oracle: room scene missing. `profil-off`: no GPU envelope.',
  );
  return `<ul>${items.map((i) => `<li class="lacune">${html(i)}</li>`).join('')}</ul>`;
};

const referenceDe = (s) => {
  const mobile = trouve(s.executions, 'mobile', 'sol', 1);
  return (
    '<p>Reference numbers are those of <code>docs/REFERENCE_UE5.md</code>. Constants compare; milliseconds show the shape of the profile, not a verdict.</p>' +
    tableauReference({
      mobile,
      fixe: trouve(s.executions, 'fixe', 'sol', 1),
      instances12: trouve(s.executions, 'instances-12', 'generale', 1),
    }) +
    '<h3>Profile shape</h3>' +
    tableauProfilReference(mobile)
  );
};

const sections = [
  { id: 'simple', titre: '1. Where we stand', corps: colonnesSimple(scenes, sectionSimple) },
  { id: 'coupe', titre: '2. Where the triangles come from', corps: sectionCoupe(scenes) },
  {
    id: 'resume',
    titre: '3. What to take away, in detail',
    corps: pourChaqueScene(scenes, (s) => tuiles(s.executions) + verdicts(s.executions)),
  },
  {
    id: 'campagne',
    titre: '4. The campaign',
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
    titre: '5. The whole frame, view by view',
    corps: pourChaqueScene(scenes, (s) => sectionVues(s.executions)),
  },
  {
    id: 'resolutions',
    titre: '6. The resolution curve',
    corps: pourChaqueScene(scenes, (s) => sectionResolutions(s.executions)),
  },
  {
    id: 'passes',
    titre: '7. GPU passes',
    corps: pourChaqueScene(scenes, (s) => sectionPasses(s.executions)),
  },
  {
    id: 'etapes',
    titre: '8. CPU steps',
    corps: pourChaqueScene(scenes, (s) => sectionEtapes(s.executions)),
  },
  {
    id: 'portes',
    titre: '9. Gates: one option, two runs',
    corps: pourChaqueScene(scenes, (s) => sectionPortes(s.executions)),
  },
  {
    id: 'lumiere',
    titre: '10. Lights, shadows, bounce',
    corps: pourChaqueScene(scenes, (s) => sectionLumiere(s.executions)),
  },
  {
    id: 'memoire',
    titre: '11. Memory',
    corps: pourChaqueScene(scenes, (s) => sectionMemoire(s.executions)),
  },
  {
    id: 'moteurs',
    titre: '12. Engines and the witness',
    corps: pourChaqueScene(scenes, (s) => sectionMoteurs(s.executions)),
  },
  {
    id: 'three-nu',
    titre: '13. Versus Three.js vanilla: weak spots',
    corps: pourChaqueScene(scenes, (s) => sectionThreeNu(s.executions)),
  },
  {
    id: 'reference',
    titre: '14. Versus the reference (UE5, Nanite)',
    corps: pourChaqueScene(scenes, referenceDe),
  },
  {
    id: 'lacunes',
    titre: '15. What is not measured, and why',
    corps: pourChaqueScene(scenes, (s) => lacunesDe(s.executions)),
  },
];

const sortie = join(dossier, 'rapport.html');
writeFileSync(
  sortie,
  page({
    titre: 'The engine, measured',
    sousTitre: `Full campaign on ${scenes.map((s) => s.nom).join(', ')} — ${jouees.length} runs, ${tous.reduce((n, e) => n + e.releves.length, 0)} samples`,
    sections,
  }),
);
console.log(`Report: ${sortie}`);
