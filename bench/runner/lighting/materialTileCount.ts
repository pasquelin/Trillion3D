// Fragments the material classes rasterise per pixel of the atrium (#1369): each class pass drew
// a full-screen triangle the material depth test refused off its pixels, and now draws the screen
// tiles its pixels are in (`materialTilesWgsl.ts`). Each box of the atrium is a material, of
// `--classes` classes in turn. COUNTED, never timed: the fragments that pass the test, and so the
// material evaluations — one per covered pixel —, are the same before and after.
//
//   node bench/runner/lighting/materialTileCount.ts [--width 3456] [--height 2234] [--classes 6]
import { parseArgs } from 'node:util';
import { camera } from '../../../packages/sdk-browser/src/lighting/tiles/tileCamera.fixture.ts';
import {
  classFragments,
  classifyTiles,
} from '../../../packages/sdk-browser/src/webgpu/core/materialTiles.fixture.ts';
import { ATRIUM_POSES, atriumDepth } from './lightTileAtrium.ts';

/** Per pixel of a `width` × `height` pose: fragments rasterised before and after, and the
 *  material evaluations (covered pixels). */
export function countClassFragments(width: number, height: number, classes: number, pose = 0) {
  const { eye, yaw, pitch } = ATRIUM_POSES[pose];
  const view = camera(eye, yaw, pitch, 60, width, height);
  const shown = new Int32Array(width * height);
  atriumDepth(view, undefined, shown);
  const slotAt = (x: number, y: number) => {
    const box = shown[y * width + x];
    return box < 0 ? classes : box % classes;
  };
  const { lists } = classifyTiles(width, height, classes, slotAt);
  const { full, tiled } = classFragments(width, height, lists);
  const pixels = width * height,
    covered = shown.reduce((n, box) => n + +(box >= 0), 0);
  return { full: full / pixels, tiled: tiled / pixels, evaluations: covered / pixels };
}

async function main() {
  const { values } = parseArgs({
    options: {
      width: { type: 'string', default: '3456' },
      height: { type: 'string', default: '2234' },
      classes: { type: 'string', default: '6' },
    },
  });
  const [width, height, classes] = [values.width, values.height, values.classes].map(Number);
  const rows = ATRIUM_POSES.map((_, pose) => {
    const count = countClassFragments(width, height, classes, pose);
    return {
      pose,
      before: count.full.toFixed(2),
      after: count.tiled.toFixed(2),
      evaluations: count.evaluations.toFixed(2),
    };
  });
  console.log(`Atrium, ${classes} classes, ${width} × ${height}: fragments rasterised per pixel`);
  console.table(rows);
}

if (import.meta.main) await main();
