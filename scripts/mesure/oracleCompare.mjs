// Lance l'oracle du compilateur et compare son irradiance à celle que le moteur a rendue.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Le binaire de l'oracle, construit par `pnpm run build:native` à côté du compilateur. */
const ORACLE_BIN = 'packages/asset-compiler-rust/target/release/web-geometry-oracle';
/** Vrai quand le binaire existe : sans lui, la campagne s'arrête avant d'ouvrir un navigateur. */
export const oracleBuilt = (root) => existsSync(join(root, ORACLE_BIN));

/** Le travail que l'oracle lit : la même pose, les mêmes lampes, la même taille que le moteur. */
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

/** Lance l'oracle sur un travail écrit à côté de sa sortie ; rend son rapport. */
export function runOracle(root, job, dir, name) {
  const jobFile = join(dir, `${name}.oracle.json`);
  writeFileSync(jobFile, JSON.stringify(job, null, 1));
  const text = execFileSync(join(root, ORACLE_BIN), [jobFile], { encoding: 'utf8' });
  return JSON.parse(text);
}

/**
 * L'écart du moteur à l'oracle, pixel par pixel.
 *
 * Les deux images portent la même grandeur : l'irradiance indirecte multipliée par l'exposition.
 * Celle du moteur est une capture RGBA8 d'origine bas-gauche — huit bits, donc un plancher d'erreur
 * d'un demi-niveau, et une valeur au-delà de un est écrêtée ; le rapport compte ce qu'elle a
 * écrêté plutôt que de le passer sous silence. Seuls les pixels où l'oracle porte réellement de la
 * lumière entrent dans la statistique : ailleurs, un écart relatif ne veut rien dire.
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
      // La capture du moteur a son origine en bas à gauche, l'oracle en haut à gauche.
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
 * Le retard de convergence, lu sur la courbe d'écart à l'état stable.
 *
 * L'écart ne tombe jamais à zéro : deux passages par le même état ne rejouent pas les mêmes tirages
 * de Monte-Carlo, et il reste un plancher. Le retard est donc la première image dont l'écart entre
 * dans une marge au-dessus de ce plancher, qui est publié à côté. Le temps se déduit de la cadence
 * relevée : le harnais compte des images, jamais des millisecondes de montre.
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
