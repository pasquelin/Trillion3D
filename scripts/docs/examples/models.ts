import { copyFile, cp, mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { theatreWorkshop } from '../shadow-theatre/geometry.ts';
import { appendSurfacesGltf } from './gltf.ts';
import { placeObj, writeBoxesObj } from './obj.ts';

/**
 * The scenes built around an imported model (`site/assets/examples/models/`, credited in
 * `CREDITS.md`): an OBJ model is copied into the scene's source folder, scaled to metres and
 * placed, with an original setting written as boxes beside it, and the compiler merges the
 * folder; a glTF model is copied as-is and the setting appended to it as one more node.
 */
async function copyModel(models, name, files, directory) {
  for (const file of files) await copyFile(resolve(models, name, file), resolve(directory, file));
}

/** A marble bust on a stone pedestal, a wall behind it to catch its shadow. */
async function bust(models, directory) {
  const source = resolve(models, 'marble-bust');
  await cp(resolve(source, 'textures'), resolve(directory, 'textures'), { recursive: true });
  await copyFile(resolve(source, 'marble_bust_01.bin'), resolve(directory, 'marble_bust_01.bin'));
  const shop = theatreWorkshop();
  shop.box(0, [0, -1.15, 0], [4, 0.3, 4]);
  shop.box(0, [0, 0.3, -1.85], [4, 3.2, 0.3]);
  shop.box(1, [0, -0.5, 0], [0.42, 1, 0.42]);
  shop.box(1, [0, -0.02, 0], [0.5, 0.04, 0.5]);
  await appendSurfacesGltf(
    JSON.parse(await readFile(resolve(source, 'marble_bust_01_1k.gltf'), 'utf8')),
    directory,
    'Pedestal and niche',
    [
      ['Plaster niche', [0.6, 0.56, 0.5, 1], 0, 0.85],
      ['Dark stone pedestal', [0.16, 0.15, 0.15, 1], 0, 0.5],
    ],
    shop.surfaces,
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
    floor: [0.16, 0.16, 0.18],
  });
}

export const modelScenes = { bust, 'street-corner': streetCorner, crates };

/** Assembles the source folder of the model scenes `names` under `examples` from `models`. */
export async function writeModelScenes(examples, models, names = Object.keys(modelScenes)) {
  for (const [name, write] of Object.entries(modelScenes)) {
    if (!names.includes(name)) continue;
    const directory = resolve(examples, name, 'source');
    await mkdir(directory, { recursive: true });
    await write(models, directory);
  }
}
