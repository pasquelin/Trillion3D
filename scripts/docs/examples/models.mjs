import { copyFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { placeObj, writeBoxesObj } from './obj.mjs';

/**
 * The scenes built around an imported model (`site/assets/examples/models/`, credited in
 * `CREDITS.md`): the model is copied into the scene's source folder, scaled to metres and placed,
 * with an original setting written as boxes beside it; the compiler merges the folder.
 */
const CONCRETE = [0.42, 0.42, 0.4],
  DARK = [0.16, 0.16, 0.18];

async function copyModel(models, name, files, directory) {
  for (const file of files) await copyFile(resolve(models, name, file), resolve(directory, file));
}

/** A helicopter parked on a square pad with its painted circle of corner blocks. */
async function helipad(models, directory) {
  await copyModel(models, 'helicopter', ['helicopter.mtl', 'helicopter1.bmp'], directory);
  await placeObj(
    resolve(models, 'helicopter/helicopter.obj'),
    resolve(directory, 'helicopter.obj'),
    { scale: 0.06, offset: [0, -0.1, -2] },
  );
  const corners = [-1, 1].flatMap((x) =>
    [-1, 1].map((z) => [[x * 5.6, 0.15, z * 5.6], [0.5, 0.3, 0.5], 'paint']),
  );
  await writeBoxesObj(
    resolve(directory, 'pad.obj'),
    [[[0, -0.15, 0], [12, 0.3, 12], 'concrete'], ...corners],
    { concrete: CONCRETE, paint: [0.85, 0.75, 0.15] },
  );
}

/** A street lamp at a building corner: its post stands on the pavement, its arm reaches the wall. */
async function streetCorner(models, directory) {
  await copyModel(models, 'lantern', ['lantaarn.mtl', 'lantaarn.png'], directory);
  await placeObj(resolve(models, 'lantern/lantaarn.obj'), resolve(directory, 'lantaarn.obj'), {
    scale: 0.033,
    offset: [1.6, 0, 0.4],
  });
  await writeBoxesObj(
    resolve(directory, 'corner.obj'),
    [
      [[0, -0.1, 0], [12, 0.2, 12], 'pavement'],
      [[0, 2.5, -3.15], [12, 5, 0.3], 'wall'],
      [[-4.15, 2.5, 0], [0.3, 5, 6], 'wall'],
      [[-1.2, 1.4, -3.05], [1.1, 2.2, 0.1], 'door'],
    ],
    { pavement: [0.4, 0.4, 0.38], wall: [0.5, 0.44, 0.38], door: [0.2, 0.12, 0.08] },
  );
}

/** Three crates on a dark floor, stacked so one spotlight draws their edges and shadows. */
async function crates(models, directory) {
  await copyModel(models, 'crate', ['box1.mtl', 'box1.png'], directory);
  const places = [
    ['crate-a.obj', [-0.9, 0, 0.3]],
    ['crate-b.obj', [0.7, 0, -0.5]],
    ['crate-c.obj', [-0.1, 1.15, -0.1]],
  ];
  for (const [file, offset] of places)
    await placeObj(resolve(models, 'crate/box1.obj'), resolve(directory, file), {
      scale: 0.01,
      offset,
    });
  await writeBoxesObj(resolve(directory, 'floor.obj'), [[[0, -0.1, 0], [8, 0.2, 8], 'floor']], {
    floor: DARK,
  });
}

export const modelScenes = { helipad, 'street-corner': streetCorner, crates };

/** Assembles the source folder of every model scene under `examples` from `models`. */
export async function writeModelScenes(examples, models) {
  for (const [name, write] of Object.entries(modelScenes)) {
    const directory = resolve(examples, name, 'source');
    await mkdir(directory, { recursive: true });
    await write(models, directory);
  }
}
