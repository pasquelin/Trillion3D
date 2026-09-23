//! H3 — proxy primitives indexed once per mesh, instead of scanning all
//! scene primitives for each retained node. Reference is old `stage_proxy` copy:
//! same triangles, same write order, same colors, same BVH.
use super::harness::{compare, Bits, Row};
use crate::compiler_validate::{item, required_index, values};
use crate::compiler_world::world_matrices;
use crate::proxy::assemble::assemble;
use crate::proxy::{albedo, place, stage_proxy, ProxyInputs, SceneProxy, PROXY_TRIANGLE_FLOATS};
use crate::Result;
use serde_json::Value;

#[path = "h3_proxy_sets.rs"]
mod jeux;

/// Copy of old `stage_proxy`: each node re-read all scene primitives for
/// retrouver celles de son maillage.
// Frozen "before" copy of `stage_proxy`, kept as the bench oracle: it must not share the live code.
// jscpd:ignore-start
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
    Ok(assemble(inputs.thresholds, triangles, colours))
}
// jscpd:ignore-end

/// Proxies of single run sets, in order.
type Proxys = Vec<SceneProxy>;

/// All proxy outputs, bit for bit: bounds, published threshold, mesh, triangles, colors and
/// both BVH columns, lengths included.
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

/// Four sets passed to step, in order: single output to compare and measure.
fn tous(jeux: &[jeux::Jeu], etape: fn(&ProxyInputs<'_>) -> Result<SceneProxy>) -> Proxys {
    jeux.iter()
        .map(|jeu| etape(&jeu.inputs()).expect("proxy"))
        .collect()
}

pub(crate) fn row() -> Row {
    let jeux = jeux::jeux();
    compare(
        "H3 proxy primitives indexed by mesh",
        "proxy.rs",
        "four sets: 200/6 000, 3 000/24, 2 000/40 and 4 000/4 000 nodes on primitives".into(),
        &mut || tous(&jeux, reference_stage_proxy),
        &mut || tous(&jeux, stage_proxy),
        empreinte,
    )
}

#[cfg(test)]
#[path = "h3_proxy_tests.rs"]
mod tests;
