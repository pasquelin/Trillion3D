//! La fin de l'étape du proxy : des triangles monde déjà posés à la structure écrite en colonnes.
use super::{
    bvh, simplify, wide, SceneProxy, PROXY_CELL_METRES, PROXY_ERROR_METRES, PROXY_TRIANGLE_BUDGET,
};

/// Simplifie les triangles posés, construit le BVH large et publie le seuil obtenu : le plus grand
/// seuil de coupe demandé, plus ce que la maille de simplification y ajoute.
pub(crate) fn assemble(
    thresholds: &[f64],
    mut triangles: Vec<f32>,
    mut colours: Vec<u32>,
) -> SceneProxy {
    // La coupe du DAG s'arrête à sa racine ; la simplification du proxy, elle, va aussi loin qu'il
    // le faut, et donne au passage des triangles de taille bornée au cache de surfaces.
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
