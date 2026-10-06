/**
 * WHICH RINGS THE GATE ALLOWS, and how it says so.
 *
 * The tree holds five groups of modules that reach each other in the emitted JavaScript. A gate that
 * failed on them would be red on the day it was written, and a gate that is red is not a gate — so the
 * five are named here, and a group this file does not name fails.
 *
 * A name the tree does not hold is a group that was broken: it is reported, so the file shrinks
 * with every fix and a group of the same modules cannot come back under a line nobody removed.
 * `--write-baseline` prints the groups the tree holds, for that shrinking.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ringKey } from './check-cycles.ts'

const BASELINE = 'scripts/check-cycles-baseline.json'

/** The group names `root` allows today; an absent or unreadable file allows none. */
export const readBaseline = (root: string): string[] => {
  try {
    return JSON.parse(readFileSync(join(root, BASELINE), 'utf8')) as string[]
  } catch {
    return []
  }
}

export interface RingReport {
  /** A group the tree holds and the baseline does not name. */
  fresh: string[][]
  /** A name the baseline carries that matches no group. */
  stale: string[]
  /** How many groups the tree holds. */
  held: number
}

/** The tree's groups beside what the baseline allows, split by what the gate has to say. */
export function report(rings: string[][], baseline: readonly string[]): RingReport {
  const keys = rings.map(ringKey)
  const held = new Set(keys)
  return {
    fresh: rings.filter((ring) => !baseline.includes(ringKey(ring))),
    stale: baseline.filter((key) => !held.has(key)),
    held: held.size,
  }
}
