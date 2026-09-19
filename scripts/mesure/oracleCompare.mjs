// Launches compiler oracle and compares its irradiance to engine output.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Compiler oracle binary, built by `pnpm run build:native` alongside compiler. */
const ORACLE_BIN = 'packages/asset-compiler-rust/target/release/web-geometry-oracle';
/** True when binary exists: without it, campaign stops before opening browser. */
export const oracleBuilt = (root) => existsSync(join(root, ORACLE_BIN));

/** Job read by oracle: identical pose, lights, and size as engine. */
export function oracleJob(settings, pose, lights, out) {
  return {
    version: 1,
    source: settings.source,
    width: settings.width,
    height: settings.height,
    camera: {
      position: pose.position,
      target: pose.target,
      fovDegrees: pose.fov,
    },
    lights,
    samples: settings.samples,
    bounces: settings.bounces,
    out,
  };
}

/** Runs oracle on job file written beside output; returns its report. */
export function runOracle(root, job, dir, name) {
  const jobFile = join(dir, `${name}.oracle.json`);
  writeFileSync(jobFile, JSON.stringify(job, null, 1));
  const text = execFileSync(join(root, ORACLE_BIN), [jobFile], { encoding: 'utf8' });
  return JSON.parse(text);
}

/**
 * Engine deviation from oracle, pixel by pixel.
 *
 * Both images hold the same quantity: indirect irradiance multiplied by exposure.
 * Engine capture is bottom-left RGBA8 — 8 bits, thus half-level error floor, and values above 1 clip.
 * Only pixels where oracle actually contains light enter statistics.
 */
export function compareIrradiance(capture, oraclePath, exposure, floor) {
  const raw = readFileSync(oraclePath);
  const oracle = new Float32Array(
    raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength),
  );
  const { body, w, h } = capture;
  if (oracle.length !== w * h * 3) return { erreur: `oracle ${oracle.length} contre ${w * h * 3}` };
  const errors = [];
  let clipped = 0,
    counted = 0,
    engineSum = 0,
    oracleSum = 0;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      // Engine capture is bottom-left origin, oracle is top-left origin.
      const engineBase = ((h - 1 - y) * w + x) * 4;
      const oracleBase = (y * w + x) * 3;
      for (let axis = 0; axis < 3; axis++) {
        const expected = oracle[oracleBase + axis] * exposure;
        const measured = body[engineBase + axis] / 255;
        if (expected < floor) continue;
        if (expected > 1) {
          clipped++;
          continue;
        }
        counted++;
        engineSum += measured;
        oracleSum += expected;
        errors.push(Math.abs(measured - expected) / expected);
      }
    }
  errors.sort((a, b) => a - b);
  const quantile = (part) => (errors.length ? errors[Math.floor(errors.length * part)] : null);
  return {
    canaux: counted,
    ecretes: clipped,
    moyennePourCent: errors.length
      ? (errors.reduce((a, b) => a + b, 0) / errors.length) * 100
      : null,
    medianePourCent: errors.length ? quantile(0.5) * 100 : null,
    p95PourCent: errors.length ? quantile(0.95) * 100 : null,
    moteurMoyen: counted ? engineSum / counted : null,
    oracleMoyen: counted ? oracleSum / counted : null,
  };
}

/**
 * Convergence delay, read from steady-state gap curve.
 *
 * Gap never reaches zero: two passes do not replay identical Monte Carlo samples.
 * Delay is the first frame whose gap drops within a margin above the floor.
 */
export function convergenceDelay(gaps, settings) {
  const floor = gaps.length ? gaps[gaps.length - 1] : null;
  const limit = floor === null ? null : floor * settings.delayMargin;
  const frames = limit === null ? null : gaps.findIndex((gap) => gap <= limit) + 1;
  return {
    images: frames || null,
    ms: frames ? (frames / settings.cadenceHz) * 1000 : null,
    cadenceHz: settings.cadenceHz,
    plancher: floor,
    marge: settings.delayMargin,
    ecarts: gaps,
  };
}
