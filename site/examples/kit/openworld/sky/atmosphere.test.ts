import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { exposureFor, nightFactor, skyRadiance, transmittance, twilight } from './atmosphere.ts';
import { daylight } from './daylight.ts';

const DEG = Math.PI / 180;
const HAZE = 0.08;
const at = (hours: number) =>
  daylight({ latitude: 40, dayOfYear: 172, hours, moonPhase: 0.5, haze: HAZE });

describe('atmosphere', () => {
  it('lets red through more than green, and green more than blue', () => {
    for (let degrees = 0; degrees <= 90; degrees += 5) {
      const [r, g, b] = transmittance(degrees * DEG, HAZE);
      assert.ok(r > g && g > b, `${degrees}°`);
    }
  });

  it('dims and reddens the sun as it sinks: every channel and blue/red fall monotonically', () => {
    let previous = transmittance(90 * DEG, HAZE);
    for (let degrees = 85; degrees >= 0; degrees -= 5) {
      const t = transmittance(degrees * DEG, HAZE);
      for (let c = 0; c < 3; c++) assert.ok(t[c] < previous[c]);
      assert.ok(t[2] / t[0] < previous[2] / previous[0]);
      previous = t;
    }
  });

  it('warms the key light from noon to sunset (blue over red falls)', () => {
    let previous = Infinity;
    for (let hours = 12; hours <= 19; hours += 0.5) {
      const { colour } = at(hours).key;
      const cool = colour[2] / colour[0];
      assert.ok(cool < previous, `${hours} h`);
      previous = cool;
    }
  });

  it('paints a blue zenith by day, bluer than the sun is', () => {
    const day = at(9);
    const zenith = day.radiance([0, 1, 0]);
    assert.ok(zenith[2] > zenith[0]);
    assert.ok(zenith[2] / zenith[0] > day.key.colour[2] / day.key.colour[0]);
  });

  it('fades the sky after sunset as Earth’s shadow climbs', () => {
    let previous = twilight(0);
    for (let degrees = 1; degrees <= 18; degrees++) {
      const lit = twilight(-degrees * DEG);
      assert.ok(lit < previous);
      previous = lit;
    }
    const sun: [number, number, number] = [Math.cos(10 * DEG), -Math.sin(10 * DEG), 0];
    assert.ok(skyRadiance([0, 1, 0], sun, HAZE)[2] < 1e-3);
  });

  it('turns night on from sunset to the end of civil dusk, monotonically', () => {
    assert.equal(nightFactor(5 * DEG), 0);
    assert.equal(nightFactor(-6 * DEG), 1);
    let previous = 0;
    for (let degrees = 0; degrees >= -7; degrees -= 0.5) {
      const night = nightFactor(degrees * DEG);
      assert.ok(night >= previous);
      previous = night;
    }
    assert.equal(at(12).isNight, false);
    assert.equal(at(23).isNight, true);
  });

  it('opens the exposure as the light falls, less than the light falls', () => {
    assert.equal(exposureFor(1, 1), 1);
    assert.ok(exposureFor(0.01, 1) > exposureFor(0.1, 1));
    assert.ok(exposureFor(0.01, 1) < 100);
    assert.ok(at(21).exposure > at(12).exposure);
  });

  it('hands the key light to the moon at night', () => {
    const night = at(0);
    assert.deepEqual(night.key.direction, night.moon);
    assert.deepEqual(at(12).key.direction, at(12).sun);
  });
});
