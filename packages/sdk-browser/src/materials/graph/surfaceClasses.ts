import { FEATURE_CLASS_KEYS, GRAPH_CLASS_KEYS } from '../../visibility/shader/materialClass.ts'
import type { SurfaceProgram } from './surfaceProgram.ts'

/**
 * THE RESOLVE CLASSES OF THE GRAPHS: a surface that wears a graph is shaded by the resolve of its
 * graph's program, which a class of the features alone does not have — a class of the graphs is a
 * program over a set of features (the geometry its rows are worn on: `materialClassKey`), and takes
 * a key past those the features address (`GRAPH_CLASS_KEYS` of them). Two surfaces whose graphs
 * compile to the same text are one class, each reading its own values from its record
 * (`../table/graphRecord.ts`). A class once made is kept: the programs of the scene are few.
 */
export interface GraphClass {
  readonly key: number
  /** The features the class's pipeline is compiled with (`materialClassKey`). */
  readonly features: number
  readonly program: SurfaceProgram
}

const byProgram = new Map<string, GraphClass>()
const classes: GraphClass[] = []

/** The key of the class of `program` over the features `features`, made at its first ask; none
 *  once every key of the graphs is taken. */
export function graphClassKey(program: SurfaceProgram, features: number) {
  const id = `${program.compiled.hash}|${features}`
  let made = byProgram.get(id)
  if (!made) {
    if (classes.length >= GRAPH_CLASS_KEYS) return undefined
    made = { key: FEATURE_CLASS_KEYS + classes.length, features, program }
    byProgram.set(id, made)
    classes.push(made)
  }
  return made.key
}

/** The class of the key `key`, none for a key of the features. */
export const graphClassOf = (key: number): GraphClass | undefined =>
  key >= FEATURE_CLASS_KEYS ? classes[key - FEATURE_CLASS_KEYS] : undefined

/** Whether `key` is the key of a class of a graph. */
export const isGraphKey = (key: number) => key >= FEATURE_CLASS_KEYS

/** Whether a class among `keys` runs a program that reads the time: its pixels change from one image
 *  to the next with nothing else moving, so the image is never held. */
export const readsTime = (keys: readonly number[]) =>
  keys.some((key) => graphClassOf(key)?.program.compiled.uses.time)
