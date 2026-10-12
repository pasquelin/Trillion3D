//! The resident proxy's builder, shared by the native compiler and the browser's one WebAssembly
//! module: the layout numbers of its columns and the three steps that turn placed triangles into
//! them — grid snapping (`simplify.rs`), the binary BVH (`bvh.rs`) and its 4-wide collapse
//! (`wide.rs`). The compiler places a scene's triangles in world space and calls them
//! (`asset-compiler-rust/src/proxy.rs`); the run-time cut calls them on a cut's own triangles. The constants
//! below are printed into the TypeScript readers (`scripts/generate-shared-rules.ts`).

pub mod bvh;
pub mod simplify;
pub mod wide;

/// What `build_columns` leaves besides the triangles and albedos it rewrites in place: the node
/// columns, the original rank of each retained triangle before the BVH order (`retained`) and the
/// BVH order itself (`order`), for the compiler's parallel provenance columns.
pub struct Built {
    pub retained: Vec<usize>,
    pub order: Vec<usize>,
    pub node_bounds: Vec<f32>,
    pub node_children: Vec<u32>,
}

/// THE PROXY BUILDER, one for the compiler's scene and the browser's cut: snaps `triangles` to the
/// grid `cell` (`simplify::plan_cell` chose it), dropping what has no area and what repeats —
/// subdividing what is wider than `cell` where `split` — builds the BVH, reorders the triangles and
/// `albedo` into its leaves' order, and collapses it to the wide node columns.
pub fn build_columns(
    triangles: &mut Vec<f32>,
    albedo: &mut Vec<u32>,
    cell: f64,
    split: bool,
) -> Built {
    let retained = simplify::simplify_sources(triangles, albedo, cell, split);
    let (tree, order) = bvh::build_ordered(triangles, albedo);
    let (node_bounds, node_children) = wide::collapse(&tree);
    Built {
        retained,
        order,
        node_bounds,
        node_children,
    }
}

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

/// A cut's proxy columns, in the cut's own space: the triangles, their albedo (white: the instance
/// carries the material's), the wide nodes, and the grid step taken (`cell`, metres of the cut's units).
pub struct CutColumns {
    pub triangles: Vec<f32>,
    pub albedo: Vec<u32>,
    pub node_bounds: Vec<f32>,
    pub node_children: Vec<u32>,
    pub cell: f64,
}

/// The proxy of one cut at run time, by the builder the compiler's scene goes through
/// (`build_columns`): `indices` over `positions` are placed as triangles, the grid is the finest of
/// `PROXY_CUT_CELL_SHARE` of the longest extent that leaves at most `PROXY_CUT_TRIANGLES`, no
/// triangle subdivided.
pub fn cut_columns(indices: &[u32], positions: &[f32]) -> CutColumns {
    let mut triangles = Vec::with_capacity(indices.len() * 3);
    for corner in indices {
        let at = *corner as usize * 3;
        triangles.extend_from_slice(positions.get(at..at + 3).unwrap_or(&[0.0; 3]));
    }
    triangles.truncate(triangles.len() / PROXY_TRIANGLE_FLOATS * PROXY_TRIANGLE_FLOATS);
    let extent = bvh::extent(&triangles);
    let longest = (0..3)
        .map(|axis| extent[3 + axis] - extent[axis])
        .fold(0.0, f64::max);
    let cell = simplify::plan_cell(
        &triangles,
        longest * PROXY_CUT_CELL_SHARE,
        PROXY_CUT_TRIANGLES,
        false,
    );
    let mut albedo = vec![0xffff_ffff; triangles.len() / PROXY_TRIANGLE_FLOATS];
    let built = build_columns(&mut triangles, &mut albedo, cell, false);
    CutColumns {
        triangles,
        albedo,
        node_bounds: built.node_bounds,
        node_children: built.node_children,
        cell,
    }
}

#[cfg(test)]
#[path = "proxy_tests.rs"]
mod tests;
