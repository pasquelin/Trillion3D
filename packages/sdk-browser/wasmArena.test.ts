// Le tampon partagé (`wasmArena.ts`) : une seule allocation par lot, des vues qui restent valides
// même quand la mémoire linéaire grandit — que ce soit la réservation elle-même ou une allocation
// faite ailleurs bien après —, `liste()` qui relit un compteur puis sa liste, `blocsJavaScript()`
// qui rend la même forme hors de tout module, et aucune allocation pendant un appel de calcul.
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
  if (!wasm) throw new Error('le module réel doit s’instancier');
  return wasm;
}
wasmFrais.compteur = 0;

/** Compte les appels à `arena_alloc` sur le module donné, sans changer son comportement. */
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

test('reserveArena ne fait qu’une seule allocation pour tous les blocs demandés', async () => {
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

test('les vues restent valides après la croissance de mémoire que leur propre réservation a causée', async () => {
  const wasm = await wasmFrais();
  // Un grand lot force `arena_alloc` à faire grandir la mémoire linéaire, ce qui détache tout
  // `ArrayBuffer` déjà construit ailleurs. Les vues rendues ici sont construites APRÈS cette
  // allocation : elles doivent donc pointer sur le tampon courant du module, pas sur un tampon
  // caduque.
  const arena = reserveArena(wasm, [{ type: 'f64', longueur: 200_000 }]);
  assert.ok(arena);
  const [bloc] = arena.blocs();
  assert.equal(bloc.vue.buffer, wasm.memory.buffer, 'la vue doit porter sur le tampon courant');
  // Écriture et relecture de valeurs hostiles : la vue est bien utilisable, pas seulement de la
  // même longueur.
  const vue = bloc.vue as Float64Array;
  vue[0] = -0;
  vue[1] = NaN;
  vue[vue.length - 1] = Infinity;
  assert.ok(Object.is(vue[0], -0));
  assert.ok(Number.isNaN(vue[1]));
  assert.equal(vue[vue.length - 1], Infinity);
  arena.libere();
});

test('les vues sont reconstruites quand une allocation ULTÉRIEURE fait grandir la mémoire', async () => {
  const wasm = await wasmFrais();
  const arena = reserveArena(wasm, [{ type: 'f64', longueur: 4 }]);
  assert.ok(arena);
  const valeurs = [-0, NaN, 1e308, 5e-324];
  (arena.blocs()[0].vue as Float64Array).set(valeurs);
  const avant = arena.blocs()[0].vue,
    offsetAvant = arena.blocs()[0].offset;
  assert.equal(arena.generation(), 0, 'rien n’a encore fait grandir la mémoire');
  // Une allocation qui n'a rien à voir avec ce tampon — un décodage de page replié sur le fil
  // principal en fait autant — remplace le `ArrayBuffer` du module et détache la vue précédente.
  const gros = wasm.arena_alloc(64 * 1024 * 1024);
  assert.ok(gros, 'la grande réservation doit aboutir');
  assert.equal(avant.length, 0, 'la vue d’avant doit bien avoir été détachée par la croissance');
  const apres = arena.blocs()[0];
  assert.equal(arena.generation(), 1, 'une reconstruction, et une seule');
  assert.equal(apres.vue.buffer, wasm.memory.buffer, 'la vue doit porter sur le tampon courant');
  assert.equal(apres.offset, offsetAvant, 'l’offset du bloc ne bouge pas');
  const relues = Array.from(apres.vue as Float64Array);
  for (let i = 0; i < valeurs.length; i++)
    assert.ok(Object.is(relues[i], valeurs[i]), `bloc[${i}] : ${relues[i]} ≠ ${valeurs[i]}`);
  assert.equal(arena.blocs()[0], apres, 'sans nouvelle croissance, les blocs ne sont pas refaits');
  wasm.arena_free(gros, 64 * 1024 * 1024);
  arena.libere();
  assert.deepEqual(arena.blocs(), [], 'un tampon rendu ne porte plus aucune vue');
});

test('liste() relit un compteur écrit dans un bloc puis la liste d’un autre', async () => {
  const wasm = await wasmFrais();
  const arena = reserveArena(wasm, [
    { type: 'u32', longueur: 1 }, // le compteur
    { type: 'f64', longueur: 8 }, // la liste, à sa taille maximale
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

test('blocsJavaScript() rend la même forme que reserveArena() pour les mêmes demandes', async () => {
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
  // Formes attendues, indépendantes des deux implémentations : deux sous-vues de 16 pour le
  // deuxième bloc, trois de 3 pour le troisième, aucune pour le premier.
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

test('un appel de calcul n’alloue rien : math_box_transform_batch travaille dans le tampon réservé', async () => {
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
  assert.equal(compteur.valeur, 0, 'le calcul ne doit provoquer aucune allocation');
  assert.deepEqual(Array.from(out.vue as Float64Array), [-1, -1, -1, 1, 1, 1]);
  arena.libere();
});
