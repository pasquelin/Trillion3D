import test from 'node:test';
import assert from 'node:assert/strict';
import { random } from '../../page/cut/cutRuleChecks.fixture.ts';
import { SHADOW_CULL_SHADER, SHADOW_LIGHT_CULL_SHADER } from './cullShader.ts';

const f = Math.fround;

/** develop's cone test, exact (f64): outside when the angle to the axis passes the half angle
 *  plus the sphere's angular radius. */
function outsideExact(delta: number[], axis: number[], r: number, h: number) {
  const d = Math.hypot(delta[0], delta[1], delta[2]);
  if (!(h < 3.14159 && d > r)) return false;
  const along = (delta[0] * axis[0] + delta[1] * axis[1] + delta[2] * axis[2]) / d;
  return Math.acos(Math.min(1, Math.max(-1, along))) - Math.asin(Math.min(1, r / d)) > h;
}

/** develop's shader test (`acos`, `asin`), its inputs and results rounded to f32. */
function outsideByAngles(delta: number[], axis: number[], r: number, h: number) {
  const [dx, dy, dz, rr, hh] = [f(delta[0]), f(delta[1]), f(delta[2]), f(r), f(h)];
  const d = f(Math.sqrt(f(f(f(dx * dx) + f(dy * dy)) + f(dz * dz))));
  if (!(hh < f(3.14159) && d > rr)) return false;
  const along = f(f(f(dx * f(axis[0])) + f(dy * f(axis[1]))) + f(dz * f(axis[2])));
  const cosine = Math.min(1, Math.max(-1, f(along / d)));
  return f(f(Math.acos(cosine)) - f(Math.asin(Math.min(1, f(rr / d))))) > hh;
}

/** The shader's test by cosines (`keepCaster`), every operation rounded to f32. */
function outsideByCosines(delta: number[], axis: number[], r: number, h: number) {
  const dx = f(delta[0]),
    dy = f(delta[1]),
    dz = f(delta[2]),
    rr = f(r),
    hh = f(h);
  const d = f(Math.sqrt(f(f(f(dx * dx) + f(dy * dy)) + f(dz * dz))));
  if (!(hh < f(3.14159) && d > rr)) return false;
  const ch = f(Math.cos(hh)),
    sh = f(Math.sin(hh));
  const tangent = f(Math.sqrt(Math.max(f(f(d * d) - f(rr * rr)), 0)));
  const along = f(f(f(dx * f(axis[0])) + f(dy * f(axis[1]))) + f(dz * f(axis[2])));
  const limit = f(f(ch * tangent) - f(sh * rr));
  return f(f(sh * tangent) + f(ch * rr)) > 0 && along < f(limit - f(f(1e-4) * d));
}

/** How far outside the cone a sphere is, radians: negative inside. */
function margin(delta: number[], axis: number[], r: number, h: number) {
  const d = Math.hypot(delta[0], delta[1], delta[2]);
  const along = (delta[0] * axis[0] + delta[1] * axis[1] + delta[2] * axis[2]) / d;
  return Math.acos(Math.min(1, Math.max(-1, along))) - Math.asin(Math.min(1, r / d)) - h;
}

test('the cone test by cosines never drops a caster the exact angles keep, and agrees with develop past a margin', () => {
  const next = random(925);
  const unit = () => {
    const [z, a] = [next() * 2 - 1, next() * 2 * Math.PI];
    return [Math.sqrt(1 - z * z) * Math.cos(a), Math.sqrt(1 - z * z) * Math.sin(a), z];
  };
  // Half angles from a sliver to a hemisphere and past it, near 3.14159; sizes over twelve decades.
  const halves = [1e-6, 0.01, 0.3, Math.PI / 4, Math.PI / 2, 2, 3, 3.1415, 3.14159];
  let disagreed = 0,
    cases = 0;
  for (let n = 0; n < 400000; n++) {
    const axis = unit(),
      h = n % 3 ? next() * Math.PI : halves[n % halves.length];
    const d = 10 ** (next() * 8 - 3),
      r = n % 7 ? d * (next() < 0.2 ? 1 - next() * 1e-5 : next()) : 0;
    const delta = unit().map((v) => v * d);
    const byAngles = outsideByAngles(delta, axis, r, h),
      byCosines = outsideByCosines(delta, axis, r, h);
    cases++;
    if (byCosines && !outsideExact(delta, axis, r, h))
      assert.fail(`dropped a kept caster: ${JSON.stringify({ delta, axis, r, h })}`);
    if (byAngles !== byCosines) {
      disagreed++;
      assert.ok(margin(delta, axis, r, h) < 2e-3, 'only a sphere just past the cone may be kept');
    }
  }
  assert.ok(disagreed < cases * 0.01, `${disagreed} of ${cases} disagree`);
});

test('the cull uses no inverse trigonometry', () => {
  for (const wgsl of [SHADOW_CULL_SHADER, SHADOW_LIGHT_CULL_SHADER])
    assert.doesNotMatch(wgsl, /\bacos\(|\basin\(/);
  // The comparison `outsideByCosines` emulates, as the shader writes it.
  assert.match(SHADOW_CULL_SHADER, /let limit=ch\*tangent-sh\*sphere\.radius;/);
  assert.match(
    SHADOW_CULL_SHADER,
    /sh\*tangent\+ch\*sphere\.radius>0\.0&&along<limit-1e-4\*distance/,
  );
});
