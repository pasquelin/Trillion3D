# `physics.json` — cooked colliders

Colliders as Jolt binary state, readable only by the Jolt commit that wrote them, and their static
instances.

- Versions: `PHYSICS_FORMAT_VERSION`, `PIECES_FORMAT_VERSION`, `JOLT_COMMIT` (`rust/physics_cook.rs`);
  `PHYSICS_FORMAT_VERSIONS` (`core/physics/cooked.ts`).
- Writes `rust/physics_cook/stage.rs:stage_physics`; reads `core/physics/cooked.ts:readCookedPhysics`.
- A `node` names the source node (its `sourceNode` in the
  [prepared scene tables](prepared-scene-tables.md#prepared-scene-tables), never its rank in a
  partition's core). The node of a body that moves or bends stays in the core and a cell draws it
  ([World partition](prepared-scene-tables.md#world-partition)), each cell node naming the source node
  it draws; the runtime finds a body's node by that source rank, and makes the body while a placed cell
  draws it.

## `bodies` — declared rigid bodies

Declared motion and shape, or a cooked hull with its mass: `rust/physics_cook/declared.rs`;
`browser/physics/cooked/cookedBodies.ts:createCookedBodies`.

## `softBodies` — cooked soft bodies

Cloth, rope and volume as Jolt settings at the node's scale:
`rust/physics_cook/soft_record.rs:soft_record`; `browser/physics/soft/cookedSoft.ts:createCookedSoftBodies`.
