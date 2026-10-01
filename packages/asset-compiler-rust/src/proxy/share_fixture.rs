use crate::proxy::{stage_proxy, ProxyInputs, SceneProxy, SCENE_PROXY_MAGIC};
use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet};
use std::f64::consts::FRAC_1_SQRT_2;

/// A 4×4 plate of half-metre cells, ridged every other vertex: the proxy grid keeps it and cuts
/// each triangle in four.
pub fn plate() -> Vec<f32> {
    let vertex = |i: usize, j: usize| [i as f32 * 0.5, ((i + j) % 2) as f32 * 0.5, j as f32 * 0.5];
    let mut out = Vec::new();
    for (i, j) in (0..4).flat_map(|i| (0..4).map(move |j| (i, j))) {
        for corners in [
            [(i, j), (i + 1, j), (i, j + 1)],
            [(i + 1, j), (i + 1, j + 1), (i, j + 1)],
        ] {
            for (x, y) in corners {
                out.extend_from_slice(&vertex(x, y));
            }
        }
    }
    out
}

/// `count` copies of `cut` on a 4 m lattice: one in three turned a quarter about Y, one in five
/// mirrored, one in seven off the proxy grid, one in eleven turned an eighth and moved by its own
/// fraction of a cell, which stays flat.
pub fn lattice(count: usize, cut: Vec<f32>) -> SceneProxy {
    let nodes: Vec<Value> = (0..count)
        .map(|i| {
            let odd = if i % 11 == 0 { 2 } else { 0 };
            let off = [0.0, 0.3, i as f64 * 0.013][odd.max(usize::from(i % 7 == 0))];
            let turn = [
                (0.0, 1.0),
                (FRAC_1_SQRT_2, FRAC_1_SQRT_2),
                (0.382_683_43, 0.923_879_5),
            ][odd.max(usize::from(i % 3 == 0))];
            let at = |axis: u32| (i / 10usize.pow(axis) % 10) as f64 * 4.0;
            json!({"mesh": 0, "rotation": [0.0, turn.0, 0.0, turn.1],
                "scale": [if i % 5 == 0 { -1.0 } else { 1.0 }, 1.0, 1.0],
                "translation": [at(0) + off, at(1), at(2)]})
        })
        .collect();
    let colour = json!({"baseColorFactor": [0.5, 0.25, 1.0, 1.0]});
    let g = json!({"nodes": nodes, "materials": [{"pbrMetallicRoughness": colour}]});
    let (shown, mesh_map) = (
        (0..count).collect::<BTreeSet<_>>(),
        BTreeMap::from([(0, 0)]),
    );
    let primitives = [json!({"mesh": 0, "material": 0})];
    let (cuts, thresholds) = ([cut], [0.05]);
    let inputs = ProxyInputs {
        g: &g,
        shown: &shown,
        mesh_map: &mesh_map,
        primitives: &primitives,
        cuts: &cuts,
        thresholds: &thresholds,
        previews: &[],
    };
    stage_proxy(&inputs).expect("proxy")
}

/// The flat columns (version 3's, then each source node's mesh, #966), encoded independently of
/// the sharing writer.
pub fn flat_file(proxy: &SceneProxy) -> Vec<u8> {
    let p = &proxy.provenance;
    let mut words = vec![
        SCENE_PROXY_MAGIC,
        3,
        proxy.triangle_count() as u32,
        proxy.node_count() as u32,
        p.group_offsets.len() as u32 - 1,
        p.owners.len() as u32 / 2,
        p.source_parents.len() as u32,
        0,
    ];
    words.extend(proxy.triangles.iter().map(|v| v.to_bits()));
    words.extend_from_slice(&proxy.albedo);
    words.extend(proxy.node_bounds.iter().map(|v| v.to_bits()));
    words.extend_from_slice(&proxy.node_children);
    words.extend_from_slice(&p.triangle_groups);
    words.extend_from_slice(&p.group_offsets);
    words.extend_from_slice(&p.owners);
    words.extend(p.source_parents.iter().map(|v| *v as u32));
    words.extend(p.source_meshes.iter().map(|v| *v as u32));
    let mut bytes: Vec<u8> = words.into_iter().flat_map(u32::to_le_bytes).collect();
    for v in &p.bind_worlds {
        bytes.extend_from_slice(&v.to_le_bytes());
    }
    bytes
}

pub fn binary_fixture() -> SceneProxy {
    lattice(60, vec![0.0, 0.0, 0.0, 0.5, 0.0, 0.0, 0.0, 0.0, 0.5])
}
