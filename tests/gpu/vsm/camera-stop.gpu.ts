// A camera stop releases the representation changes held during the move: their pages are drawn
// again in the frame that marks them, with every other page it reads (#489) — none waits. Until then
// they hold a depth of their extent and are read — never skipped to a coarser level or the far
// proxy, which would drop the shadow. This proof walks the bench's street view of the generated
// facade (`facade-7`: pale walls the sun cuts into sharp shadows, cast through the windows by walls
// the camera does not see), stops, reads the first still frame off the canvas, and counts the
// pixels it shades otherwise than the settled one away from every edge of the settled image.
import test from 'node:test';
import assert from 'node:assert/strict';
import { SUN } from '../../../bench/runner/lighting/lamps.ts';
import { poseAt, VIEWS } from '../../../bench/runner/trajectory/poses.ts';
import { animationFrame, runOnDawn } from '../kit/onDawn.ts';
import { settle } from '../world/proofWorld.ts';
import { canvasImage, openBenchWorld, shadingGap } from './shadowScene.ts';

const WIDTH = 1248,
  HEIGHT = 702;
/** The error the camera cut is asked to hold, in screen pixels: a cluster of the stopped cut
 *  stands at most this far from its place in the settled one. */
const PIXEL_ERROR = 1;
/** The street of the bench: from the `ground` view, `STEPS` trajectory frames along it. */
const START = 6,
  STEPS = 24;

async function stopOnTheStreet() {
  const world = await openBenchWorld('facade-7', [WIDTH, HEIGHT], {
    pixelError: PIXEL_ERROR,
    clearColor: 0x2a303c,
  });
  try {
    world.addLight({ ...SUN, castsShadow: true });
    await world.awaitPages();
    const pose = (step: number) => poseAt(world.bounds, VIEWS.ground.index + START + step);
    const settledStart = !!(await settle(world, pose(0)));
    // The move: one pose per animation frame, no flush, as an interactive camera would do; the
    // cut readback lands between frames and the cut churns.
    for (let step = 1; step <= STEPS; step++) {
      await animationFrame();
      world.render(pose(step));
    }
    // The stop: the first still frame releases what the move held and draws it.
    await animationFrame();
    world.render(pose(STEPS));
    const stopped = await canvasImage(world);
    const settledEnd = !!(await settle(world, pose(STEPS)));
    const settled = await canvasImage(world);
    // The same pose without the sun's shadow: what the shadow darkens on this frame.
    world.setLight(SUN.id, { castsShadow: false });
    const settledOpen = !!(await settle(world, pose(STEPS)));
    const open = await canvasImage(world);
    return {
      settledStart,
      settledEnd: settledEnd && settledOpen,
      ...shadingGap(stopped, settled, open, WIDTH, PIXEL_ERROR),
    };
  } finally {
    world.dispose();
  }
}

test(
  'the first still frame after a move shades as the settled frame, off every edge',
  { timeout: 300_000 },
  async () => {
    const errors: string[] = [];
    const reading = await runOnDawn(stopOnTheStreet, null, errors);
    console.log(JSON.stringify(reading));
    assert.deepEqual(errors, []);
    assert.equal(reading.settledStart, true, 'the start pose settles');
    assert.equal(reading.settledEnd, true, 'the stop pose settles, with and without the shadow');
    // The frame tests shadows: the sun's shadow darkens the inside of areas, not only edges.
    assert.ok(reading.shadowedOffEdge > 0, `${reading.shadowed} shadowed pixels, none off an edge`);
    // Pages drawn at the stop keep their place: the stopped frame shades as the settled one but
    // within `PIXEL_ERROR` of an edge of the settled image, where a cluster of the stopped cut — or
    // of the casters it draws into the pages — may stand that far from its settled place. A shadow
    // that dropped out, or that came from a coarser level, the proxy or the far side of a page,
    // changes the inside of a lit or shaded area, away from every edge.
    assert.equal(
      reading.offEdge,
      0,
      `${reading.offEdge} pixels shaded otherwise than at rest away from any edge (of ${reading.pixels})`,
    );
  },
);
