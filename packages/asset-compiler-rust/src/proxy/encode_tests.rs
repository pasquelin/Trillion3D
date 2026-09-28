use crate::proxy::assemble::assemble;
use crate::proxy::share::Placed;
use crate::proxy::{stage_proxy, ProxyInputs, SceneProxy};
use crate::proxy::{SCENE_PROXY_HEADER_WORDS, SCENE_PROXY_MAGIC};
use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet};
use std::f64::consts::FRAC_1_SQRT_2;
use std::path::PathBuf;

/// A 4×4 plate of half-metre cells, ridged every other vertex: the proxy grid keeps it and cuts
/// each triangle in four.
pub(crate) fn plate() -> Vec<f32> {
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
fn lattice(count: usize, cut: Vec<f32>) -> SceneProxy {
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

/// Develop's flat `proxy.bin` (version 2): header, world vertices, albedos, node columns.
fn flat_file(proxy: &SceneProxy) -> Vec<u8> {
    let header = [
        SCENE_PROXY_MAGIC,
        2,
        proxy.triangle_count() as u32,
        proxy.node_count() as u32,
    ];
    let floats = proxy.triangles.iter().map(|v| v.to_bits());
    let bounds = proxy.node_bounds.iter().map(|v| v.to_bits());
    let words = header
        .into_iter()
        .chain(floats)
        .chain(proxy.albedo.iter().copied());
    let words = words
        .chain(bounds)
        .chain(proxy.node_children.iter().copied());
    words.flat_map(u32::to_le_bytes).collect()
}

#[test]
fn a_thousand_instances_store_under_half_the_flat_bytes() {
    let proxy = lattice(1000, plate());
    let (bytes, flat) = (proxy.encode().len(), flat_file(&proxy).len());
    let shared = proxy.sharing.instances.len();
    eprintln!("proxy.bin: develop {flat} B, branch {bytes} B, {shared}/1000 instances shared");
    assert!(bytes * 2 < flat, "sharing must at least halve the file");
    assert!(
        proxy.sharing.positions.len() < proxy.triangle_count(),
        "eighth turns stay flat"
    );
}

/// The writer's bytes for 60 copies of one triangle, and develop's flat file of the same proxy:
/// `sdk-core/src/scene/core/proxy.test.ts` reads the first and must find the second.
/// `T3D_WRITE_PROXY_FIXTURE=1` rewrites both.
#[test]
fn the_shared_file_the_reader_expands_is_the_committed_one() {
    let proxy = lattice(60, vec![0.0, 0.0, 0.0, 0.5, 0.0, 0.0, 0.0, 0.0, 0.5]);
    assert!(
        !proxy.sharing.instances.is_empty()
            && proxy.sharing.positions.len() < proxy.triangle_count()
    );
    let root =
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../sdk-core/src/scene/core/fixtures");
    for (name, bytes) in [
        ("proxy-v3.bin", proxy.encode()),
        ("proxy-flat.bin", flat_file(&proxy)),
    ] {
        if std::env::var_os("T3D_WRITE_PROXY_FIXTURE").is_some() {
            std::fs::create_dir_all(&root).expect("fixture folder");
            std::fs::write(root.join(name), &bytes).expect("fixture written");
        }
        assert_eq!(
            std::fs::read(root.join(name)).expect("fixture"),
            bytes,
            "{name}"
        );
    }
}

#[test]
fn no_instance_writes_the_header_alone() {
    let bytes = assemble(&[], Vec::new(), Vec::new(), &Placed::default()).encode();
    assert_eq!(bytes.len(), SCENE_PROXY_HEADER_WORDS * 4);
    assert!(
        bytes[8..].iter().all(|byte| *byte == 0),
        "no triangle, node, shape or instance"
    );
}
