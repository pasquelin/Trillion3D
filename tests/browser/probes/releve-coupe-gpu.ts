// READOUT COST, measured on GPU: what a frame pays to bring back the cut, and what the
// worst case adds for nothing.
//
// Readout buffer is sized on `pageCount`, and frame copy takes all of it
// (`gpuDagResources.ts`, `gpuDagDispatch.ts`). The useful cut, however, is only a few tens
// of thousands of rows. This benchmark calls DELIVERED cut — `createDagResources` and
// `encodeDagKernels` — and changes only one thing between two variants: the number of bytes that
// the copy carries. The difference is thus exactly the cost of worst case, for the same kernel work.
import test from 'node:test';
import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dansPageWebgpu, empaquetePage } from './pageWebgpu.ts';
import {
  SELECTION_HEADER_WORDS,
  SELECTION_LIST_CAP,
} from '../../../packages/sdk-browser/gpuDagLayout.ts';
import type { executer, Ligne } from './releveCoupePage.ts';

declare global {
  var releveCoupe: { executer: typeof executer };
}

const ici = dirname(fileURLToPath(import.meta.url));

/** Swept scene sizes, in LEAVES: pyramid yields roughly double in pages. */
const TAILLES = [12000, 120000, 500000, 1000000];
const NIVEAUX = 8;
const TOURS = 120,
  RONDES = 7;
/** DELIVERED cap, read from source: benchmark does not restate it, it checks it. */
const PLAFOND = SELECTION_LIST_CAP;
/** Swept screen error thresholds: threshold decides cut size, thus what a cap can lose. */
const ERREURS = [1, 4, 16, 64];

test('delivered readout stays under its cap regardless of catalog size', async () => {
  const script = await empaquetePage(resolve(ici, 'releveCoupePage.ts'), 'releveCoupe');
  const erreursPage: string[] = [];
  const releve = await dansPageWebgpu(
    (argument: Parameters<typeof executer>[0]) => globalThis.releveCoupe.executer(argument),
    {
      tailles: TAILLES,
      niveaux: NIVEAUX,
      tours: TOURS,
      rondes: RONDES,
      plafond: PLAFOND,
      erreurs: ERREURS,
    },
    { titre: 'Cut reading cost', script, erreursPage },
  );
  assert.equal(releve.indisponible, undefined, 'WebGPU must be available');
  assert.deepEqual([...(releve.erreurs ?? []), ...erreursPage], []);
  assert.ok(releve.lignes, 'no line was measured');
  const mesurees = releve.lignes.filter(
    (ligne): ligne is Exclude<Ligne, { refus: string }> => !('refus' in ligne),
  );
  assert.ok(mesurees.length >= 2, 'at least two sizes must fit on the card');
  const arrondi = (x: number): number => Number(x.toFixed(4));
  const mo = (octets: number): number => Number((octets / 1048576).toFixed(2));
  const table = mesurees.map((ligne) => {
    const [seul, livre, pireCas] = ligne.variantes.map((v) => v.ms);
    return {
      pages: ligne.pages,
      coupeParErreur: Object.fromEntries(ligne.coupes.map((c) => [c.erreur, c.coupe])),
      moLivre: mo(ligne.octetsLivre),
      moPireCas: mo(ligne.octetsPireCas),
      msNoyauxSeuls: seul,
      msImageLivree: arrondi(livre),
      msImagePireCas: arrondi(pireCas),
      bruit: arrondi(Math.max(ligne.variantes[1].etendue, ligne.variantes[2].etendue)),
    };
  });
  console.log(
    JSON.stringify(
      {
        adaptateur: releve.adaptateur,
        plafond: releve.plafond,
        refus: releve.lignes.filter((ligne) => 'refus' in ligne),
        table,
      },
      null,
      2,
    ),
  );
  const capOctets = 2 * (SELECTION_HEADER_WORDS * 4 + PLAFOND * 4);
  for (const ligne of table)
    assert.ok(
      ligne.moLivre <= mo(capOctets),
      `at ${ligne.pages} pages, the delivered reading (${ligne.moLivre} MB) must stay under the ceiling (${mo(capOctets)} MB)`,
    );
  const plusGrande = table[table.length - 1];
  assert.ok(
    plusGrande.moPireCas > plusGrande.moLivre * 4,
    'the largest scene must largely exceed the ceiling',
  );
});
