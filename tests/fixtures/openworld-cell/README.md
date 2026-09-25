# Open-world cell

One 250 m cell of the open world, the airport apron at cell (-5, -1): 28 nodes over 8 meshes,
42 862 triangles. Extracted read-only from `Trillion3D-openworld` at `141f97d`
(`dist/assets/dc18a1102476a300/source/world.gltf`), same owner; positions and indices only,
16-bit indices where a mesh allows, node transforms kept.

The native compiler's tests cook it to hold the page-dependency rules on an open world (#485,
#483 rule 9): `packages/asset-compiler-rust/src/tests/compile/dag_dependency_scenes.rs`.
