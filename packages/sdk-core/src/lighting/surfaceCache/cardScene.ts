import {
  dotScalar3,
  length3,
  transformAffinePoint,
  transformDirectionRow,
  writeCrossVector3,
  writeNormalizedVector3,
} from '../../../../math/src/vector/vector.ts'
import { DISTANCE_FIELD_UNITS_PER_METRE as CM } from '../../contracts/distanceFieldAbi.ts'
import type { SurfaceCacheSettings } from '../../contracts/surfaceCacheOptions.ts'
import { AXIS_DIRECTIONS, MAX_CARDS_PER_MESH, RES_LEVELS, resLevelBias } from './cardResolution.ts'
import {
  directionIndex,
  directionVector,
  type Card,
  type MeshCard,
  type MeshCards,
  type MeshCardsInstance,
  type SurfaceMip,
  type Vec3,
} from './cardTypes.ts'

/**
 * THE CARDS PLACED: the cards each mesh carries (`MeshCards`, `./cardTypes.ts`), put where a
 * placement of the mesh stands. A placement keeps the cards whose face is wide enough — a mesh keeps
 * 32 at most —, puts the mesh cards instance at its matrix, and each card in the world: the centre,
 * the frame (the width taken from the other two axes so that it stays right-handed, `axisXFlipped`
 * saying the matrix turned the width round) and the half sides; and in the space of its mesh cards,
 * the object space scaled by the placement, where the eye's distance to the card is measured. A
 * matrix that is not a placement — an axis vanishes, or the axes are not orthogonal — keeps none.
 *
 * Lengths are in centimetres, the unit of the global distance field's scene; a placement's matrix
 * and a mesh's boxes are in metres, as the field's are, and are scaled once, here.
 */

/** The length under which a vector is taken to be of no length, and a scale to be nothing. */
const VANISHING = 1e-8
/** The length a frame's axis is divided by at least, and a frame's axis under which another is
 *  chosen. */
const DEGENERATE = 1e-5
/** The scale under which a matrix is no placement, and the dot product under which two axes are
 *  orthogonal. */
const ORTHOGONAL = 1e-4

const newMip = (): SurfaceMip => ({
  locked: false,
  sizeX: 0,
  sizeY: 0,
  resLevelX: 0,
  resLevelY: 0,
  spanSize: 0,
  spanOffset: -1,
})

/** The matrix `world` (metres, by column) in centimetres. */
function matrixInCentimetres(world: ArrayLike<number>) {
  const m = new Float64Array(16)
  m.set(world)
  m[12] *= CM
  m[13] *= CM
  m[14] *= CM
  return m
}

/** The scale of each axis of the matrix `m`: the length of its column, 0 where that is vanishing. */
function axisScales(m: ArrayLike<number>, out: Float64Array) {
  for (let axis = 0; axis < 3; axis++) {
    const x = m[axis * 4],
      y = m[axis * 4 + 1],
      z = m[axis * 4 + 2]
    out[axis] = x * x + y * y + z * z > VANISHING ? length3(x, y, z) : 0
  }
}

/** Whether the matrix `m` is a placement the cards can follow: no axis vanishes and the axes are
 *  orthogonal. */
function isOrthogonal(m: ArrayLike<number>) {
  const scale = new Float64Array(3)
  axisScales(m, scale)
  if (Math.min(scale[0], scale[1], scale[2]) < ORTHOGONAL) return false
  const unit = (axis: number, k: number) => m[axis * 4 + k] / scale[axis]
  const dot = (a: number, b: number) =>
    dotScalar3(unit(a, 0), unit(a, 1), unit(a, 2), unit(b, 0), unit(b, 1), unit(b, 2))
  return (
    Math.abs(dot(0, 1)) < ORTHOGONAL &&
    Math.abs(dot(0, 2)) < ORTHOGONAL &&
    Math.abs(dot(1, 2)) < ORTHOGONAL
  )
}

