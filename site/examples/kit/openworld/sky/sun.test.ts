import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { discVisible } from './atmosphere.ts';
import { elevation, moonDirection, moonLit, moonPhase, sunDirection } from './sun.ts';

const EQUINOX = { latitude: 40, dayOfYear: 80 };
const JUNE = { latitude: 40, dayOfYear: 172 };

/** The first and last solar hours, 0.01 h apart, at which the sun's disc shows. */
function daylightSpan(almanac: { latitude: number; dayOfYear: number }) {
  const shown: number[] = [];
  for (let hours = 0; hours < 24; hours += 0.01)
    if (discVisible(elevation(sunDirection(almanac, hours))) > 0) shown.push(hours);
  return { rise: shown[0], set: shown[shown.length - 1] };
}

describe('sun path', () => {
  it('rises near 6 h and sets near 18 h at the equinox', () => {
    const { rise, set } = daylightSpan(EQUINOX);
    assert.ok(Math.abs(rise - 6) < 0.25, `sunrise ${rise}`);
    assert.ok(Math.abs(set - 18) < 0.25, `sunset ${set}`);
  });

  it('gives about fifteen hours of day at 40° N in June', () => {
    const { rise, set } = daylightSpan(JUNE);
    assert.ok(set - rise > 14.5 && set - rise < 15.5, `day ${set - rise} h`);
  });

  it('stands highest at noon, at 90° − latitude + declination', () => {
    let highest = { hours: 0, h: -Infinity };
    for (let hours = 0; hours < 24; hours += 0.25) {
      const h = elevation(sunDirection(JUNE, hours));
      if (h > highest.h) highest = { hours, h };
    }
    assert.equal(highest.hours, 12);
    assert.ok(Math.abs((highest.h * 180) / Math.PI - (90 - 40 + 23.44)) < 0.5);
  });

  it('rises in the east (+X) and sets in the west, passing south (+Z) at noon', () => {
    assert.ok(sunDirection(EQUINOX, 7)[0] > 0);
    assert.ok(sunDirection(EQUINOX, 17)[0] < 0);
    assert.ok(sunDirection(EQUINOX, 12)[2] > 0);
  });

  it('is a unit vector', () => {
    const [x, y, z] = sunDirection(JUNE, 9.3);
    assert.ok(Math.abs(Math.hypot(x, y, z) - 1) < 1e-12);
  });
});

describe('moon', () => {
  it('keeps its phase in [0, 1) and is full when it faces the sun', () => {
    for (let day = 1; day <= 365; day += 7) {
      const phase = moonPhase(day, 3);
      assert.ok(phase >= 0 && phase < 1);
    }
    assert.equal(moonLit(0), 0);
    assert.equal(moonLit(0.5), 1);
  });

  it('stands opposite the sun at full moon', () => {
    const sun = sunDirection(EQUINOX, 0);
    const moon = moonDirection(EQUINOX, 0, 0.5);
    assert.ok(sun[1] < 0 && moon[1] > 0);
  });
});
