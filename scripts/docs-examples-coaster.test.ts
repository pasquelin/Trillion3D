import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { joint } from '../packages/sdk-core/src/physics/index.ts';
import {
  energiesOverALap,
  G,
  jointRig,
} from '../packages/sdk-browser/src/physics/joints.fixture.ts';
import { mix } from '../site/examples/kit/opening.ts';

type Vec = [number, number, number];
type Motor = { mode: 'velocity'; target: number; maxForce: number } | null;
type Track = {
  samples: { p: Vec; s: number }[];
  total: number;
  lift: [number, number];
  brake: number;
};
interface Coaster {
  layout(loops: number): Track;
  poseAt(track: Track, s: number): { p: Vec; t: Vec };
  along(track: Track, point: ArrayLike<number>): number;
  ride(track: Track): { path: Vec[]; motorAt(s: number, waiting: boolean): Motor };
  MASS: number;
  LOSS: number;
  CHAIN: number;
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
  new Function(
    'mix',
    `${block}\nreturn { layout, poseAt, along, ride, MASS, LOSS, CHAIN, STATION };`,
  )(mix) as Coaster;

test('the roller coaster moves no car by hand: its train rides a looped path joint', () => {
  assert.match(script, /joint\.path\(train, null, \{[^}]*loop: true/);
  assert.match(script, /damping: \{ linear: LOSS \}/, 'the train declares what it loses');
  assert.doesNotMatch(script, /travel \+=|speedAt/, 'no position integrated by the page');
});

test('a pose on the span closing the track lies between its last sample and its first', () => {
  const { layout, poseAt } = coaster();
  const track = layout(3);
  const last = track.samples[track.samples.length - 1].p;
  const s = (track.samples[track.samples.length - 1].s + track.total) / 2;
  const middle = poseAt(track, s).p.map((v, i) => v - (last[i] + track.samples[0].p[i]) / 2);
  assert.ok(Math.hypot(...middle) < 1e-9, `${middle} off the span's middle`);
});

/**
 * The train from the station, `loss` its damping: held 1 s, up the lift on its chain, then round
 * by gravity until it is back at the station, timed against running the whole track at the
 * station's pace. Asserts it never rolls back; returns its laps, time, farthest off the track and
 * fastest past the crest.
 */
async function lap(loss: number) {
  const { layout, poseAt, along, ride, MASS, STATION } = coaster();
  const track = layout(3);
  const plan = ride(track);
  const rig = await jointRig();
  const start = poseAt(track, 6).p;
  const train = rig.cube(...start);
  train.physics = { type: 'dynamic', mass: MASS, damping: { linear: loss } };
  const rail = joint.path(train, null, {
    path: plan.path,
    loop: true,
    follow: false,
    motor: plan.motorAt(6, true),
  });
  rig.wanted.add(rail);
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
    assert.ok(laps > 0 || s >= last - 0.05, `never rolls back: ${last} to ${s} at ${loss}/s`);
    farthest = Math.max(farthest, Math.hypot(...poseAt(track, s).p.map((v, i) => v - at[i])));
    if (s > crest) fastest = Math.max(fastest, (s - last) * 60);
    last = s;
    const motor = plan.motorAt(s, waiting);
    if (motor !== rail.motor) rail.motor = motor;
  }
  return {
    laps,
    seconds: steps / 60,
    bound: bound / 60,
    at: last,
    total: track.total,
    farthest,
    fastest,
  };
}

test('the train climbs the lift on its chain, runs a lap by gravity and never leaves the track', async () => {
  const { LOSS, STATION } = coaster();
  const ride = await lap(LOSS);
  assert.ok(
    ride.laps === 1,
    `a lap within ${ride.bound} s: ${ride.seconds} s, at ${ride.at} of ${ride.total}`,
  );
  assert.ok(ride.farthest < 0.1, `held on the track: ${ride.farthest} m off at most`);
  assert.ok(ride.fastest > 3 * STATION, `gravity drives it past the crest: ${ride.fastest} m/s`);
});

test('the lap holds with twice the loss the train declares', async () => {
  const ride = await lap(2 * coaster().LOSS);
  assert.ok(ride.laps === 1, `a lap at twice the loss: at ${ride.at} of ${ride.total}`);
});

test('with nothing lost, a body left at the crest keeps its energy round the whole track', async () => {
  const { layout, CHAIN } = coaster();
  const { samples, lift } = layout(3);
  const crest = samples.findIndex(({ s }) => s >= lift[1]);
  const path = [...samples.slice(crest), ...samples.slice(0, crest)].map(({ p }) => p);
  // Frictionless, it comes back over the crest at the chain's pace, the lift's height regained.
  const { drift, fastest, lapped } = await energiesOverALap(path, CHAIN);
  assert.ok(lapped, 'round the track and over the crest again');
  // The step's own error: gravity's work over one step at the fastest speed (g·v·dt).
  const tolerance = (G * fastest) / 60;
  assert.ok(drift < tolerance, `energy off by ${drift} J/kg over a lap, ${tolerance} allowed`);
});
