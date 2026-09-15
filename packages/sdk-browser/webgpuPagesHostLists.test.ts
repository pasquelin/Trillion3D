// Les deux listes que l'hôte demande au moteur WebGPU après le rendu : mêmes adresses qu'un
// dédoublonnage par ensemble de chaînes, et rendues telles quelles tant que rien de ce dont elles
// dépendent n'a bougé.
import test from 'node:test';
import assert from 'node:assert/strict';
import { RequestStamps, type PageRec } from './pageSelection.ts';
import { pageUrls, pendingUrls } from './webgpuPagesHostApi.ts';
import type { WebgpuPagesRuntime } from './webgpuPagesRuntime.ts';

const rec = (url: string, requestIndex: number, chargee = true) =>
  ({ url, requestIndex, array: chargee ? new Uint32Array(3) : undefined }) as unknown as PageRec;

/** Ce que les deux listes lisent, et rien d'autre : trois listes, deux drapeaux, deux estampilles. */
function banc() {
  const bootstrap = [rec('a', 0)];
  const shown = [rec('a', 0), rec('b', 1)];
  // Deux placements d'une même clé de requête, et une page dont les octets ne sont pas arrivés.
  const desired = [rec('b', 1), rec('c', 2), rec('c', 2), rec('d', 3, false)];
  const run = {
    desired,
    shown,
    urlScratch: [] as string[],
    pendingScratch: [] as string[],
    coverageBudgetLimited: false,
    cutHeld: false,
    pageArrayEpoch: 0,
    pendingHeld: { epoch: -1, limited: false, ready: false },
    urlsHeld: { epoch: -1, limited: false },
  };
  const rt = {
    run,
    setup: { bootstrap, requestStamps: new RequestStamps(5) },
    services: { bootstrapState: { ready: true } },
  } as unknown as WebgpuPagesRuntime;
  return { rt, run, desired };
}

/** L'ancienne règle, mot pour mot : un ensemble de chaînes, dans l'ordre de rencontre. */
const parEnsemble = (listes: readonly (readonly PageRec[])[]) => {
  const vus = new Set<string>(),
    urls: string[] = [];
  for (const liste of listes)
    for (const page of liste)
      if (!vus.has(page.url)) {
        vus.add(page.url);
        urls.push(page.url);
      }
  return urls;
};

test('les deux listes rendent ce qu’un ensemble de chaînes rendait, dans le même ordre', () => {
  const { rt, run, desired } = banc();
  assert.deepEqual(pageUrls(rt), parEnsemble([rt.setup.bootstrap, run.shown, desired]));
  assert.deepEqual(pageUrls(rt), ['a', 'b', 'c', 'd']);
  // Seules les pages sans octets sont attendues, dédoublonnées de la même façon.
  assert.deepEqual(pendingUrls(rt), ['d']);
  // Le budget dépassé retire la coupe des deux listes, sans toucher au reste.
  run.coverageBudgetLimited = true;
  assert.deepEqual(pageUrls(rt), ['a', 'b']);
  assert.deepEqual(pendingUrls(rt), []);
});

test('un relevé tenu rend la liste déjà rendue, et tout le reste la refait', () => {
  const { rt, run, desired } = banc();
  const urls = pageUrls(rt),
    pending = pendingUrls(rt);
  // Un relevé tenu : les listes ne sont pas reparcourues, donc une page ajoutée en douce est ignorée.
  run.cutHeld = true;
  desired.push(rec('e', 4, false));
  assert.deepEqual(pageUrls(rt), urls, 'la liste rendue est celle de l’image précédente');
  assert.deepEqual(pendingUrls(rt), pending);
  // Des octets arrivent ou partent : l'estampille avance et les deux listes repartent.
  run.pageArrayEpoch++;
  assert.deepEqual(pageUrls(rt), ['a', 'b', 'c', 'd', 'e']);
  assert.deepEqual(pendingUrls(rt), ['d', 'e']);
  // Le drapeau de budget bascule : elles repartent aussi, relevé tenu ou non.
  run.coverageBudgetLimited = true;
  assert.deepEqual(pageUrls(rt), ['a', 'b']);
  assert.deepEqual(pendingUrls(rt), []);
  // Un relevé qui n'est plus tenu refait tout, sans rien d'autre pour le dire.
  run.coverageBudgetLimited = false;
  run.cutHeld = false;
  desired.pop();
  assert.deepEqual(pageUrls(rt), ['a', 'b', 'c', 'd']);
  assert.deepEqual(pendingUrls(rt), ['d']);
});

test('la couverture d’amorçage décide seule de ce que l’image attend avant d’être prête', () => {
  const { rt, run } = banc();
  (rt.services.bootstrapState as { ready: boolean }).ready = false;
  run.cutHeld = true;
  assert.deepEqual(pendingUrls(rt), [], 'la racine tient déjà ses octets');
  (rt.services.bootstrapState as { ready: boolean }).ready = true;
  assert.deepEqual(pendingUrls(rt), ['d'], 'la bascule refait la liste malgré le relevé tenu');
});
