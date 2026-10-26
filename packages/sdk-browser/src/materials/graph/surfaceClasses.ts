import { FEATURE_CLASS_KEYS } from '../../visibility/shader/materialClass.ts'
import { refuseGraph } from './kept.ts'
import type { SurfaceProgram } from './surfaceProgram.ts'

/**
 * THE RESOLVE CLASSES OF THE GRAPHS: a surface that wears a graph is shaded by the resolve of its
 * graph's program, which a class of the features alone does not have — a class of the graphs is a
 * program over a set of features (the geometry its rows are worn on: `materialClassKey`), and takes
 * a key past those the features address (`FEATURE_CLASS_KEYS` of them). Two surfaces whose graphs
 * compile to the same text are one class, each reading its own values from its record
 * (`../table/graphRecord.ts`).
 *
 * A key is held for as long as a surface the scene wears needs its class: the census of the worn
 * surfaces (`visibility/passes/shadeCensus.ts`) gives the classes in use (`releaseGraphClasses`),
 * and the key of one that is not goes back to the keys to take, after two censuses — a row written
 * from the surface before it changed may be read until then — and its pipelines are dropped
 * (`classIdentity`). The keys of the graphs are as many as the features' (`FEATURE_CLASS_KEYS`):
 * the shading bins are sized by the key space, a record of a fixed place in the bins' head
 * (`shadeBinsWgsl.ts`), and a class word is the bin's index in the word's low 31 bits, so the key
 * space is the one bound — the reference's bins have none but the count of its pipelines
 * (`MaxShadingBin + 1`), and a scene that wears more classes at once than there are keys is a scene
 * of tens of thousands of distinct programs at once, which no pipeline cache holds either: the
 * surface past them is named (`refuseGraph`) and drawn from its parameters.
 */
export interface GraphClass {
  readonly key: number
  /** The features the class's pipeline is compiled with (`materialClassKey`). */
  readonly features: number
  readonly program: SurfaceProgram
  /** The census a class stopped being worn at, none while it is. */
  released?: number
}

/** A class released at a census, in the order of release: the front is the oldest. */
interface Release {
  readonly made: GraphClass
  readonly census: number
}

/** The classes by the program's text, then by features: no key is built to look one up. */
const byProgram = new Map<string, Map<number, GraphClass>>()
const classes: (GraphClass | undefined)[] = []
/** The censuses taken (`releaseGraphClasses`). */
let census = 0
/** The programs named as past the keys, once each. */
const named = new Set<string>()

/** The classes released, in order, from `firstRelease`: one taken again, or whose key was taken by
 *  another class, is skipped where it comes to the front. */
const releases: Release[] = []
let firstRelease = 0

/** Whether a queued release still stands: its class is not worn again, nor its key taken. */
const standing = ({ made, census: at }: Release) =>
  made.released === at && classes[made.key - FEATURE_CLASS_KEYS] === made

/** The queue without the releases consumed or gone stale, which flips of a class leave behind. */
function compactReleases() {
  const kept = releases.slice(firstRelease).filter(standing)
  releases.length = firstRelease = 0
  releases.push(...kept)
}

/** The oldest class released two censuses ago or more, whose key is the next one to take. */
function oldestReleased() {
  while (firstRelease < releases.length) {
    const front = releases[firstRelease]!
    if (!standing(front)) firstRelease++
    else return census - front.census >= 2 ? front.made : undefined
  }
  releases.length = firstRelease = 0
  return undefined
}

/** The key of the class of `program` over the features `features`, made at its first ask; none
 *  once every key of the graphs is taken by classes in use (named once). */
export function graphClassKey(program: SurfaceProgram, features: number) {
  const text = program.compiled.key
  const held = byProgram.get(text)?.get(features)
  if (held) {
    held.released = undefined
    return held.key
  }
  const reused = oldestReleased()
  const slot = reused ? reused.key - FEATURE_CLASS_KEYS : classes.length
  const id = `${text}|${features}`
  if (slot >= FEATURE_CLASS_KEYS) {
    if (!named.has(id)) {
      named.add(id)
      refuseGraph(
        `the resolve holds at most ${FEATURE_CLASS_KEYS} classes of graph programs at once: a surface past them is drawn from its parameters`,
      )
    }
    return undefined
  }
  if (reused) {
    const reusedText = reused.program.compiled.key
    const inner = byProgram.get(reusedText)
    inner?.delete(reused.features)
    if (!inner?.size) byProgram.delete(reusedText)
  }
  const made: GraphClass = { key: FEATURE_CLASS_KEYS + slot, features, program }
  const byFeatures = byProgram.get(text) ?? new Map<number, GraphClass>()
  byFeatures.set(features, made)
  byProgram.set(text, byFeatures)
  classes[slot] = made
  return made.key
}

/** The class of the key `key`, none for a key of the features. */
export const graphClassOf = (key: number): GraphClass | undefined =>
  key >= FEATURE_CLASS_KEYS ? classes[key - FEATURE_CLASS_KEYS] : undefined

/** What tells the pipelines of a key apart over time: the class the key stands for now, since a key
 *  released is taken by another class; the key itself for one of the features. */
export const classIdentity = (key: number): unknown => graphClassOf(key) ?? key

/**
 * One census of the worn surfaces: the classes among `live` stay, the others are released — their
 * keys are free to take after the next census. The classes that were released and are asked again
 * (`graphClassKey`) are in use once more.
 */
export function releaseGraphClasses(live: readonly number[]) {
  census++
  const used = new Set(live)
  for (const made of classes)
    if (made && made.released === undefined && !used.has(made.key)) {
      made.released = census
      releases.push({ made, census })
    }
  if (firstRelease * 2 > releases.length || releases.length > 2 * classes.length) compactReleases()
}

/** Whether a class among `keys` runs a program that reads the time: its pixels change from one image
 *  to the next with nothing else moving, so the image is never held. */
export const readsTime = (keys: readonly number[]) =>
  keys.some((key) => graphClassOf(key)?.program.compiled.uses.time)
