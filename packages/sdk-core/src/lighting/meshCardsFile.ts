import {
  assertSidecarSection,
  checkSidecarHead,
  sidecarRefusal,
  type SidecarRefusal,
} from '../contracts/sidecarSection.ts'
import {
  MESH_CARDS_CARD_BYTES,
  MESH_CARDS_DIRECTIONS,
  MESH_CARDS_FLAG_HLOD_CELL,
  MESH_CARDS_FLAG_TWO_SIDED,
  MESH_CARDS_HEAD_BYTES,
  MESH_CARDS_MAGIC,
  MESH_CARDS_MESH_BYTES,
  MESH_CARDS_VERSION,
} from '../contracts/meshCardsAbi.ts'

/**
 * The mesh cards' file, as the compiler writes it
 * (`packages/asset-compiler-rust/src/card_representation/encode.rs`, `meshCards.bin`): for each
 * compiled mesh that keeps cards — and each HLOD cell whose actors' layer allowed a distance field —,
 * the box the cards were fitted in and the cards themselves, in metres. A card is a box looking at
 * the mesh along one of the six axis directions: its centre, its half-extents along its own axes,
 * its three axes — unit vectors in the mesh's space, the third facing out of the mesh — and the
 * direction it looks along.
 */

type Vec3 = readonly [number, number, number]

/** One card of a mesh. */
export interface MeshCard {
  /** The centre of the card's box, in the mesh's object space, metres. */
  readonly origin: Vec3
  /** The half-extents of the box along the card's three axes, metres. */
  readonly extent: Vec3
  /** The card's axes: the first two span its face, the third faces out of the mesh. */
  readonly axisX: Vec3
  readonly axisY: Vec3
  readonly axisZ: Vec3
  /** The axis direction the card looks along, 0 to 5: `-x`, `+x`, `-y`, `+y`, `-z`, `+z`. */
  readonly direction: number
}

/** One mesh's cards. */
export interface MeshCards {
  /** The compiled mesh they belong to; for an HLOD cell's cards (`hlodCell`), the cell, a rank of
   *  the world's chain of HLOD cells. */
  readonly mesh: number
  /** Whether they are the cards of an HLOD cell's actors (`MESH_CARDS_FLAG_HLOD_CELL`): their
   *  merged triangles in the world DAG's space, placed where the world DAG is. */
  readonly hlodCell: boolean
  /** Whether a quarter of the mesh's triangles or more are two-sided: it was covered as foliage is,
   *  by its outer cards alone. */
  readonly mostlyTwoSided: boolean
  /** The box the cards were fitted in, in the mesh's object space, metres. */
  readonly min: Vec3
  readonly max: Vec3
  readonly cards: readonly MeshCard[]
}

const refuse: SidecarRefusal = sidecarRefusal('mesh cards')

/** The flag bits a record may carry. */
const KNOWN_FLAGS = MESH_CARDS_FLAG_TWO_SIDED | MESH_CARDS_FLAG_HLOD_CELL

/**
 * The manifest's `meshCards` section, or undefined when the cache has none (a scene whose meshes
 * keep no card writes neither the section nor the file); a section of another version throws
 * `UNSUPPORTED_FORMAT`, one that names no file `INVALID_CACHE`.
 */
export const assertMeshCardsSection = (section: unknown) =>
  assertSidecarSection(section, MESH_CARDS_VERSION, 'mesh cards')

/** The three floats from byte `at` of `view`, which must all be finite. */
function vec3(view: DataView, at: number, what: string): Vec3 {
  const value: Vec3 = [
    view.getFloat32(at, true),
    view.getFloat32(at + 4, true),
    view.getFloat32(at + 8, true),
  ]
  if (!value.every((part) => Number.isFinite(part)))
    refuse(`${what} holds a number that is not finite`)
  return value
}

/** The card whose record starts at byte `at` of `view`. */
function readCard(view: DataView, at: number): MeshCard {
  const extent = vec3(view, at + 12, 'a card')
  const direction = view.getUint32(at + 60, true)
  if (direction >= MESH_CARDS_DIRECTIONS) refuse(`a card looking along direction ${direction}`)
  if (extent.some((half) => half < 0)) refuse('a card of negative extent')
  return {
    origin: vec3(view, at, 'a card'),
    extent,
    axisX: vec3(view, at + 24, 'a card'),
    axisY: vec3(view, at + 36, 'a card'),
    axisZ: vec3(view, at + 48, 'a card'),
    direction,
  }
}

/**
 * Reads the file `bytes` hold, or throws `INVALID_CACHE`; a file of another version throws
 * `UNSUPPORTED_FORMAT`. The file must be its head, its mesh records and its cards, no more: each
 * mesh's cards follow the previous mesh's in the card table.
 */
export function parseMeshCards(bytes: Uint8Array): MeshCards[] {
  checkSidecarHead(bytes, {
    magic: MESH_CARDS_MAGIC,
    version: MESH_CARDS_VERSION,
    headBytes: MESH_CARDS_HEAD_BYTES,
    what: 'mesh cards',
  })
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const meshCount = view.getUint32(8, true)
  const cardCount = view.getUint32(12, true)
  const cardsAt = MESH_CARDS_HEAD_BYTES + meshCount * MESH_CARDS_MESH_BYTES
  if (cardsAt + cardCount * MESH_CARDS_CARD_BYTES !== bytes.byteLength)
    refuse('not its head, its records and its cards')
  let next = 0
  const meshes = Array.from({ length: meshCount }, (_, k) => {
    const at = MESH_CARDS_HEAD_BYTES + k * MESH_CARDS_MESH_BYTES
    const flags = view.getUint32(at + 4, true)
    if ((flags & ~KNOWN_FLAGS) !== 0) refuse(`a record with flags ${flags}`)
    const min = vec3(view, at + 8, 'a box')
    const max = vec3(view, at + 20, 'a box')
    if (min.some((low, axis) => low > (max[axis] ?? low)))
      refuse('a box whose low corner lies past its high')
    const first = view.getUint32(at + 32, true)
    const count = view.getUint32(at + 36, true)
    if (first !== next || first + count > cardCount)
      refuse('cards out of the order of their meshes')
    next = first + count
    return {
      mesh: view.getUint32(at, true),
      hlodCell: (flags & MESH_CARDS_FLAG_HLOD_CELL) !== 0,
      mostlyTwoSided: (flags & MESH_CARDS_FLAG_TWO_SIDED) !== 0,
      min,
      max,
      cards: Array.from({ length: count }, (_, c) =>
        readCard(view, cardsAt + (first + c) * MESH_CARDS_CARD_BYTES),
      ),
    }
  })
  if (next !== cardCount) refuse('cards that no mesh holds')
  return meshes
}
