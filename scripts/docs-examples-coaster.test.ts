import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { joint } from '../packages/sdk-core/src/physics/index.ts';
import { jointRig } from '../packages/sdk-browser/src/physics/joints.fixture.ts';
import { mix } from '../site/examples/kit/opening.ts';

type Vec = [number, number, number];
type Motor = { mode: 'velocity'; target: number; maxForce: number } | null;
type Track = { samples: { p: Vec }[]; total: number; lift: [number, number]; brake: number };
interface Coaster {
  layout(loops: number): Track;
  poseAt(track: Track, s: number): { p: Vec; t: Vec };
  along(track: Track, point: ArrayLike<number>): number;
  ride(track: Track): { path: Vec[]; motorAt(s: number, waiting: boolean): Motor };
  MASS: number;
  STATION: number;
}

// The page's own track and ride, from its module: the lines before its meshes use no engine.
const page = readFileSync(
  new URL('../site/examples/ride-a-roller-coaster.html', import.meta.url),
  'utf8',
);
const script = page.slice(page.indexOf('<script type="module">'), page.indexOf('</script>'));
const block = page.slice(page.indexOf('const plus ='), page.indexOf("// The track's meshes"));
const coaster = () =>
  new Function('mix', `${block}\nreturn { layout, poseAt, along, ride, MASS, STATION };`)(
    mix,
  ) as Coaster;

test('the roller coaster moves no car by hand: its train rides a looped path joint', () => {
  assert.match(script, /joint\.path\(train, null, \{[^}]*loop: true/);
  assert.doesNotMatch(script, /travel \+=|speedAt/, 'no position integrated by the page');
});

test('the train climbs the lift on its chain, runs a lap by gravity and never leaves the track', async () => {
  const { layout, poseAt, along, ride, MASS, STATION } = coaster();
  const track = layout(3);
  const plan = ride(track);
  const rig = await jointRig();
  const start = poseAt(track, 6).p;
  const train = rig.cube(...start);
  train.physics = { type: 'dynamic', mass: MASS };
  const rail = joint.path(train, null, {
    path: plan.path,
    loop: true,
    follow: false,
    motor: plan.motorAt(6, true),
  });
  rig.wanted.add(rail);
  // Timed against running the whole track at the station's pace: gravity must beat it.
  const bound = Math.ceil((track.total / STATION) * 60);
  let last = 6,
    laps = 0,
    farthest = 0,
    fastest = 0,
    steps = 0;
  const [, crest] = track.lift;
  while (steps < bound && !(laps === 1 && last >= 6)) {
    const waiting = steps < 60;
    rig.run(1);
    steps++;
    const at = rig.at(train);
    const s = along(track, at);
    if (s < last - track.total / 2) laps++;
    assert.ok(laps > 0 || s >= last - 0.05, `never rolls back: ${last} to ${s}`);
    farthest = Math.max(farthest, Math.hypot(...poseAt(track, s).p.map((v, i) => v - at[i])));
    if (s > crest) fastest = Math.max(fastest, (s - last) * 60);
    last = s;
    const motor = plan.motorAt(s, waiting);
    if (motor !== rail.motor) rail.motor = motor;
  }
  assert.ok(laps === 1, `a lap within ${bound / 60} s: ${steps / 60} s, at ${last} of ${track.total}`);
  assert.ok(farthest < 0.1, `held on the track: ${farthest} m off at most`);
  assert.ok(fastest > 3 * STATION, `gravity drives it past the crest: ${fastest} m/s`);
});
