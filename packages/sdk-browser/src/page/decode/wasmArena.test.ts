// The shared buffer (`wasmArena.ts`): a single allocation per batch, views that stay valid even
// when linear memory grows — whether that is the reservation itself or an allocation made
// elsewhere well after —, `liste()` which re-reads a counter then its list, `blocsJavaScript()`
// which yields the same shape outside any module, and no allocation during a compute call.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { prepareSdkWasm, type SdkWasm } from './geometryPageWasm.ts';
import { blocsJavaScript, reserveArena, type ArenaDemande } from './wasmArena.ts';

const MODULE = readFileSync(join(import.meta.dirname, 'pageCodec.wasm'));

async function wasmFrais(): Promise<SdkWasm> {
  const module = (await import(`./geometryPageWasm.ts?fraicheur=${wasmFrais.compteur++}`)) as {
    prepareSdkWasm: typeof prepareSdkWasm;
  };
  const wasm = await module.prepareSdkWasm(MODULE);
  if (!wasm) throw new Error('the real module must instantiate');
  return wasm;
}
wasmFrais.compteur = 0;

/** Counts calls to `arena_alloc` on the given module, without changing its behaviour. */
function compteAllocations(wasm: SdkWasm) {
  const compteur = { valeur: 0 };
  const espionne: SdkWasm = {
    ...wasm,
    arena_alloc: (bytes: number) => {
      compteur.valeur++;
      return wasm.arena_alloc(bytes);
    },
  };
  return { espionne, compteur };
}

test('reserveArena makes only one allocation for all requested blocks', async () => {
  const wasm = await wasmFrais();
  const { espionne, compteur } = compteAllocations(wasm);
  const demandes: ArenaDemande[] = [
    { type: 'u32', longueur: 1 },
    { type: 'f64', longueur: 6 },
    { type: 'f64', longueur: 32, pas: 16 },
  ];
  const arena = reserveArena(espionne, demandes);
  assert.ok(arena);
  assert.equal(compteur.valeur, 1);
  arena.libere();
});

test('views stay valid after the memory growth their own reservation caused', async () => {
  const wasm = await wasmFrais();
  // A large batch forces `arena_alloc` to grow linear memory, which detaches every `ArrayBuffer`
  // already built elsewhere. The views yielded here are built AFTER that allocation: they must
  // therefore point at the module's current buffer, not at a stale one.
  const arena = reserveArena(wasm, [{ type: 'f64', longueur: 200_000 }]);
  assert.ok(arena);
  const [bloc] = arena.blocs();
  assert.equal(bloc.vue.buffer, wasm.memory.buffer, 'the view must point at the current buffer');
  // Write and re-read of hostile values: the view is actually usable, not merely of the same
  // length.
  const vue = bloc.vue as Float64Array;
  vue[0] = -0;
  vue[1] = NaN;
  vue[vue.length - 1] = Infinity;
  assert.ok(Object.is(vue[0], -0));
  assert.ok(Number.isNaN(vue[1]));
  assert.equal(vue[vue.length - 1], Infinity);
  arena.libere();
});

test('views are rebuilt when a LATER allocation grows memory', async () => {
  const wasm = await wasmFrais();
  const arena = reserveArena(wasm, [{ type: 'f64', longueur: 4 }]);
  assert.ok(arena);
  const valeurs = [-0, NaN, 1e308, 5e-324];
  (arena.blocs()[0].vue as Float64Array).set(valeurs);
  const avant = arena.blocs()[0].vue,
    offsetAvant = arena.blocs()[0].offset;
  assert.equal(arena.generation(), 0, 'nothing has grown memory yet');
  // An allocation that has nothing to do with this buffer — a page decode folded onto the main
  // thread does as much — replaces the module's `ArrayBuffer` and detaches the previous view.
  const gros = wasm.arena_alloc(64 * 1024 * 1024);
  assert.ok(gros, 'the large reservation must succeed');
  assert.equal(avant.length, 0, 'the previous view must have been detached by the growth');
  const apres = arena.blocs()[0];
  assert.equal(arena.generation(), 1, 'one rebuild, and only one');
  assert.equal(apres.vue.buffer, wasm.memory.buffer, 'the view must point at the current buffer');
  assert.equal(apres.offset, offsetAvant, 'the block offset does not move');
  const relues = Array.from(apres.vue as Float64Array);
  for (let i = 0; i < valeurs.length; i++)
    assert.ok(Object.is(relues[i], valeurs[i]), `bloc[${i}] : ${relues[i]} ≠ ${valeurs[i]}`);
  assert.equal(arena.blocs()[0], apres, 'without further growth, the blocks are not rebuilt');
  wasm.arena_free(gros, 64 * 1024 * 1024);
  arena.libere();
  assert.deepEqual(arena.blocs(), [], 'a released buffer no longer carries any view');
});

