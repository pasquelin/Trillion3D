import { copyFile, cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { writeAvenue } from './avenue.ts';
import { writeChessObj } from './chess-obj.ts';
import { writeChessSet } from './chess-set.ts';
import { writeCourtyard } from './courtyard.ts';
import { geometry } from '../../../packages/sdk-core/src/world/geometry/index.ts';
import { appendSurfacesGltf } from './gltf.ts';
import { fromGeometry, merge } from './mesh.ts';
import { placeObj, writeBoxesObj, type BoxRow } from './obj.ts';
import type { GltfDocument } from './gltf-types.ts';
import { writeRing } from './ring.ts';
import { writeTerrain } from './terrain.ts';
import { writeTerrainTiles } from './terrain-tiles.ts';

/**
 * The scenes built around an imported model (`site/assets/examples/models/`, credited in
 * `CREDITS.md`): an OBJ model is copied into the scene's source folder, scaled to metres and
 * placed, with an original setting written as boxes beside it, and the compiler merges the
 * folder; a glTF model is copied as-is and the setting appended to it as one more node.
 */
async function copyModel(
  models: string,
  name: string,
  files: readonly string[],
  directory: string,
) {
  for (const file of files) await copyFile(resolve(models, name, file), resolve(directory, file));
}

/** A marble bust on a stone pedestal, a wall behind it to catch its shadow. */
async function bust(models: string, directory: string) {
  const source = resolve(models, 'marble-bust');
  await cp(resolve(source, 'textures'), resolve(directory, 'textures'), { recursive: true });
  await copyModel(models, 'marble-bust', ['marble_bust_01.bin'], directory);
  // Per material, boxes `x, y, z, width, height, depth`: the niche's floor and back; the pedestal.
  const surfaces = [
    [0, -1.15, 0, 4, 0.3, 4, 0, 0.3, -1.85, 4, 3.2, 0.3],
    [0, -0.5, 0, 0.42, 1, 0.42, 0, -0.02, 0, 0.5, 0.04, 0.5],
  ].map((boxes) =>
    merge(
      [0, 6].map((at) => {
        const [x, y, z, ...size] = boxes.slice(at, at + 6);
        return fromGeometry(geometry.box(...size).translate(x, y, z));
      }),
    ),
  );
  const gltf: GltfDocument = JSON.parse(
    await readFile(resolve(source, 'marble_bust_01_1k.gltf'), 'utf8'),
  );
  await appendSurfacesGltf(
    gltf,
    directory,
    'Pedestal and niche',
    [
      ['Plaster niche', [0.6, 0.56, 0.5, 1], 0, 0.85],
      ['Dark stone pedestal', [0.16, 0.15, 0.15, 1], 0, 0.5],
    ],
    surfaces.entries(),
  );
}

/** The marble bust alone, nothing around it: an object to place in a scene of one's own. */
async function marbleBust(models: string, directory: string) {
  await cp(resolve(models, 'marble-bust'), directory, { recursive: true });
}

/**
 * A street corner closed on four sides, so a camera turning inside it never looks at the back of
 * a wall: two facades meet at the corner behind a raised pavement and its kerb, a road runs a step
 * lower, and the buildings across it close the square. The lamp's post stands on the pavement,
 * its arm over the door, which is set 5 cm proud of the wall so the two never share a plane.
 * The windows, the shop window and the bulb inside the lamp's globe belong to the model too: a
 * lit pane and the bulb glow by themselves (`Ke`), a dark pane only mirrors the sky.
 */
async function streetCorner(models: string, directory: string) {
  await copyModel(models, 'lantern', ['lantaarn.mtl', 'lantaarn.png'], directory);
  await placeObj(resolve(models, 'lantern/lantaarn.obj'), resolve(directory, 'lantaarn.obj'), {
    scale: 0.033,
    offset: [1.6, 0, -1.9],
  });
  await writeBoxesObj(
    resolve(directory, 'corner.obj'),
    [
      [[0, -0.25, 0], [12, 0.2, 12], 'road'],
      [[0.75, -0.1, -2.175], [9.5, 0.2, 1.65], 'pavement'],
      [[-3.175, -0.1, 2.075], [1.65, 0.2, 6.85], 'pavement'],
      [[1.65, -0.1, -1.275], [7.7, 0.2, 0.15], 'kerb'],
      [[-2.275, -0.1, 2.075], [0.15, 0.2, 6.85], 'kerb'],
      [[0, 2.4, -3.15], [12, 5.2, 0.3], 'wall'],
      [[-4.15, 2.4, 1.4], [0.3, 5.2, 8.8], 'wall'],
      [[5.65, 2.4, 1.4], [0.3, 5.2, 8.8], 'wall'],
      [[0.75, 2.4, 5.65], [9.5, 5.2, 0.3], 'wall'],
      [[-1.2, 1.1, -3.025], [1.1, 2.2, 0.15], 'door'],
    ],
    {
      road: [0.07, 0.07, 0.08],
      pavement: [0.4, 0.4, 0.38],
      kerb: [0.55, 0.55, 0.52],
      wall: [0.5, 0.44, 0.38],
      door: [0.2, 0.12, 0.08],
    },
  );
  const fittings = [
    ...cornerWindow([2.4, 1.4, -3], 'z', 1, [1.8, 1.4], true),
    ...cornerWindow([-1.2, 3.7, -3], 'z', 1, [1.1, 1.3], true),
    ...cornerWindow([2.4, 3.7, -3], 'z', 1, [1.1, 1.3], false),
    ...cornerWindow([-4, 1.5, 0.5], 'x', 1, [1.1, 1.3], false),
    ...cornerWindow([-4, 3.7, 3], 'x', 1, [1.1, 1.3], true),
    ...cornerWindow([5.5, 1.6, 0], 'x', -1, [1.1, 1.3], true),
    ...cornerWindow([5.5, 3.7, 3], 'x', -1, [1.1, 1.3], false),
    ...cornerWindow([-1.5, 1.6, 5.5], 'z', -1, [1.1, 1.3], false),
    ...cornerWindow([2.5, 1.6, 5.5], 'z', -1, [1.1, 1.3], true),
    ...cornerWindow([0.5, 3.7, 5.5], 'z', -1, [1.1, 1.3], true),
    [[-0.55, 3.95, -1.9], [0.12, 0.12, 0.12], 'bulb'],
  ] satisfies BoxRow[];
  const windows = resolve(directory, 'windows.obj');
  await writeBoxesObj(windows, fittings, {});
  await writeFile(
    windows.replace(/\.obj$/, '.mtl'),
    [
      'newmtl frame\nKd 0.16 0.13 0.12\nKs 0 0 0\n',
      'newmtl darkPane\nKd 0.07 0.09 0.13\nKs 0 0 0\n',
      'newmtl litPane\nKd 0 0 0\nKe 1 0.76 0.48\n',
      'newmtl bulb\nKd 0 0 0\nKe 1 0.72 0.4\n',
    ].join('\n'),
  );
}

/**
 * One window on a wall's inner face at `center`: a dark frame 8 cm deep and its pane 2 cm proud
 * of the frame, `axis` the wall's normal and `side` the way it faces into the square.
 */
function cornerWindow(
  [x, y, z]: readonly [number, number, number],
  axis: 'x' | 'z',
  side: 1 | -1,
  [width, height]: readonly [number, number],
  lit: boolean,
): BoxRow[] {
  const box = (depth: number, grow: number): BoxRow['1'] =>
    axis === 'x' ? [depth, height + grow, width + grow] : [width + grow, height + grow, depth];
  const at = (offset: number): BoxRow['0'] =>
    axis === 'x' ? [x + side * offset, y, z] : [x, y, z + side * offset];
  return [
    [at(0.04), box(0.08, 0.2), 'frame'],
    [at(0.085), box(0.03, 0), lit ? 'litPane' : 'darkPane'],
  ];
}

/** Three crates on a dark floor, stacked so one spotlight draws their edges and shadows. */
async function crates(models: string, directory: string) {
  await copyModel(models, 'crate', ['box1.mtl', 'box1.png'], directory);
  const places: readonly [file: string, offset: readonly [number, number, number]][] = [
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

/** A scene modelled in code: it reads no model, its writer draws every file of its folder. */
const inCode =
  (write: (directory: string) => Promise<void>) => (_models: string, directory: string) =>
    write(directory);

export const modelScenes = {
  bust,
  'marble-bust': marbleBust,
  'street-corner': streetCorner,
  crates,
  'a-model-from-obj': inCode(writeChessObj),
  'a-model-from-usdz': inCode(writeChessSet),
  'compressed-textures': inCode(writeCourtyard),
  'detail-by-pixel-error': inCode(writeAvenue),
  'ten-thousand-objects': inCode(writeRing),
  terrain: inCode(writeTerrain),
  'terrain-tiles': inCode(writeTerrainTiles),
};

/** Assembles the source folder of the model scenes `names` under `examples` from `models`. */
export async function writeModelScenes(
  examples: string,
  models: string,
  names: readonly string[] = Object.keys(modelScenes),
) {
  for (const [name, write] of Object.entries(modelScenes)) {
    if (!names.includes(name)) continue;
    const directory = resolve(examples, name, 'source');
    await mkdir(directory, { recursive: true });
    await write(models, directory);
  }
}
