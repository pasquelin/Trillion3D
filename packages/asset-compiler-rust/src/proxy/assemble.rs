//! End of proxy step: world triangles to column-structured format.
use super::{
    bvh, simplify, wide, SceneProxy, PROXY_CELL_METRES, PROXY_ERROR_METRES, PROXY_TRIANGLE_BUDGET,
};

/// Simplifies placed triangles, builds wide BVH, publishes obtained threshold: max
/// requested cut threshold, plus simplification cell addition.
pub(crate) fn assemble(
    thresholds: &[f64],
    mut triangles: Vec<f32>,
    mut colours: Vec<u32>,
) -> SceneProxy {
    // DAG cut stops at root; proxy simplification goes as far as
    // needed, delivering bounded-size triangles to surface cache.
    let cell = simplify::plan_cell(&triangles, PROXY_CELL_METRES, PROXY_TRIANGLE_BUDGET);
    simplify::simplify(&mut triangles, &mut colours, cell);
    let (node_bounds, node_children) = wide::collapse(&bvh::build(&mut triangles, &mut colours));
    let cut_error = thresholds
        .iter()
        .copied()
        .fold(PROXY_ERROR_METRES, f64::max);
    SceneProxy {
        bounds: bvh::extent(&triangles),
        error_metres: cut_error + cell * simplify::CELL_ERROR_FACTOR,
        cell_metres: cell,
        triangles,
        albedo: colours,
        node_bounds,
        node_children,
    }
}
