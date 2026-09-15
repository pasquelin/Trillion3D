import test from 'node:test';
import assert from 'node:assert/strict';
import type * as THREE from 'three';
import { createTexturePriority, type MaterialLayerIndex } from './webgpuTexturePriority.ts';
import type { TextureJob } from './webgpuAtlasJobs.ts';
import { referenceTexturePriority } from './bench/oracles/h3PriorityOracle.ts';

// H3-2 : les poids de priorité passent de deux tableaux JavaScript agrandis d'une case par couche à
// deux `Float64Array` dont la capacité double. Ce que le module rend — la file réordonnée — ne
// change pas. Les poids ne sont pas toujours entiers : un maillage transparent en apporte
// `count / 3`, et l'addition IEEE 754 d'un `Float64Array` est celle d'un `number`, à l'octet près.
// Les cases au-delà de la dernière couche vue valent zéro des deux côtés, que la capacité les
// couvre ou non, si bien qu'un travail dont le slot dépasse les poids pèse zéro comme avant.

/** Générateur à graine fixe : les deux implémentations voient exactement les mêmes coupes. */
function graine(depart: number) {
  let etat = depart >>> 0;
  return () => {
    etat = (etat ^ (etat << 13)) >>> 0;
    etat = (etat ^ (etat >>> 17)) >>> 0;
    etat = (etat ^ (etat << 5)) >>> 0;
    return etat / 4294967296;
  };
}

const noop = () => {};
function travail(kind: TextureJob['kind'], slot: number, stage: number, nextRow: number) {
  return {
    kind,
    slot,
    classIndex: 0,
    layer: slot,
    level: 0,
    stage,
    bytes: 4,
    rows: 1,
    bytesPerRow: 4,
    nextRow,
    failures: 0,
    uploadRows: noop,
  } as TextureJob;
}

type Coupe = {
  materiaux: number;
  couches: number;
  pages: number;
  transparents: number;
  travaux: number;
  slots: number;
  sansIndex?: boolean;
};

function coupe(options: Coupe, depart: number) {
  const alea = graine(depart);
  const index: MaterialLayerIndex = new Map();
  const liste: THREE.Material[] = [];
  for (let i = 0; i < options.materiaux; i++) {
    const material = { id: i } as unknown as THREE.Material;
    index.set(material, {
      color: [Math.floor(alea() * options.couches), Math.floor(alea() * options.couches)],
      data: [Math.floor(alea() * options.couches), Math.floor(alea() * options.couches)],
    });
    liste.push(material);
  }
  const pick = () => liste[Math.floor(alea() * options.materiaux)];
  const requested = Array.from({ length: options.pages }, () => ({
    material: pick(),
    triangles: 1 + Math.floor(alea() * 4000),
  }));
  const blend = Array.from({ length: options.transparents }, () => ({
    material: pick(),
    count: 1 + Math.floor(alea() * 9000),
  }));
  const jobs = Array.from({ length: options.travaux }, () =>
    travail(
      alea() < 0.5 ? 'color' : 'data',
      Math.floor(alea() * options.slots),
      alea() < 0.4 ? 0 : 1,
      alea() < 0.3 ? 1 + Math.floor(alea() * 8) : 0,
    ),
  );
  const entrees = () =>
    ({ index: options.sansIndex ? undefined : index, requested, blend }) as never;
  return { jobs, avant: referenceTexturePriority(entrees), apres: createTexturePriority(entrees) };
}

const COUPES: Coupe[] = [
  { materiaux: 400, couches: 200, pages: 3000, transparents: 120, travaux: 48, slots: 260 },
  { materiaux: 60, couches: 5000, pages: 600, transparents: 40, travaux: 32, slots: 6000 },
  { materiaux: 3, couches: 4, pages: 5, transparents: 2, travaux: 12, slots: 900 },
  {
    materiaux: 8,
    couches: 16,
    pages: 40,
    transparents: 8,
    travaux: 20,
    slots: 20,
    sansIndex: true,
  },
  { materiaux: 4, couches: 8, pages: 10, transparents: 2, travaux: 1, slots: 8 },
  { materiaux: 4, couches: 8, pages: 0, transparents: 0, travaux: 24, slots: 8 },
  { materiaux: 1, couches: 1, pages: 1, transparents: 1, travaux: 2, slots: 1 },
  { materiaux: 12, couches: 3, pages: 200, transparents: 200, travaux: 64, slots: 3 },
];

test('H3-2 : la file réordonnée est exactement celle d’avant, sur 200 coupes tirées', () => {
  for (let essai = 0; essai < 200; essai++) {
    const options = COUPES[essai % COUPES.length];
    const { jobs, avant, apres } = coupe(options, 1 + essai * 7919);
    // Plusieurs images de suite sur la même file : les poids sont remis à zéro et la capacité,
    // elle, ne rétrécit jamais — l'ordre ne doit pas s'en apercevoir.
    for (let image = 0; image < 3; image++) {
      const attendu = jobs.slice();
      const obtenu = jobs.slice();
      avant.order(attendu);
      apres.order(obtenu);
      assert.equal(obtenu.length, attendu.length);
      for (let i = 0; i < attendu.length; i++)
        assert.ok(
          Object.is(obtenu[i], attendu[i]),
          `coupe ${essai}, image ${image}, rang ${i} : slot ${obtenu[i].slot} au lieu de ${attendu[i].slot}`,
        );
    }
  }
});

// Une couche vue tard force la croissance des poids au milieu d'une image : ce qui a déjà été
// accumulé doit survivre au changement de tableau, sinon le poids d'une couche basse retomberait.
test('H3-2 : une couche très haute vue en dernier ne perd pas les poids déjà accumulés', () => {
  const bas = { id: 'bas' } as unknown as THREE.Material;
  const haut = { id: 'haut' } as unknown as THREE.Material;
  const index: MaterialLayerIndex = new Map([
    [bas, { color: [1], data: [] }],
    [haut, { color: [4096], data: [] }],
  ]);
  const requested = [
    { material: bas, triangles: 1000 },
    { material: haut, triangles: 1 },
  ];
  const entrees = () => ({ index, requested, blend: [] }) as never;
  const attendu = [travail('color', 4096, 1, 0), travail('color', 1, 1, 0)];
  const obtenu = attendu.slice();
  referenceTexturePriority(entrees).order(attendu);
  createTexturePriority(entrees).order(obtenu);
  assert.deepEqual(
    obtenu.map((job) => job.slot),
    attendu.map((job) => job.slot),
  );
  assert.equal(obtenu[0].slot, 1, 'la couche lourde vue en premier reste devant');
});
