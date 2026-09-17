// Les deux listes que l'hôte demande au moteur WebGPU après le rendu : mêmes adresses qu'un
// dédoublonnage par ensemble de chaînes, et rendues telles quelles tant que rien de ce dont elles
// dépendent n'a bougé. Celle des pages à charger ne parcourt plus la coupe : la différence tient
// l'ensemble des pages qui attendent leurs octets, et c'est lui qui est lu.
import test from 'node:test';
import assert from 'node:assert/strict';
import { RequestStamps, type PageRec } from './pageSelection.ts';
import { createCutDelta } from './webgpuCutDelta.ts';
import { createCutPending } from './webgpuCutPending.ts';
import { pageUrls, pendingUrls } from './webgpuPagesHostApi.ts';
import type { WebgpuPagesRuntime } from './webgpuPagesRuntime.ts';

const rec = (url: string, requestIndex: number, chargee = true) =>
  ({ url, requestIndex, array: chargee ? new Uint32Array(3) : undefined }) as unknown as PageRec;

/** Ce que les deux listes lisent, et rien d'autre : un catalogue, trois listes, deux estampilles. */
function banc() {
  const bootstrap = [rec('a', 0)];
  // Deux placements d'une même clé de requête (rangs 2 et 3), et trois pages sans octets.
  const packedPages = [
    rec('a', 0),
    rec('b', 1),
    rec('c', 2),
    rec('c', 2),
    rec('d', 3, false),
    rec('e', 4, false),
    rec('f', 5, false),
  ];
  packedPages.forEach((page, index) => (page.packedIndex = index));
  const shown = [packedPages[0], packedPages[1]];
  const desired: PageRec[] = [];
  const delta = createCutDelta(packedPages, desired);
  const cutPending = createCutPending(packedPages, delta);
  const run = {
    desired,
    shown,
    urlScratch: [] as string[],
    pendingScratch: [] as string[],
    hostPendingScratch: [] as string[],
    coverageBudgetLimited: false,
    cutHeld: false,
    cutEpoch: 0,
    pageArrayEpoch: 0,
    pendingHeld: { epoch: -1, cut: -1, limited: false, ready: false },
    urlsHeld: { epoch: -1, cut: -1, limited: false },
  };
  const rt = {
    run,
    layout: { packedPages },
    setup: { bootstrap, requestStamps: new RequestStamps(6) },
    services: { bootstrapState: { ready: true }, cutPending },
  } as unknown as WebgpuPagesRuntime;
  /** Une coupe publiée comme le moteur la publie : par sa différence, lecteurs compris. */
  const publie = (ids: number[]) => {
    delta.apply(ids);
    cutPending.apply();
    run.cutEpoch++;
  };
  publie([1, 2, 3, 4]);
  return { rt, run, publie, cutPending, packedPages };
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

test('le suivi du rendu écrit dans son propre tableau, jamais dans la liste tenue', () => {
  const { rt, run } = banc();
  const attendue = pendingUrls(rt);
  run.cutHeld = true;
  // Ce que `reportProgress` fait toutes les deux secondes, dans le tableau qui lui reste.
  run.pendingScratch.length = 0;
  run.pendingScratch.push('intrus');
  assert.deepEqual(pendingUrls(rt), attendue, 'la liste tenue n’a pas été écrasée');
});

test('les deux listes rendent ce qu’un ensemble de chaînes rendait, dans le même ordre', () => {
  const { rt, run } = banc();
  assert.deepEqual(pageUrls(rt), parEnsemble([rt.setup.bootstrap, run.shown, run.desired]));
  assert.deepEqual(pageUrls(rt), ['a', 'b', 'c', 'd']);
  // Seules les pages sans octets sont attendues, dédoublonnées de la même façon.
  assert.deepEqual(pendingUrls(rt), ['d']);
  // Le budget dépassé retire la coupe des deux listes, sans toucher au reste.
  run.coverageBudgetLimited = true;
  assert.deepEqual(pageUrls(rt), ['a', 'b']);
  assert.deepEqual(pendingUrls(rt), []);
});

test('un relevé tenu rend la liste déjà rendue, et tout le reste la refait', () => {
  const { rt, run, publie } = banc();
  const urls = pageUrls(rt),
    pending = pendingUrls(rt);
  // Un relevé tenu : les listes ne sont pas reparcourues, donc une coupe élargie en douce est ignorée.
  run.cutHeld = true;
  const epoch = run.cutEpoch;
  publie([1, 2, 3, 4, 5]);
  run.cutEpoch = epoch;
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
  publie([1, 2, 3, 4]);
  assert.deepEqual(pageUrls(rt), ['a', 'b', 'c', 'd']);
  assert.deepEqual(pendingUrls(rt), ['d']);
});

test('une adoption qui réécrit les listes après coup les fait vieillir, même relevé tenu ensuite', () => {
  const { rt, run, publie } = banc();
  const urls = pageUrls(rt),
    pending = pendingUrls(rt);
  assert.deepEqual(urls, ['a', 'b', 'c', 'd']);
  // La vidange rejoue une adoption APRÈS que l'hôte a pris ses listes : elles bougent sous lui, et
  // l'image suivante peut très bien relire le même relevé et se croire en droit de les tenir.
  publie([1, 2, 3, 4, 5]);
  run.cutHeld = true;
  assert.deepEqual(pageUrls(rt), ['a', 'b', 'c', 'd', 'e'], 'la liste périmée n’est pas rendue');
  assert.deepEqual(pendingUrls(rt), ['d', 'e']);
  assert.notDeepEqual(pending, ['d'], 'le tableau tenu a bien été réécrit');
  // Le même âge et le même relevé : là, et là seulement, la liste est rendue telle quelle.
  const epoch = run.cutEpoch;
  publie([1, 2, 3, 4, 5, 6]);
  run.cutEpoch = epoch;
  assert.deepEqual(pageUrls(rt), ['a', 'b', 'c', 'd', 'e']);
  assert.deepEqual(pendingUrls(rt), ['d', 'e']);
});

test('les octets d’une page de la coupe la font entrer et sortir de l’attente', () => {
  const { rt, run, cutPending, packedPages } = banc();
  assert.deepEqual(pendingUrls(rt), ['d']);
  // Les octets arrivent : le journal des rangs nomme la page, l'ensemble en attente se vide.
  packedPages[4].array = new Uint32Array(3);
  cutPending.touch(4);
  run.pageArrayEpoch++;
  assert.deepEqual(pendingUrls(rt), []);
  // Et repartent : elle revient dans l'attente, sans que la coupe ait bougé d'un rang.
  packedPages[4].array = undefined;
  cutPending.touch(4);
  run.pageArrayEpoch++;
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