test('liste() re-reads a counter written in one block then the list of another', async () => {
  const wasm = await wasmFrais();
  const arena = reserveArena(wasm, [
    { type: 'u32', longueur: 1 }, // the counter
    { type: 'f64', longueur: 8 }, // the list, at its maximum size
  ]);
  assert.ok(arena);
  const [compteurBloc, listeBloc] = arena.blocs();
  const valeurs = [1.5, -2.5, 3.5];
  for (let i = 0; i < valeurs.length; i++) (listeBloc.vue as Float64Array)[i] = valeurs[i];
  (compteurBloc.vue as Uint32Array)[0] = valeurs.length;
  const n = compteurBloc.vue[0];
  const lue = arena.liste(1, n);
  assert.deepEqual(Array.from(lue), valeurs);
  arena.libere();
});

test('blocsJavaScript() yields the same shape as reserveArena() for the same requests', async () => {
  const wasm = await wasmFrais();
  const demandes: ArenaDemande[] = [
    { type: 'u32', longueur: 4 },
    { type: 'f64', longueur: 32, pas: 16 },
    { type: 'f32', longueur: 9, pas: 3 },
  ];
  const arena = reserveArena(wasm, demandes);
  assert.ok(arena);
  const horsModule = blocsJavaScript(demandes);
  assert.equal(horsModule.length, arena.blocs().length);
  // Expected shapes, independent of both implementations: two subviews of 16 for the second
  // block, three of 3 for the third, none for the first.
  const attendu = [{ vues: undefined }, { vues: [16, 16] }, { vues: [3, 3, 3] }] as const;
  const blocs = arena.blocs();
  for (let i = 0; i < demandes.length; i++) {
    assert.equal(horsModule[i].type, blocs[i].type);
    assert.equal(horsModule[i].vue.length, blocs[i].vue.length);
    assert.equal(horsModule[i].vues?.length, blocs[i].vues?.length);
    assert.equal(blocs[i].vues?.map((v) => v.length).join(','), attendu[i].vues?.join(','));
    if (horsModule[i].vues)
      for (let v = 0; v < horsModule[i].vues!.length; v++)
        assert.equal(horsModule[i].vues![v].length, blocs[i].vues![v].length);
  }
  arena.libere();
});

test('a compute call allocates nothing: math_box_transform_batch works in the reserved buffer', async () => {
  const wasm = await wasmFrais();
  const arena = reserveArena(wasm, [
    { type: 'f64', longueur: 6 },
    { type: 'f64', longueur: 16 },
    { type: 'f64', longueur: 6 },
  ]);
  assert.ok(arena);
  const [boxes, mats, out] = arena.blocs();
  (boxes.vue as Float64Array).set([-1, -1, -1, 1, 1, 1]);
  (mats.vue as Float64Array).set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  const { espionne, compteur } = compteAllocations(wasm);
  compteur.valeur = 0;
  espionne.math_box_transform_batch(out.offset, boxes.offset, mats.offset, 1);
  assert.equal(compteur.valeur, 0, 'the computation must cause no allocation');
  assert.deepEqual(Array.from(out.vue as Float64Array), [-1, -1, -1, 1, 1, 1]);
  arena.libere();
});
