import { createTestContext } from '../core/testContext.fixture.ts';
import { LIGHT_ROW_TEXELS } from './lightTexture.ts';
import { WebglClusterRenderer } from './renderer.ts';
import { readDegraded } from './validation.ts';
import { createHostDrawCamera } from '../../camera/world.ts';
import * as G from '../../host/graph/graph.fixture.ts';
import type { WholeMesh } from '../../cluster/batchMesh.ts';
import type { Light } from '../../../../sdk-core/src/world/light/light.ts';
import { uniformScaleMatrix4 } from '../../../../sdk-core/src/math/matrix/matrix4Trs.ts';

type Context = ReturnType<typeof createTestContext>;

/** A renderer over `lights` and `meshes`; `frame(x)` draws them seen from `x` along the world's axes. */
export function lightFrames(lights: readonly Light[], meshes: WholeMesh[]) {
  const context = createTestContext({ answers: { getExtension: () => ({}) } }),
    renderer = new WebglClusterRenderer(
      context.gl,
      readDegraded(() => {}),
    );
  const camera = createHostDrawCamera();
  const frame = (x = 0) => {
    camera.view.set(viewFrom(x));
    renderer.draw([], { lights }, camera, true, true, meshes);
  };
  return { context, renderer, frame };
}

/** A point lamp at `position` reaching `distance`. */
export function pointLamp(position: [number, number, number], distance: number) {
  const lamp = new G.Light('point', { position, distance });
  lamp.updateMatrixWorld(true);
  return lamp as unknown as Light;
}

/** The last value the frame gave the uniform `name`, its arguments past the location. */
export const lastUniform = (context: Context, call: string, name: string) =>
  context
    .of(call)
    .filter((args) => (args[0] as { uniform: string } | null)?.uniform === name)
    .at(-1)
    ?.slice(1);

/** The light texture uploads of one format ('RGBA' records, 'RED_INTEGER' lists) since `from`. */
export const sent = (context: Context, format: string, from = 0) =>
  context
    .of('texSubImage2D')
    .slice(from)
    .filter((args) => args[4] === LIGHT_ROW_TEXELS && args[6] === format);

/**
 * The grid the frame last listed: `m` (view to grid), its `cells` along each axis, the `every`
 * slots listed first for every fragment, the uploaded `data`, and the cell's `side`.
 */
export function listedGrid(context: Context) {
  const [, m] = lastUniform(context, 'uniformMatrix4fv', 'viewToGrid') as [boolean, Float32Array];
  const cells = lastUniform(context, 'uniform3i', 'gridCells') as number[];
  const [every] = lastUniform(context, 'uniform1i', 'lightGrid') as number[];
  const data = sent(context, 'RED_INTEGER').at(-1)![8] as Int32Array;
  return { m, cells, every, data, side: 1 / m[0] };
}

/** The world box of the grid's `cell`, for a view at the world's origin and axes. */
export function cellBox(m: Float32Array, cell: readonly number[]) {
  const lo = cell.map((c, a) => (c - m[12 + a]) / m[5 * a]) as [number, number, number];
  const hi = lo.map((v, a) => v + 1 / m[5 * a]) as [number, number, number];
  return { lo, hi };
}

/**
 * The slots a fragment at view-space `point` evaluates, as the program walks them
 * (`LIGHT_LOOP_GLSL`): the lights of every fragment and those of its cell, merged in slot order.
 */
export function evaluated(context: Context, point: readonly [number, number, number]) {
  const { m, cells, every, data, side } = listedGrid(context);
  const cell = [0, 1, 2].map((a) =>
    Math.floor(m[a] * point[0] + m[4 + a] * point[1] + m[8 + a] * point[2] + m[12 + a]),
  );
  const slots = [...data.subarray(0, every)];
  const inGrid = cell.every((c, a) => c >= 0 && c < cells[a]);
  if (inGrid) {
    const k = every + (cell[2] * cells[1] + cell[1]) * cells[0] + cell[0];
    slots.push(...data.subarray(data[k], data[k + 1]));
  }
  // Each part in slot order, as the program's merge needs.
  const inOrder = slots.every((slot, n) => n === every || n === 0 || slots[n - 1] < slot);
  return { slots: slots.sort((a, b) => a - b), inOrder, inGrid, box: cellBox(m, cell), side };
}

/** A unit triangle at `x`, height 1, at z 0; its surface a mirror when `mirror`. */
export function triangle(x: number, mirror = false) {
  const geometry = new G.Geometry().setIndex(new G.BufferAttribute(new Uint32Array([0, 1, 2]), 1));
  const at = new Float32Array([-0.5, 0, 0, 0.5, 0, 0, 0, 1, 0]);
  geometry.setAttribute('position', new G.BufferAttribute(at, 3));
  geometry.setAttribute('normal', new G.BufferAttribute(new Float32Array(9), 3));
  const surface = new G.GraphSurface('standard', mirror ? { roughness: 0, metalness: 1 } : {});
  const made = new G.Mesh(geometry, surface);
  made.position.set(x, 0, 0);
  made.updateMatrixWorld(true);
  return made as unknown as WholeMesh;
}

/** A view that looks from `x` along the world's axes: world to view, column-major. */
const viewFrom = (x: number) => uniformScaleMatrix4(new Float64Array(16), 1, [-x, 0, 0]);
