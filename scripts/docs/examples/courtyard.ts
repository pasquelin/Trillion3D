import { writeCourtyardTextures } from './courtyard-textures.ts';
import { SceneGltf } from './gltf-scene.ts';
import { disc, lathe, merge, moved, pairs } from './mesh.ts';
import { box } from './solids.ts';

/**
 * `compressed-textures`: a courtyard of glazed tiles and brick around a marble fountain, every
 * surface textured with its own drawn colour and relief, so block compression has colour maps
 * and normal maps to prove itself on.
 */
export async function writeCourtyard(directory: string) {
  const textures = await writeCourtyardTextures(directory),
    gltf = new SceneGltf(),
    tiles = gltf.material('glazed tiles', [1, 1, 1], {
      roughness: 0.3,
      texture: textures.tiles,
      normalTexture: textures['tiles-normal'],
    }),
    brick = gltf.material('brick', [1, 1, 1], {
      roughness: 0.85,
      texture: textures.bricks,
      normalTexture: textures['bricks-normal'],
    }),
    marble = gltf.material('marble', [1, 1, 1], { roughness: 0.25, texture: textures.marble }),
    water = gltf.material('water', [0.16, 0.36, 0.42], { roughness: 0.05, metallic: 0.2 });
  // Metres: the floor repeats its eight tiles every two metres, the walls their bricks every 2.4.
  const [side, high, thick] = [16, 4.2, 0.5],
    brickScale = 1 / 2.4,
    walls = merge([
      moved(box(side + thick * 2, high, thick, brickScale), [0, high / 2, -side / 2 - thick / 2]),
      moved(box(thick, high, side, brickScale), [-side / 2 - thick / 2, high / 2, 0]),
      moved(box(thick, high, side, brickScale), [side / 2 + thick / 2, high / 2, 0]),
    ]);
  // The fountain: a basin on a foot, a column, a bowl and a finial, all turned.
  const fountain = lathe(
      pairs([
        0, 0, 2.6, 0, 2.7, 0.1, 2.7, 0.55, 2.55, 0.62, 2.45, 0.6, 2.45, 0.3, 0.5, 0.3, 0.42, 0.9,
        0.36, 1.6, 0.9, 1.75, 1.2, 1.95, 1.15, 2.02, 0.35, 2, 0.25, 2.4, 0.3, 2.6, 0.12, 2.75, 0,
        2.8,
      ]),
      128,
      { repeat: [4, 1.2] },
    ),
    column = lathe(
      pairs([
        0.42, 0, 0.42, 0.25, 0.34, 0.35, 0.3, 0.4, 0.26, 3.2, 0.34, 3.35, 0.42, 3.5, 0.42, 3.62,
      ]),
      48,
      { repeat: [1, 1.2] },
    );
  const meshes = [
      gltf.mesh('floor', [[moved(box(side, 0.2, side, 0.5), [0, -0.1, 0]), tiles]]),
      gltf.mesh('walls', [[walls, brick]]),
      gltf.mesh('fountain', [[fountain, marble]]),
      gltf.mesh('water', [[disc(2.45, 0.48, 96), water]]),
    ],
    columnMesh = gltf.mesh('column', [[column, marble]]),
    children = meshes.map((mesh) => gltf.node({ mesh }));
  for (const x of [-1, 1])
    for (const z of [-6, -2, 2, 6])
      children.push(gltf.node({ mesh: columnMesh, translation: [x * 6.6, 0, z] }));
  for (const x of [-4, 0, 4])
    children.push(gltf.node({ mesh: columnMesh, translation: [x, 0, -6.6] }));
  gltf.node({ name: 'courtyard', scale: [0.5, 0.5, 0.5], children }, true);
  await gltf.write(directory, 'courtyard');
}
