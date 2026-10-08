// Launches compiler oracle and compares its irradiance to engine output.
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fromUnorm8 } from '../../../packages/math/src/color/color.ts'
import { mean, quantile } from '../../../packages/math/src/scalar/quantile.ts'
import type { CameraPose } from '../../../packages/sdk-core/src/contracts/base.ts'
import type { SceneLight } from '../../../packages/sdk-core/src/scene/light/contracts.ts'
import type { Capture } from '../../../tests/kit/server/staticServer.ts'

/** Compiler oracle binary, built by `pnpm run build:native`: a measurement tool, not the compiler. */
const ORACLE_BIN = 'packages/asset-compiler-rust/target/release/trillion3d-oracle'
/** True when binary exists: without it, campaign stops before opening browser. */
export const oracleBuilt = (root: string) => existsSync(join(root, ORACLE_BIN))

/** What `oracleJob` reads of the campaign settings to build the oracle's job file. */
interface JobSettings {
  source: string
  width: number
  height: number
  samples: number
  bounces: number
}

/** Job read by oracle: identical pose, lights, and size as engine. */
export function oracleJob(
  settings: JobSettings,
  pose: CameraPose,
  lights: SceneLight[],
  out: string,
) {
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
  }
}

/** Whatever the compiler oracle binary reports: this pipeline only stores and prints it. */
export interface OracleReport {
  [key: string]: unknown
}

/** Runs oracle on job file written beside output; returns its report. */
export function runOracle(
  root: string,
  job: ReturnType<typeof oracleJob>,
  dir: string,
  name: string,
): OracleReport {
  const jobFile = join(dir, `${name}.oracle.json`)
  writeFileSync(jobFile, JSON.stringify(job, null, 1))
  const text = execFileSync(join(root, ORACLE_BIN), [jobFile], { encoding: 'utf8' })
  return JSON.parse(text) as OracleReport
}

/**
 * Engine deviation from oracle, pixel by pixel.
 *
 * Both images hold the same quantity: indirect irradiance multiplied by exposure.
 * Engine capture is bottom-left RGBA8 — 8 bits, thus half-level error floor, and values above 1 clip.
 * Only pixels where oracle actually contains light enter statistics.
 */
export function compareIrradiance(
  capture: NonNullable<Capture>,
  oraclePath: string,
  exposure: number,
  floor: number,
) {
  const raw = readFileSync(oraclePath)
  const oracle = new Float32Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength))
  const { body, w, h } = capture
  if (oracle.length !== w * h * 3) return { error: `oracle ${oracle.length} versus ${w * h * 3}` }
  const errors: number[] = []
  let clipped = 0,
    counted = 0,
    engineSum = 0,
    oracleSum = 0
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      // Engine capture is bottom-left origin, oracle is top-left origin.
      const engineBase = ((h - 1 - y) * w + x) * 4
      const oracleBase = (y * w + x) * 3
      for (let axis = 0; axis < 3; axis++) {
        const expected = oracle[oracleBase + axis] * exposure
        const measured = fromUnorm8(body[engineBase + axis])
        if (expected < floor) continue
        if (expected > 1) {
          clipped++
          continue
        }
        counted++
        engineSum += measured
        oracleSum += expected
        errors.push(Math.abs(measured - expected) / expected)
      }
    }
  errors.sort((a, b) => a - b)
  const rank = (part: number) => (errors.length ? (quantile(errors, part) as number) : null)
  const median = rank(0.5),
    p95 = rank(0.95)
  return {
    channels: counted,
    clipped,
    meanPercent: errors.length ? mean(errors) * 100 : null,
    medianPercent: median === null ? null : median * 100,
    p95Percent: p95 === null ? null : p95 * 100,
    engineMean: counted ? engineSum / counted : null,
    oracleMean: counted ? oracleSum / counted : null,
  }
}

/** What `convergenceDelay` reads of the campaign settings. */
interface DelaySettings {
  delayMargin: number
  cadenceHz: number
}

/**
 * Convergence delay, read from steady-state gap curve.
 *
 * Gap never reaches zero: two passes do not replay identical Monte Carlo samples.
 * Delay is the first frame whose gap drops within a margin above the floor.
 */
export function convergenceDelay(gaps: number[], settings: DelaySettings) {
  const floor = gaps.length ? gaps[gaps.length - 1] : null
  const limit = floor === null ? null : floor * settings.delayMargin
  const frames = limit === null ? null : gaps.findIndex((gap) => gap <= limit) + 1
  return {
    images: frames || null,
    ms: frames ? (frames / settings.cadenceHz) * 1000 : null,
    cadenceHz: settings.cadenceHz,
    floor,
    margin: settings.delayMargin,
    gaps,
  }
}
