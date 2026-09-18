import test from 'node:test';
import assert from 'node:assert/strict';
import { createWebgpuPageTracking } from './webgpuPageTracking.ts';
import { createWebgpuResidentEnsurer } from './webgpuResidentEnsurer.ts';
import type { PageRec } from './pageSelection.ts';

/** Un cache de trois fentes toutes épinglées : la quatrième page ne peut pas entrer. */
function saturatedCache(resident: string[], error = 'ALL_PAGES_PINNED') {
  const held = new Set(resident);
  return {
    get: (url: string) => (held.has(url) ? { key: url } : undefined),
    async load(url: string) {
      if (held.size >= 3) throw new Error(error);
      held.add(url);
    },
    pin() {},
  };
}

const ensurer = (tracking: ReturnType<typeof createWebgpuPageTracking>, cache: unknown) =>
  createWebgpuResidentEnsurer({
    getCache: () => cache as never,
    tracking,
    bootstrapKey: new Uint8Array(tracking.keyCount),
    hasBytes: () => true,
    isLost: () => false,
    traceEnabled: false,
    traceDiagnostic: () => {},
  });

test('un réservoir plein arrête la salve sans faire tomber l’image ; toute autre erreur remonte', async () => {
  const pages = ['a', 'b', 'c', 'd', 'e'].map((url) => ({
    url,
    array: new Uint8Array(4),
  })) as PageRec[];
  const tracking = createWebgpuPageTracking(pages);
  for (const page of pages) tracking.wanted.add(tracking.keyOf(page), page);
  const cache = saturatedCache(['a', 'b']);
  await ensurer(tracking, cache)(pages, 1, 1);
  // `c` est entré (troisième fente), `d` a trouvé le réservoir plein : la salve s'arrête, `d` et `e`
  // restent voulus et dehors — ils s'affichent par leur ancêtre résident, et l'admission de la
  // coupe lit l'état (`keepCount > slots`) pour grossir l'erreur écran.
  assert.ok(cache.get('c'));
  assert.equal(cache.get('d'), undefined);
  await assert.rejects(
    ensurer(tracking, saturatedCache(['a', 'b', 'c'], 'WEBGPU_LOST'))([pages[3]], 2, 2),
    /WEBGPU_LOST/,
  );
});
