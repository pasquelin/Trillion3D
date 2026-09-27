//! Meshes of identical content are shared before the cook (#931, CMP-11): the bytes decide, never
//! the names, and one differing bit keeps two meshes apart.
use super::*;
use crate::compiler_mesh_share::share_identical_meshes;
use crate::import::f32_bytes;

const TRIANGLE: [f32; 9] = [0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0];

/// A scene of two meshes, one node each, whose positions are `first` then `second` (three
/// vertices each, tightly packed), changed by `tweak`; the mesh each node names once shared.
fn shared(first: &[f32], second: &[f32], tweak: impl FnOnce(&mut Value)) -> Vec<u64> {
    let bin = [f32_bytes(first), f32_bytes(second)].concat();
    let view = |at: usize| json!({"buffer":0,"byteOffset":at,"byteLength":36});
    let accessor =
        |view: usize| json!({"bufferView":view,"componentType":5126,"type":"VEC3","count":3});
    let mesh = |name: &str, accessor: usize| json!({"name":name,"primitives":[{"attributes":{"POSITION":accessor},"material":0}]});
    let mut g = json!({
        "bufferViews":[view(0), view(36)], "accessors":[accessor(0), accessor(1)],
        "meshes":[mesh("rock", 0), mesh("rock.001", 1)], "nodes":[{"mesh":0},{"mesh":1}],
    });
    tweak(&mut g);
    share_identical_meshes(&mut g, &bin);
    let nodes = g["nodes"].as_array().expect("nodes");
    nodes.iter().filter_map(|n| n["mesh"].as_u64()).collect()
}

#[test]
fn two_copies_of_one_content_become_one_mesh_whatever_their_names() {
    assert_eq!(shared(&TRIANGLE, &TRIANGLE, |_| {}), [0, 0]);
}

#[test]
fn one_differing_bit_keeps_two_meshes_apart() {
    let mut zero = TRIANGLE;
    zero[0] = -0.0;
    assert_eq!(shared(&TRIANGLE, &zero, |_| {}), [0, 1], "-0 against +0");
    let (mut quiet, mut other) = (TRIANGLE, TRIANGLE);
    quiet[4] = f32::from_bits(0x7fc0_0001);
    other[4] = f32::from_bits(0x7fc0_0002);
    assert_eq!(shared(&quiet, &other, |_| {}), [0, 1], "two NaN payloads");
    assert_eq!(shared(&quiet, &quiet, |_| {}), [0, 0], "one NaN payload");
    let mut far = TRIANGLE;
    far[8] = f32::INFINITY;
    assert_eq!(shared(&TRIANGLE, &far, |_| {}), [0, 1], "+Inf against 0");
    assert_eq!(shared(&far, &far, |_| {}), [0, 0], "+Inf twice");
    let mut largest = TRIANGLE;
    largest[3] = f32::MAX;
    assert_eq!(
        shared(&TRIANGLE, &largest, |_| {}),
        [0, 1],
        "f32::MAX against 1"
    );
}

/// A change made to the two-mesh scene before it is shared.
type Tweak = fn(&mut Value);

#[test]
fn a_different_declaration_keeps_two_meshes_apart() {
    let apart: [(&str, Tweak); 5] = [
        ("material", |g| {
            g["meshes"][1]["primitives"][0]["material"] = json!(1)
        }),
        ("skinned node", |g| g["nodes"][1]["skin"] = json!(0)),
        ("declared bounds", |g| {
            g["accessors"][1]["max"] = json!([1, 1, 0])
        }),
        ("mesh extras", |g| {
            g["meshes"][1]["extras"] = json!({"id":2})
        }),
        (
            "sparse",
            |g| g["accessors"][1]["sparse"] = json!({"count":0,"indices":{"bufferView":0,"componentType":5125},"values":{"bufferView":0}}),
        ),
    ];
    for (reason, tweak) in apart {
        assert_eq!(shared(&TRIANGLE, &TRIANGLE, tweak), [0, 1], "{reason}");
    }
}

#[test]
fn a_strided_copy_is_the_same_content_and_a_third_mesh_joins_the_first() {
    // The second copy interleaves a padding float after each vertex: stride 16.
    let padded: Vec<f32> = TRIANGLE
        .chunks(3)
        .flat_map(|v| [v[0], v[1], v[2], 7.0])
        .collect();
    let bin = [
        f32_bytes(&TRIANGLE),
        f32_bytes(&padded),
        f32_bytes(&TRIANGLE),
    ]
    .concat();
    let accessors =
        [0, 1, 2].map(|v| json!({"bufferView":v,"componentType":5126,"type":"VEC3","count":3}));
    let meshes = [0, 1, 2].map(|a| json!({"primitives":[{"attributes":{"POSITION":a}}]}));
    let mut g = json!({
        "bufferViews":[{"buffer":0,"byteLength":36},{"buffer":0,"byteOffset":36,"byteLength":48,"byteStride":16},{"buffer":0,"byteOffset":84,"byteLength":36}],
        "accessors":accessors, "meshes":meshes,
        "nodes":[{"mesh":2},{"mesh":1},{"mesh":0},{"name":"empty"}],
    });
    assert_eq!(share_identical_meshes(&mut g, &bin), 2);
    assert_eq!(
        g["nodes"],
        json!([{"mesh":0},{"mesh":0},{"mesh":0},{"name":"empty"}])
    );
}

#[test]
fn a_scene_without_meshes_or_with_an_unreadable_one_is_left_as_it_is() {
    for mut g in [
        json!({}),
        json!({"nodes":[]}),
        json!({"meshes":[],"nodes":[{"mesh":4}]}),
        json!({"meshes":[{"primitives":[{"attributes":{"POSITION":8}}]},{"primitives":[{"attributes":{"POSITION":9}}]}],"nodes":[{"mesh":0},{"mesh":1}]}),
    ] {
        let before = g.clone();
        assert_eq!(share_identical_meshes(&mut g, &[]), 0);
        assert_eq!(g, before);
    }
}