/** Puts `instance` at the matrix `m`: its scale, and its rotation without the scale. */
function placeInstance(instance: MeshCardsInstance, m: ArrayLike<number>) {
  instance.localToWorld.set(m)
  axisScales(m, instance.scale)
  for (let axis = 0; axis < 3; axis++) {
    const x = m[axis * 4],
      y = m[axis * 4 + 1],
      z = m[axis * 4 + 2]
    const reach = x * x + y * y + z * z > VANISHING ? length3(x, y, z) : 1
    instance.rotation[axis * 3] = x / reach
    instance.rotation[axis * 3 + 1] = y / reach
    instance.rotation[axis * 3 + 2] = z / reach
  }
}

/** Makes the axes `x`, `y`, `z` an orthonormal frame about `z`: `x` and `y` lose what they hold of
 *  `z`, a vanishing one is chosen again from the other two, and all three are made unit. */
function orthonormalize(x: Float64Array, y: Float64Array, z: Float64Array) {
  const zz = dotScalar3(z[0], z[1], z[2], z[0], z[1], z[2])
  const alongX = dotScalar3(x[0], x[1], x[2], z[0], z[1], z[2]) / zz
  const alongY = dotScalar3(y[0], y[1], y[2], z[0], z[1], z[2]) / zz
  for (let k = 0; k < 3; k++) {
    x[k] -= alongX * z[k]
    y[k] -= alongY * z[k]
  }
  if (dotScalar3(x[0], x[1], x[2], x[0], x[1], x[2]) < DEGENERATE * DEGENERATE)
    writeCrossVector3(x, 0, y[0], y[1], y[2], z[0], z[1], z[2])
  if (dotScalar3(y[0], y[1], y[2], y[0], y[1], y[2]) < DEGENERATE * DEGENERATE)
    writeCrossVector3(y, 0, x[0], x[1], x[2], z[0], z[1], z[2])
  writeNormalizedVector3(x, 0, x[0], x[1], x[2])
  writeNormalizedVector3(y, 0, y[0], y[1], y[2])
  writeNormalizedVector3(z, 0, z[0], z[1], z[2])
}

/** Puts the world box of `card` where the placement of `instance` puts it: the centre, the axes —
 *  the width taken from the other two, so the frame stays right-handed, and `axisXFlipped` saying the
 *  matrix turned it round — and the half sides, the depth at least a centimetre. */
function placeCard(card: Card, instance: MeshCardsInstance) {
  const m = instance.localToWorld
  const [ox, oy, oz] = card.localOrigin
  transformAffinePoint(card.origin, m, ox, oy, oz)
  const [dx, dy, dz] = [card.axes[0], card.axes[1], card.axes[2]].map(directionVector)
  const sx = [0, 1, 2].map((row) => transformDirectionRow(m, row, dx[0], dx[1], dx[2]))
  const sy = [0, 1, 2].map((row) => transformDirectionRow(m, row, dy[0], dy[1], dy[2]))
  const sz = [0, 1, 2].map((row) => transformDirectionRow(m, row, dz[0], dz[1], dz[2]))
  const lengthX = length3(sx[0], sx[1], sx[2])
  const lengthY = length3(sy[0], sy[1], sy[2])
  const lengthZ = length3(sz[0], sz[1], sz[2])
  const holdY = Math.max(lengthY, DEGENERATE),
    holdZ = Math.max(lengthZ, DEGENERATE)
  for (let k = 0; k < 3; k++) {
    card.axisY[k] = sy[k] / holdY
    card.axisZ[k] = sz[k] / holdZ
  }
  writeCrossVector3(
    card.axisX,
    0,
    card.axisZ[0],
    card.axisZ[1],
    card.axisZ[2],
    card.axisY[0],
    card.axisY[1],
    card.axisY[2],
  )
  orthonormalize(card.axisX, card.axisY, card.axisZ)
  card.axisXFlipped =
    dotScalar3(sx[0], sx[1], sx[2], card.axisX[0], card.axisX[1], card.axisX[2]) < 0
  card.extent[0] = card.localExtent[0] * lengthX
  card.extent[1] = card.localExtent[1] * lengthY
  card.extent[2] = Math.max(card.localExtent[2] * lengthZ, 1)
}

/** Puts the box of `card` in the space of its mesh cards: its centre and half sides scaled by the
 *  placement's scale, each half side to the object axis it lies along. */
