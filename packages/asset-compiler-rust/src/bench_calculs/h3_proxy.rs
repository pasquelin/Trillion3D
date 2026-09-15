//! H3 — les primitives du proxy indexées une fois par maillage, au lieu d'un balayage de toutes les
//! primitives de la scène pour chaque nœud retenu. La référence est l'ancien `stage_proxy`, recopié
//! tel quel : mêmes triangles, même ordre d'écriture, mêmes couleurs, même BVH.
use super::harness::{compare, Bits, Row};
use crate::compiler_validate::{item, required_index, values};
use crate::compiler_world::world_matrices;
use crate::proxy::{
    albedo, bvh, place, simplify, stage_proxy, wide, ProxyInputs, SceneProxy, PROXY_CELL_METRES,
    PROXY_ERROR_METRES, PROXY_TRIANGLE_BUDGET, PROXY_TRIANGLE_FLOATS,
};
use crate::Result;
use serde_json::Value;

#[path = "h3_proxy_jeux.rs"]
mod jeux;

/// Copie de l'ancien `stage_proxy` : chaque nœud relisait toutes les primitives de la scène pour
/// retrouver celles de son maillage.
fn reference_stage_proxy(inputs: &ProxyInputs<'_>) -> Result<SceneProxy> {
    let world = world_matrices(inputs.g)?;
    let nodes = values(inputs.g, "nodes")?;
    let palette = albedo::material_albedo(inputs.g, inputs.previews);
    let mut triangles: Vec<f32> = Vec::new();
    let mut colours: Vec<u32> = Vec::new();
    for node_id in inputs.chosen {
        let node = item(nodes, *node_id, "node")?;
        let old_mesh = required_index(node.get("mesh"), "node.mesh")?;
        let Some(mesh_index) = inputs.mesh_map.get(&old_mesh).copied() else {
            continue;
        };
        let matrix = world[*node_id];
        for (index, primitive) in inputs.primitives.iter().enumerate() {
            if primitive.get("mesh").and_then(Value::as_u64) != Some(mesh_index as u64) {
                continue;
            }
            let Some(cut) = inputs.cuts.get(index) else {
                continue;
            };
            let colour = palette.of(primitive.get("material"));
            place(cut, &matrix, &mut triangles);
            colours.resize(triangles.len() / PROXY_TRIANGLE_FLOATS, colour);
        }
    }
    reference_finish(inputs, triangles, colours)
}

/// La fin de l'ancien `stage_proxy`, que le point ne touche pas : simplification, BVH, seuil publié.
fn reference_finish(
    inputs: &ProxyInputs<'_>,
    mut triangles: Vec<f32>,
    mut colours: Vec<u32>,
) -> Result<SceneProxy> {
    let cell = simplify::plan_cell(&triangles, PROXY_CELL_METRES, PROXY_TRIANGLE_BUDGET);
    simplify::simplify(&mut triangles, &mut colours, cell);
    let (node_bounds, node_children) = wide::collapse(&bvh::build(&mut triangles, &mut colours));
    let error = inputs
        .thresholds
        .iter()
        .copied()
        .fold(PROXY_ERROR_METRES, f64::max)
        + cell * simplify::CELL_ERROR_FACTOR;
    Ok(SceneProxy {
        bounds: bvh::extent(&triangles),
        error_metres: error,
        cell_metres: cell,
        triangles,
        albedo: colours,
        node_bounds,
        node_children,
    })
}

/// Les proxys des jeux d'un tour, dans l'ordre.
type Proxys = Vec<SceneProxy>;

/// Toutes les sorties d'un proxy, bit à bit : bornes, seuil publié, maille, triangles, couleurs et
/// les deux colonnes du BVH, longueurs comprises.
fn empreinte(sortie: &Proxys) -> Bits {
    let mut bits = Bits::default();
    bits.len(sortie.len());
    for proxy in sortie {
        for value in proxy.bounds {
            bits.f64(value);
        }
        bits.f64(proxy.error_metres);
        bits.f64(proxy.cell_metres);
        bits.len(proxy.triangles.len());
        bits.len(proxy.albedo.len());
        bits.len(proxy.node_bounds.len());
        bits.len(proxy.node_children.len());
        for value in proxy.triangles.iter().chain(proxy.node_bounds.iter()) {
            bits.f32(*value);
        }
        for value in proxy.albedo.iter().chain(proxy.node_children.iter()) {
            bits.u32(*value);
        }
    }
    bits
}

/// Les quatre jeux passés à une étape, dans l'ordre : une seule sortie à comparer et à mesurer.
fn tous(jeux: &[jeux::Jeu], etape: fn(&ProxyInputs<'_>) -> Result<SceneProxy>) -> Proxys {
    jeux.iter()
        .map(|jeu| etape(&jeu.inputs()).expect("proxy"))
        .collect()
}

pub(crate) fn row() -> Row {
    let jeux = jeux::jeux();
    compare(
        "H3 primitives du proxy indexées par maillage",
        "proxy.rs",
        "quatre jeux : 200/6 000, 3 000/24, 2 000/40 et 4 000/4 000 nœuds sur primitives".into(),
        &mut || tous(&jeux, reference_stage_proxy),
        &mut || tous(&jeux, stage_proxy),
        empreinte,
    )
}

#[cfg(test)]
#[path = "h3_proxy_tests.rs"]
mod tests;
