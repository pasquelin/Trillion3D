//! The resident proxy's builder, shared by the native compiler and the browser's one WebAssembly
//! module: the layout numbers of its columns and the three steps that turn placed triangles into
//! them — grid snapping (`simplify.rs`), the binary BVH (`bvh.rs`) and its 4-wide collapse
//! (`wide.rs`). The compiler places a scene's triangles in world space and calls them
//! (`asset-compiler-rust/src/proxy.rs`); the run-time cut calls them on a cut's own triangles. The constants
//! below are printed into the TypeScript readers (`scripts/generate-shared-rules.ts`).

pub mod bvh;
pub mod simplify;
pub mod wide;

/// The node columns `build_columns` leaves besides the triangles and albedos it rewrites in place.
pub struct Built {
    pub node_bounds: Vec<f32>,
    pub node_children: Vec<u32>,
}

/// THE PROXY BUILDER, one for the compiler's meshes and the browser's cuts: snaps `triangles` to the
/// grid `cell` (`simplify::plan_cell` chose it), dropping what has no area and what repeats, builds
/// the BVH, reorders the triangles and `albedo` into its leaves' order, and collapses it to the wide
/// node columns.
pub fn build_columns(triangles: &mut Vec<f32>, albedo: &mut Vec<u32>, cell: f64) -> Built {
    simplify::simplify_sources(triangles, albedo, cell);
    let (tree, _) = bvh::build_ordered(triangles, albedo);
    let (node_bounds, node_children) = wide::collapse(&tree);
    Built {
        node_bounds,
        node_children,
    }
}

/// Max certified geometric error of retained cluster, in meters. Published setting.
pub const PROXY_ERROR_METRES: f64 = 0.05;
/// BVH leaf triangles: leaf loop bounded by this count engine side.
pub const PROXY_LEAF_TRIANGLES: usize = 8;
/// Triangles all the meshes' proxies of a scene allow themselves together, each mesh once whatever
/// its instances. The budget decides the threshold actually obtained: a scene of 10M triangles of
/// unique meshes outputs 30x coarser than a single room, the threshold published in the manifest.
pub const PROXY_TRIANGLE_BUDGET: usize = 300_000;
/// Triangles a cut's own proxy allows itself (`cut_columns`): a mesh of more is snapped to a grid
/// that holds it, never subdivided. 52 bytes a triangle on the GPU.
pub const PROXY_CUT_TRIANGLES: usize = 16_384;
/// The finest grid a cut's proxy snaps to, as a share of the cut's longest extent: `2⁻¹⁰`.
pub const PROXY_CUT_CELL_SHARE: f64 = 1.0 / 1024.0;
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

/// A mesh's proxy columns, in its own space: the triangles, their albedo (one value a mesh, white for a
/// cut the world made: its instance carries the material), the wide nodes, and the grid step taken (`cell`, metres of the cut's units).
#[derive(Default)]
pub struct CutColumns {
    pub triangles: Vec<f32>,
    pub albedo: Vec<u32>,
    pub node_bounds: Vec<f32>,
    pub node_children: Vec<u32>,
    pub cell: f64,
}

/// The proxy of one cut at run time, by the builder the compiler's meshes go through
/// (`columns_of`): `indices` over `positions` are placed as triangles.
pub fn cut_columns(indices: &[u32], positions: &[f32]) -> CutColumns {
    let mut triangles = Vec::with_capacity(indices.len() * 3);
    for corner in indices {
        let at = *corner as usize * 3;
        triangles.extend_from_slice(positions.get(at..at + 3).unwrap_or(&[0.0; 3]));
    }
    columns_of(triangles, 0xffff_ffff)
}

/// THE PROXY OF A MESH, in the mesh's own space: `triangles` (three vertices each) of one `albedo`,
/// snapped to the finest grid of `PROXY_CUT_CELL_SHARE` of the longest extent that leaves at most
/// `PROXY_CUT_TRIANGLES`, no triangle subdivided, built into the wide tree. The compiler calls it for
/// each compiled mesh (`proxy.bin`), the browser for each cut the world makes at run time
/// (`cut_columns`): one builder, one structure.
pub fn columns_of(mut triangles: Vec<f32>, albedo: u32) -> CutColumns {
    triangles.truncate(triangles.len() / PROXY_TRIANGLE_FLOATS * PROXY_TRIANGLE_FLOATS);
    let extent = bvh::extent(&triangles);
    let longest = (0..3)
        .map(|axis| extent[3 + axis] - extent[axis])
        .fold(0.0, f64::max);
    let cell = simplify::plan_cell(
        &triangles,
        longest * PROXY_CUT_CELL_SHARE,
        PROXY_CUT_TRIANGLES,
    );
    let mut colours = vec![albedo; triangles.len() / PROXY_TRIANGLE_FLOATS];
    let built = build_columns(&mut triangles, &mut colours, cell);
    CutColumns {
        triangles,
        albedo: colours,
        node_bounds: built.node_bounds,
        node_children: built.node_children,
        cell,
    }
}

#[cfg(test)]
#[path = "proxy_tests.rs"]
mod tests;
