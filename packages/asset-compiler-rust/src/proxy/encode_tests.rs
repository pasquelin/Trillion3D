use crate::proxy::assemble::assemble;
use crate::proxy::share::{apply, Placed, PROXY_TRANSFORM_FLOATS};
use crate::proxy::{stage_proxy, ProxyInputs, PROXY_TRIANGLE_FLOATS, SCENE_PROXY_HEADER_WORDS};
use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet};
use std::f64::consts::FRAC_1_SQRT_2;

/// The file read back as the engine's reader does (`sdk-core/src/scene/core/proxy.ts`): shared
/// runs placed by their maps at their positions, the other triangles in order in the gaps.
fn expand(bytes: &[u8]) -> (Vec<f32>, Vec<u32>, Vec<u32>) {
    let words: Vec<u32> = bytes
        .as_chunks::<4>()
        .0
        .iter()
        .map(|b| u32::from_le_bytes(*b))
        .collect();
    let [_, _, count, nodes, shapes, shape_count, instances] =
        [0, 1, 2, 3, 4, 5, 6].map(|i| words[i] as usize);
    let mut at = SCENE_PROXY_HEADER_WORDS;
    let mut take = |n: usize| {
        at += n;
        words[at - n..at].to_vec()
    };
    let counts = take(shapes);
    let shape_vertices = take(shape_count * PROXY_TRIANGLE_FLOATS);
    let shape_albedo = take(shape_count);
    let of = take(instances);
    let maps = take(instances * PROXY_TRANSFORM_FLOATS);
    let starts: Vec<usize> = counts
        .iter()
        .scan(0, |sum, n| {
            *sum += *n as usize;
            Some(*sum - *n as usize)
        })
        .collect();
    let placed: usize = of.iter().map(|s| counts[*s as usize] as usize).sum();
    let positions = take(placed);
    let loose_vertices = take((count - placed) * PROXY_TRIANGLE_FLOATS);
    let loose_albedo = take(count - placed);
    let rest = take(nodes * 18);
    assert_eq!(at, words.len(), "the header names every word");
    let mut triangles = vec![0f32; count * PROXY_TRIANGLE_FLOATS];
    let mut albedo = vec![0u32; count];
    let mut taken = vec![false; count];
    let mut next = positions.iter();
    for (instance, shape) in of.iter().enumerate() {
        let m: [f32; 12] = std::array::from_fn(|i| f32::from_bits(maps[instance * 12 + i]));
        let start = starts[*shape as usize];
        for j in start..start + counts[*shape as usize] as usize {
            let p = *next.next().unwrap() as usize;
            taken[p] = true;
            albedo[p] = shape_albedo[j];
            for v in 0..3 {
                let vertex = shape_vertices[j * 9 + v * 3..j * 9 + v * 3 + 3]
                    .iter()
                    .map(|w| f32::from_bits(*w))
                    .collect::<Vec<_>>();
                triangles[p * 9 + v * 3..p * 9 + v * 3 + 3].copy_from_slice(&apply(&m, &vertex));
            }
        }
    }
    for (slot, p) in (0..count).filter(|p| !taken[*p]).enumerate() {
        albedo[p] = loose_albedo[slot];
        for k in 0..9 {
            triangles[p * 9 + k] = f32::from_bits(loose_vertices[slot * 9 + k]);
        }
    }
    (triangles, albedo, rest)
}

fn bits(values: &[f32]) -> Vec<u32> {
    values.iter().map(|v| v.to_bits()).collect()
}

/// A 4×4 plate of half-metre cells, ridged every other vertex: the proxy grid keeps it and cuts
/// each triangle in four.
pub(crate) fn plate() -> Vec<f32> {
    let vertex = |i: usize, j: usize| [i as f32 * 0.5, ((i + j) % 2) as f32 * 0.5, j as f32 * 0.5];
    let mut out = Vec::new();
    for i in 0..4 {
        for j in 0..4 {
            for [a, b, c] in [
                [(i, j), (i + 1, j), (i, j + 1)],
                [(i + 1, j), (i + 1, j + 1), (i, j + 1)],
            ] {
                for (x, y) in [a, b, c] {
                    out.extend_from_slice(&vertex(x, y));
                }
            }
        }
    }
    out
}

/// The audit's many-instance case: one plate placed 1,000 times on a 4 m lattice, one in three
/// turned a quarter about Y, one in five mirrored, one in seven off the proxy grid, and one in
/// eleven turned an eighth and moved by its own fraction of a cell, which must stay flat.
#[test]
fn a_thousand_instances_expand_to_the_flat_proxy_bit_for_bit() {
    let nodes: Vec<Value> = (0..1000usize)
        .map(|i| {
            let off = [0.0, 0.3, i as f64 * 0.013][if i % 11 == 0 {
                2
            } else {
                usize::from(i % 7 == 0)
            }];
            let turn = [
                (0.0, 1.0),
                (FRAC_1_SQRT_2, FRAC_1_SQRT_2),
                (0.382_683_43, 0.923_879_5),
            ][if i % 11 == 0 {
                2
            } else {
                usize::from(i % 3 == 0)
            }];
            let mirror = i % 5 == 0;
            let lattice = |axis: usize| (i / 10usize.pow(axis as u32) % 10) as f64 * 4.0;
            json!({"mesh": 0, "rotation": [0.0, turn.0, 0.0, turn.1],
                "scale": [if mirror { -1.0 } else { 1.0 }, 1.0, 1.0],
                "translation": [lattice(0) + off, lattice(1), lattice(2)]})
        })
        .collect();
    let colour = json!({"baseColorFactor": [0.5, 0.25, 1.0, 1.0]});
    let g = json!({"nodes": nodes, "materials": [{"pbrMetallicRoughness": colour}]});
    let (shown, mesh_map) = ((0..1000).collect::<BTreeSet<_>>(), BTreeMap::from([(0, 0)]));
    let primitives = [json!({"mesh": 0, "material": 0})];
    let proxy = stage_proxy(&ProxyInputs {
        g: &g,
        shown: &shown,
        mesh_map: &mesh_map,
        primitives: &primitives,
        cuts: &[plate()],
        thresholds: &[0.05],
        previews: &[],
    })
    .expect("proxy");
    let bytes = proxy.encode();
    let (triangles, albedo, nodes) = expand(&bytes);
    assert_eq!(bits(&triangles), bits(&proxy.triangles));
    assert_eq!(albedo, proxy.albedo);
    assert_eq!(
        nodes,
        [bits(&proxy.node_bounds), proxy.node_children.clone()].concat()
    );
    let flat = 4 * (4 + proxy.triangle_count() * 10 + proxy.node_count() * 18);
    let (shared, count) = (proxy.sharing.instances.len(), proxy.triangle_count());
    eprintln!(
        "proxy.bin: develop {flat} B, branch {} B, {count} triangles, {shared}/1000 shared",
        bytes.len()
    );
    assert!(
        bytes.len() * 2 < flat,
        "sharing must at least halve the file"
    );
    assert!(
        proxy.sharing.positions.len() < count,
        "the eighth turns stay flat"
    );
}

#[test]
fn no_instance_writes_the_header_alone() {
    let proxy = assemble(&[], Vec::new(), Vec::new(), &Placed::default());
    assert_eq!(proxy.encode().len(), SCENE_PROXY_HEADER_WORDS * 4);
    assert!(expand(&proxy.encode()).0.is_empty());
}
