//! The resident proxy's builder, shared by the native compiler and the browser's one WebAssembly
//! module: the layout numbers of its columns and the three steps that turn placed triangles into
//! them — grid snapping (`simplify.rs`), the binary BVH (`bvh.rs`) and its 4-wide collapse
//! (`wide.rs`). The compiler places a scene's triangles in world space and calls them
//! (`asset-compiler-rust/src/proxy.rs`); the run-time cut calls them on a cut's own triangles. The constants
//! below are printed into the TypeScript readers (`scripts/generate-shared-rules.ts`).

pub mod bvh;
pub mod simplify;
pub mod wide;

/// Max certified geometric error of retained cluster, in meters. Published setting.
pub const PROXY_ERROR_METRES: f64 = 0.05;
/// Proxy mesh floor, in meters: triangle size after simplification,
/// surface cache resolution. Triangle budget doubles if needed.
pub const PROXY_CELL_METRES: f64 = 0.5;
/// BVH leaf triangles: leaf loop bounded by this count engine side.
pub const PROXY_LEAF_TRIANGLES: usize = 8;
/// Triangles entire scene proxy allows itself, all instances placed. Budget
/// decides actually obtained threshold: 10M triangle scene outputs 30x
/// coarser than single room, threshold published in manifest.
pub const PROXY_TRIANGLE_BUDGET: usize = 300_000;
/// Numbers per proxy triangle: three world vertices, no normal — it is deduced from the triangle.
pub const PROXY_TRIANGLE_FLOATS: usize = 9;
/// Numbers per BVH node: its exact bounds, frame of its children's quantized boxes.
pub const PROXY_NODE_FLOATS: usize = 6;
/// Children of a node: four boxes tested at once, the nearest kept for the rest.
pub const PROXY_CHILDREN: usize = 4;
/// Integers per child: two words of quantized box and count, then the link.
pub const PROXY_CHILD_WORDS: usize = 3;
/// Integers per node: its four children concatenated.
pub const PROXY_NODE_WORDS: usize = PROXY_CHILDREN * PROXY_CHILD_WORDS;
