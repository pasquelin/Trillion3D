//! End of proxy step: world triangles to column-structured format.
use super::share::{self, Placed};
use super::{
    bvh, simplify, wide, SceneProxy, PROXY_CELL_METRES, PROXY_ERROR_METRES, PROXY_TRIANGLE_BUDGET,
};

/// Simplifies placed triangles, builds wide BVH, publishes obtained threshold: max
/// requested cut threshold, plus simplification cell addition. With no placement in `placed`,
/// nothing is shared.
pub(crate) fn assemble(
    thresholds: &[f64],
    mut triangles: Vec<f32>,
    colours: Vec<u32>,
    placed: &Placed,
) -> SceneProxy {
    // DAG cut stops at root; proxy simplification goes as far as
    // needed, delivering bounded-size triangles to surface cache.
    let cell = simplify::plan_cell(&triangles, PROXY_CELL_METRES, PROXY_TRIANGLE_BUDGET);
    // Simplification and the BVH carry a column along their triangles: carrying ranks instead of
    // albedos leaves the triangles as they were and tells where each one came from.
    let count = (triangles.len() / super::PROXY_TRIANGLE_FLOATS) as u32;
    let mut source: Vec<u32> = (0..count).collect();
    simplify::simplify(&mut triangles, &mut source, cell);
    let mut rank: Vec<u32> = (0..source.len() as u32).collect();
    let (node_bounds, node_children) = wide::collapse(&bvh::build(&mut triangles, &mut rank));
    let origin = |r: &u32| source[*r as usize] as usize;
    // A triangle past `colours` reads opaque white, as simplification always read it.
    let albedo: Vec<u32> = rank
        .iter()
        .map(|r| colours.get(origin(r)).copied().unwrap_or(0xffff_ffff))
        .collect();
    let sharing = if placed.placements.is_empty() {
        share::Sharing::default()
    } else {
        let owner: Vec<u32> = rank.iter().map(|r| placed.owners[origin(r)]).collect();
        share::share(&triangles, &albedo, &owner, &rank, &placed.placements)
    };
    let cut_error = thresholds
        .iter()
        .copied()
        .fold(PROXY_ERROR_METRES, f64::max);
    SceneProxy {
        bounds: bvh::extent(&triangles),
        error_metres: cut_error + cell * simplify::CELL_ERROR_FACTOR,
        cell_metres: cell,
        triangles,
        albedo,
        node_bounds,
        node_children,
        sharing,
    }
}
