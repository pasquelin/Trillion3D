// A group of crystals placed as the instances page places them, the CPU's row write of each, and
// the compose rows pass (`composeRow`, the shipped WGSL) over such a table, run in JavaScript.
import { object } from '../../../sdk-core/src/world/object/index.ts';
import { geometry } from '../../../sdk-core/src/world/geometry/index.ts';
import { Object3D } from '../../../sdk-core/src/world/object/object3d.ts';
import { updateTransformTree } from '../../../sdk-core/src/math/transform-tree/pass.ts';
import { shaderRun } from '../texture/shaderRun.fixture.ts';
import { random } from '../page/cut/cutRuleChecks.fixture.ts';
import { PAGE_INFO_STRIDE } from '../visibility/buffer.ts';
import { ROW_PLACEMENT_WORD } from '../webgpu/row/rowPlacement.ts';
import { ROW_HIZ_SLOT_WORD } from '../webgpu/row/pageRow.ts';
import { COMPOSE_ROWS_WGSL } from './gpuComposeWgsl.ts';
import { DOUBLE_HELPERS, countLeadingZeros, pair } from './composeDoubles.fixture.ts';

export const WORDS = PAGE_INFO_STRIDE / 4,
  N = 120;
const pairs = (values: ArrayLike<number>) => Array.from(values, pair);

/** A group of `N` crystals placed as the instances page places them, each on its own row. */
export function crystals() {
  const next = random(11),
    scene = object.group(),
    group = object.group(),
    shape = geometry.box(0.1, 0.1, 0.1);
  scene.add(group);
  const meshes = Array.from({ length: N }, () => {
    const mesh = object.mesh(shape),
      reach = next() ** 0.7,
      angle = next() * Math.PI * 2;
    mesh.position.set(
      Math.cos(angle) * (0.6 + reach * 6),
      (next() - 0.5) * 0.4,
      Math.sin(angle) * 6,
    );
    mesh.rotation.set(next() * 6.3, next() * 6.3, 0);
    mesh.scale.setScalar(0.6 + next() * 1.4);
    group.add(mesh);
    return mesh;
  });
  const settle = () => updateTransformTree(Object3D._treeOf(scene));
  return { group, meshes, settle };
}

/** The CPU's row write (`../webgpu/row/pageRow.ts`): the world as a `Float32Array` stores it, the
 *  rank, the row's own Hi-Z slot, and material words that no pose touches. */
export function cpuTable(meshes: readonly { matrixWorld: { elements: ArrayLike<number> } }[]) {
  const buffer = new ArrayBuffer(N * PAGE_INFO_STRIDE),
    floats = new Float32Array(buffer),
    ints = new Uint32Array(buffer);
  meshes.forEach((mesh, row) => {
    const base = row * WORDS;
    for (let k = 16; k < WORDS; k++) ints[base + k] = (row * 2654435761 + k * 40503) >>> 0;
    floats.set(mesh.matrixWorld.elements, base);
    ints[base + ROW_PLACEMENT_WORD] = row;
    ints[base + ROW_HIZ_SLOT_WORD] = row;
  });
  return ints;
}

/** The compose rows pass over `table`: each row's root linked to slot 0 at `parent`'s world. */
export function composeRows(
  table: Uint32Array,
  parent: ArrayLike<number>,
  locals: readonly ArrayLike<number>[],
  spheres?: { out: number[]; boxes: ArrayLike<number>; cast: boolean },
) {
  const words = Array.from(table);
  const run = shaderRun<{ composeRow(row: number): void }>(
    COMPOSE_ROWS_WGSL,
    [...DOUBLE_HELPERS, 'toF32', 'fromF32', 'composed', 'composeSphere', 'composeRow'],
    {
      countLeadingZeros,
      params: { rootCount: N, rowCount: N, spheres: spheres?.cast ? 1 : 0 },
      // The shader's two constants, `1 + 2⁻²⁰` and `2⁻⁴⁴`, as its f32 literals hold them.
      SPHERE_GROWTH: 1 + 2 ** -20,
      CENTRE_ERROR: 2 ** -44,
      arrayLength: (ref: { get(): unknown[] }) => ref.get().length,
      spheres: spheres?.out ?? [],
      localBoxes: spheres ? pairs(spheres.boxes) : [],
      parentOf: new Array(N).fill(0),
      parents: pairs(parent),
      locals: locals.flatMap((local) => pairs(local)),
      table: words,
    },
  );
  for (let row = 0; row < N; row++) run.composeRow(row);
  return Uint32Array.from(words);
}