function placeBox(card: Card, scale: Float64Array) {
  const half = [0, 0, 0]
  for (let k = 0; k < 3; k++) {
    const axis = card.axes[k] >> 1
    half[axis] = card.localExtent[k] * scale[axis]
  }
  for (let axis = 0; axis < 3; axis++) {
    const centre = card.localOrigin[axis] * scale[axis]
    card.box[axis] = centre - half[axis]
    card.box[axis + 3] = centre + half[axis]
  }
  const normal = card.axes[2] >> 1
  card.maxExtent = Math.max(half[(normal + 1) % 3], half[(normal + 2) % 3])
}

/** The key two cards that may copy one another share, -1 where `shareId` says there is none: the
 *  mesh and its materials, the face and the proportion. */
function sharingKey(shareId: number, direction: number, biasX: number, biasY: number) {
  return shareId < 0 ? -1 : shareId * 2048 + direction * 256 + biasY * 16 + biasX
}

/** A card made of `source`, the card `indexInMesh` of its mesh and the `indexInMeshCards`-th the
 *  placement kept, not yet placed. */
function makeCard(source: MeshCard, indexInMesh: number, indexInMeshCards: number): Card {
  const axes = [source.axisX, source.axisY, source.axisZ].map(directionIndex) as [
    number,
    number,
    number,
  ]
  if (
    axes.some((axis) => axis < 0) ||
    new Set(axes.map((axis) => axis >> 1)).size !== 3 ||
    source.direction < 0 ||
    source.direction >= AXIS_DIRECTIONS
  )
    throw new RangeError(`mesh card ${indexInMesh}: its axes are not the axes of the object space`)
  const scaled = (v: Vec3): Vec3 => [v[0] * CM, v[1] * CM, v[2] * CM]
  return {
    indexInMesh,
    indexInMeshCards,
    direction: source.direction,
    axes,
    localOrigin: scaled(source.origin),
    localExtent: scaled(source.extent),
    resBiasX: 0,
    resBiasY: 0,
    sharingId: -1,
    meshCards: -1,
    axisXFlipped: false,
    origin: new Float64Array(3),
    axisX: new Float64Array(3),
    axisY: new Float64Array(3),
    axisZ: new Float64Array(3),
    extent: new Float64Array(3),
    box: new Float64Array(6),
    maxExtent: 0,
    mips: Array.from({ length: RES_LEVELS }, newMip),
    minResLevel: 255,
    maxResLevel: 0,
    sharingIndex: -1,
    desiredLockedResLevel: 0,
    desiredOnLastAlloc: 0,
    visible: false,
  }
}

/** The area, in square centimetres, under which a face does not get a card. */
const minFaceArea = (settings: SurfaceCacheSettings, emissive: boolean) =>
  settings.surfaceCacheMeshCardsMinSize ** 2 * (emissive ? 0.2 : 1)

/** The area of the largest face of the box of `mesh` scaled by `scale` (centimetres). */
function largestFaceArea(mesh: MeshCards, scale: ArrayLike<number>) {
  const size = [0, 1, 2].map((k) => (mesh.max[k] - mesh.min[k]) * CM * scale[k])
  return Math.max(size[1] * size[2], size[0] * size[2], size[1] * size[0])
}

/** Whether a placement of `mesh` at `world` (metres, by column) is worth following: its largest face
 *  is over the least area of a card — a fifth of it for an emissive mesh. */
export function isTracked(
  world: ArrayLike<number>,
  mesh: MeshCards,
  settings: SurfaceCacheSettings,
  emissive: boolean,
) {
  const scale = new Float64Array(3)
  axisScales(matrixInCentimetres(world), scale)
  return largestFaceArea(mesh, scale) > minFaceArea(settings, emissive)
}

/** The indices of the cards of `mesh` the placement keeps, 32 at most: with `cullFaces`, those whose
 *  face, scaled by the placement, is over `minArea`. */
