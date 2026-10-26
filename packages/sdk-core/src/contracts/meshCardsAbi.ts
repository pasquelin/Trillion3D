/**
 * The mesh cards product, written once and read by the cards loader
 * (`../lighting/meshCardsFile.ts`) and the compiler's Rust
 * (`scripts/build/shared-rules/meshCards.ts` prints it into `card_representation/abi.rs`).
 *
 * A mesh's cards are the few boxes, each looking at the mesh along one of the six axis directions,
 * that cover its surface: what a surface cache captures a mesh into. The compiler casts rays at the
 * mesh's triangles to find them, once per mesh (`maxMeshCards`, `meshCardMinDensity`,
 * `meshCardNormalThreshold`, the mesh build settings of `meshBuildAbi.ts`), and writes them with
 * the mesh's box in `meshCards.bin`, one record per mesh that has any. The lengths are metres, in
 * the mesh's object space — the world's for an HLOD cell's actors.
 */

/** The product holding every mesh's cards, and the manifest's section naming it. */
export const MESH_CARDS_FILE = 'meshCards.bin'
/** The first four bytes of `meshCards.bin`: `T3MC` read as a little-endian `u32`. */
export const MESH_CARDS_MAGIC = 0x434d3354
/** Format of `meshCards.bin` and of the manifest's `meshCards` section
 *  (`asset-compiler-rust/src/card_representation/encode.rs` lays it out). */
export const MESH_CARDS_VERSION = 1
/** The bytes of the file's head: the magic, the version, the mesh count and the card count. */
export const MESH_CARDS_HEAD_BYTES = 16
/** The bytes of a mesh's record: its compiled mesh (or, an HLOD cell's cards, the cell), its flags
 *  (`MESH_CARDS_FLAG_TWO_SIDED`, `MESH_CARDS_FLAG_HLOD_CELL`), the low and the high corner of its
 *  box in metres (six `f32`), then the rank of its first card in the card table and how many it
 *  has (two `u32`). */
export const MESH_CARDS_MESH_BYTES = 40
/** The bytes of a card's record: its box's centre (the origin) and half-extents in the card's own
 *  axes, the card's three axes (three `f32` each, unit vectors in the mesh's space; the third, its
 *  direction, looks out of the mesh), then its direction index (a `u32`). */
export const MESH_CARDS_CARD_BYTES = 64
/** The bit of a record's flags that says a quarter of the mesh's triangles or more are two-sided
 *  (or the build asked for all): it was covered as foliage is, by the outer cards alone. */
export const MESH_CARDS_FLAG_TWO_SIDED = 1
/** The bit of a record's flags that says the cards are an HLOD actor's, not a compiled mesh's: its
 *  `mesh` word names a cell of the world's chain of HLOD cells, as a distance field's does
 *  (`DISTANCE_FIELD_FLAG_HLOD_CELL`), and its metres lie in the world's space. */
export const MESH_CARDS_FLAG_HLOD_CELL = 2
/** The directions a card looks along, indexed 0 to 5: `-x`, `+x`, `-y`, `+y`, `-z`, `+z` — the
 *  direction of a card's third axis, the way it faces out of the mesh. */
export const MESH_CARDS_DIRECTIONS = 6
