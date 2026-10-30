# Deformation in geometry page format 9

Joints, weights, morph deltas and simulation-source IDs behind a geometry page's flags;
`primitives[].deformation` bounds their reach.

- Flags: `FLAG_SKIN`, `FLAG_MORPH` (`codec/deform.rs`), `FLAG_SOFT_SOURCE` (`codec/lib.rs`).
- Writes `codec/encode/deformation.rs:page_deformation`; reads `codec/deform.rs:parse` (through
  `browser/geometry/codec/geometryPage.ts:decodeGeometryPage`),
  `browser/deformation/softSource.ts:cookedSoftSource`.