function keptCards(mesh: MeshCards, scale: Float64Array, minArea: number, cullFaces: boolean) {
  const kept: number[] = []
  for (let at = 0; at < mesh.cards.length && kept.length < MAX_CARDS_PER_MESH; at++) {
    const card = mesh.cards[at]
    const widthAxis = directionIndex(card.axisX) >> 1
    const heightAxis = directionIndex(card.axisY) >> 1
    const area =
      2 * card.extent[0] * CM * scale[widthAxis] * (2 * card.extent[1] * CM * scale[heightAxis])
    if (!cullFaces || area > minArea) kept.push(at)
  }
  return kept
}

/** The bit masks of the cards of each direction. */
function fillLookup(instance: MeshCardsInstance, cards: readonly Card[]) {
  for (const card of cards) instance.lookup[card.direction] |= 1 << card.indexInMeshCards
}

/** The cards one placement keeps, and where it puts them. */
interface PlacedMeshCards {
  readonly instance: MeshCardsInstance
  readonly cards: readonly Card[]
}

/**
 * The cards of the placement `placement` of `mesh` at `world` (metres, by column): none if its
 * largest face, scaled by the matrix, is under the least area — a fifth of it for an emissive mesh —,
 * if the matrix is not a placement (an axis vanishes, or the axes are not orthogonal) or if no card
 * passes. `shareId` is the same for placements of one mesh with the same materials, -1 for one whose
 * cards copy none.
 */
export function buildMeshCards(
  placement: number,
  world: ArrayLike<number>,
  mesh: MeshCards,
  settings: SurfaceCacheSettings,
  properties: {
    readonly emissive: boolean
    readonly shareId: number
    readonly lightingChannels: number
  },
): PlacedMeshCards | undefined {
  const m = matrixInCentimetres(world)
  const scale = new Float64Array(3)
  axisScales(m, scale)
  const minArea = minFaceArea(settings, properties.emissive)
  if (!(largestFaceArea(mesh, scale) > minArea) || !isOrthogonal(m)) return undefined
  const kept = keptCards(mesh, scale, minArea, settings.surfaceCacheMeshCardsCullFaces)
  if (kept.length === 0) return undefined
  const instance: MeshCardsInstance = {
    placement,
    firstCard: 0,
    numCards: kept.length,
    localToWorld: new Float64Array(16),
    scale: new Float64Array(3),
    rotation: new Float64Array(9),
    resolutionScale: 1,
    mostlyTwoSided: mesh.mostlyTwoSided,
    emissive: properties.emissive,
    lightingChannels: properties.lightingChannels,
    lookup: new Uint32Array(AXIS_DIRECTIONS),
  }
  placeInstance(instance, m)
  const cards = kept.map((at, local) => makeCard(mesh.cards[at], at, local))
  for (const card of cards) {
    placeCard(card, instance)
    placeBox(card, instance.scale)
    ;[card.resBiasX, card.resBiasY] = resLevelBias(card.extent[0] / card.extent[1])
    card.sharingId = sharingKey(properties.shareId, card.direction, card.resBiasX, card.resBiasY)
  }
  fillLookup(instance, cards)
  return { instance, cards }
}

/** Moves the cards of `instance` to the matrix `world` (metres, by column); false, and nothing
 *  moved, if it is not a placement the cards can follow. */
export function moveMeshCards(
  instance: MeshCardsInstance,
  cards: readonly Card[],
  world: ArrayLike<number>,
) {
  const m = matrixInCentimetres(world)
  if (!isOrthogonal(m)) return false
  placeInstance(instance, m)
  for (const card of cards) {
    placeCard(card, instance)
    placeBox(card, instance.scale)
  }
  return true
}

/** The distance from the point `(x, y, z)`, centimetres, to the box of `card` in the world. */
export function cardDistance(card: Card, x: number, y: number, z: number) {
  const dx = x - card.origin[0],
    dy = y - card.origin[1],
    dz = z - card.origin[2]
  const reach = (axis: Float64Array, half: number) =>
    Math.max(Math.abs(dotScalar3(dx, dy, dz, axis[0], axis[1], axis[2])) - half, 0)
  return length3(
    reach(card.axisX, card.extent[0]),
    reach(card.axisY, card.extent[1]),
    reach(card.axisZ, card.extent[2]),
  )
}
