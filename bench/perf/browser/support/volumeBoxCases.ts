// Equivalence cases, boxes and spheres: each `sdk-core` function against the
// Three.js method it replaces, on the hostile inputs of `scenesVolumes.ts`. No gain sought:
// only the "identical" column decides, bit-exact (`Object.is` separates −0 from +0 and sees NaN).
import * as THREE from 'three'
import {
  boxCornersInto,
  boxEmpty,
  boxExpandByPoint,
  boxIsEmpty,
  boxTransform,
  boxUnion,
  sphereFromBounds,
} from '../../../../packages/sdk-core/src/index.ts'
import type { MeasureCase } from '../../../core/index.ts'
import { hierarchicalBoxes } from './scenesHierarchies.ts'
import { boxes, matrices } from './scenesVolumes.ts'
import { aPlat, box3 } from '../../../oracles/core/volumes.ts'
import { casVolume, un, type CasVolume } from './volumeCase.ts'

/** Hostile cases, then the world matrices of real Three.js hierarchies. */
const etHierarchies = (
  name: string,
  input: [number[], number[]][],
): MeasureCase<[number[], number[]][]>[] => [
  ...un(name, input),
  ...un('boxes × hierarchical world matrices', hierarchicalBoxes),
]
const pairs: [number[], number[]][] = boxes.flatMap((a, i) =>
  boxes.filter((_, j) => j % 13 === i % 13).map((b): [number[], number[]] => [a, b]),
)
const transformations: [number[], number[]][] = boxes.flatMap((b, i) =>
  matrices.filter((_, j) => j % 5 === i % 5).map((m): [number[], number[]] => [b, m]),
)

/** Equivalence lines of boxes and spheres, without timer options. */
export const boxCases: CasVolume[] = [
  casVolume({
    calculation: 'empty box and emptiness test',
    fichier: 'packages/math/src/geometry/box.ts',
    cas: un('hostile boxes', boxes),
    reference: (list: number[][]) => [
      aPlat(new THREE.Box3().makeEmpty()),
      list.map((b) => box3(b).isEmpty()),
    ],
    optimised: (list: number[][]) => {
      const empty = new Float64Array(6)
      boxEmpty(empty, 0)
      return [empty, list.map((b) => boxIsEmpty(b, 0))]
    },
  }),
  casVolume({
    calculation: 'union of two boxes',
    fichier: 'packages/math/src/geometry/box.ts',
    cas: un('hostile box pairs', pairs),
    reference: (list: [number[], number[]][]) =>
      list.map(([a, b]) => aPlat(box3(a).union(box3(b)))),
    optimised: (list: [number[], number[]][]) =>
      list.map(([a, b]) => {
        const output = Float64Array.from(a)
        boxUnion(output, 0, b[0], b[1], b[2], b[3], b[4], b[5])
        return output
      }),
  }),
  casVolume({
    calculation: 'extension of a box by two points',
    fichier: 'packages/math/src/geometry/box.ts',
    cas: un('hostile box pairs', pairs),
    reference: (list: [number[], number[]][]) =>
      list.map(([a, b]) => {
        const box = box3(a)
        box.expandByPoint(new THREE.Vector3(b[0], b[1], b[2]))
        return aPlat(box.expandByPoint(new THREE.Vector3(b[3], b[4], b[5])))
      }),
    optimised: (list: [number[], number[]][]) =>
      list.map(([a, b]) => {
        const output = Float64Array.from(a)
        boxExpandByPoint(output, 0, b[0], b[1], b[2])
        boxExpandByPoint(output, 0, b[3], b[4], b[5])
        return output
      }),
  }),
  casVolume({
    calculation: 'transform of a box by a matrix',
    fichier: 'packages/math/src/geometry/box.ts',
    cas: etHierarchies('boxes × hostile matrices', transformations),
    reference: (list: [number[], number[]][]) =>
      list.map(([b, m]) => aPlat(box3(b).applyMatrix4(new THREE.Matrix4().fromArray(m)))),
    optimised: (list: [number[], number[]][]) =>
      list.map(([b, m]) => {
        const output = new Float64Array(6),
          surPlace = Float64Array.from(b)
        boxTransform(output, 0, b, 0, m)
        boxTransform(surPlace, 0, surPlace, 0, m)
        for (let i = 0; i < 6; i++)
          if (!Object.is(output[i], surPlace[i])) throw new Error('BOX_TRANSFORM_ALIAS')
        return output
      }),
  }),
  casVolume({
    calculation: 'eight transformed corners of a box',
    fichier: 'packages/math/src/geometry/box.ts',
    cas: etHierarchies('boxes × hostile matrices', transformations),
    reference: (list: [number[], number[]][]) =>
      list.map(([b, m]) => {
        const matrice = new THREE.Matrix4().fromArray(m),
          output = new Float64Array(24),
          coin = new THREE.Vector3()
        for (let i = 0; i < 8; i++) {
          coin.set(i & 1 ? b[3] : b[0], i & 2 ? b[4] : b[1], i & 4 ? b[5] : b[2])
          coin.applyMatrix4(matrice).toArray(output, i * 3)
        }
        return output
      }),
    optimised: (list: [number[], number[]][]) =>
      list.map(([b, m]) => {
        const output = new Float64Array(24)
        boxCornersInto(output, 0, b[0], b[1], b[2], b[3], b[4], b[5], m)
        return output
      }),
  }),
  casVolume({
    calculation: 'bounding sphere of a transformed box',
    fichier: 'packages/math/src/geometry/sphere.ts',
    cas: etHierarchies('boxes × hostile matrices', transformations),
    reference: (list: [number[], number[]][]) =>
      list.map(([b, m]) => {
        const box = box3(b).applyMatrix4(new THREE.Matrix4().fromArray(m))
        const sphere = box.getBoundingSphere(new THREE.Sphere())
        return Float64Array.of(sphere.center.x, sphere.center.y, sphere.center.z, sphere.radius)
      }),
    optimised: (list: [number[], number[]][]) =>
      list.map(([b, m]) => {
        const box = new Float64Array(6),
          output = new Float64Array(4)
        boxTransform(box, 0, b, 0, m)
        sphereFromBounds(output, 0, box[0], box[1], box[2], box[3], box[4], box[5])
        return output
      }),
  }),
  casVolume({
    calculation: 'bounding sphere of a box',
    fichier: 'packages/math/src/geometry/sphere.ts',
    cas: un('hostile boxes', boxes),
    reference: (list: number[][]) =>
      list.map((b) => {
        const sphere = box3(b).getBoundingSphere(new THREE.Sphere())
        return Float64Array.of(sphere.center.x, sphere.center.y, sphere.center.z, sphere.radius)
      }),
    optimised: (list: number[][]) =>
      list.map((b) => {
        const output = new Float64Array(4)
        sphereFromBounds(output, 0, b[0], b[1], b[2], b[3], b[4], b[5])
        return output
      }),
  }),
]
