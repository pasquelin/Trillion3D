//! A skinned, morphed page written by the compiler reads back through the shared decoder.

use super::*;
use crate::geometry_page::encode_deformed;
use crate::geometry_page_quant::UV_EXPONENT;

/// Two triangles on four vertices; vertices 1 and 3 stand at the same place with other joints.
const POSITIONS: [f32; 12] = [0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 1.0, 0.0, 0.0];

fn deformation() -> Deformation {
    let joints = vec![3, 4, 0, 0, 5, 3, 0, 0, 4, 4, 4, 4, 7, 0, 0, 0];
    let weights = vec![
        0.5, 0.5, 0.0, 0.0, 0.7, 0.3, 0.0, 0.0, 0.25, 0.25, 0.25, 0.25, 1.0, 0.0, 0.0, 0.0,
    ];
    let lift = [0.0, 0.5, 0.0];
    Deformation {
        influences: 4,
        skin: Some((joints, weights)),
        soft_source: None,
        targets: vec![MorphTarget {
            position: lift.repeat(4),
            normal: None,
        }],
    }
}

#[test]
fn joints_weights_and_targets_read_back_and_keep_vertices_apart() {
    let indices = [0, 1, 2, 2, 3, 0];
    let page = encode_deformed(
        &indices,
        &POSITIONS,
        &[],
        (&deformation(), &[]),
        (-8, UV_EXPONENT),
    )
    .expect("encode");
    let decoded = trillion3d_page_codec::decode(&page.bytes, 1 << 24).expect("decode");
    // Vertex 3 deforms on other joints than vertex 1: it is not merged into it.
    assert_eq!(decoded.vertex_count, 4);
    let joints = decoded.attribute(5).expect("joints");
    assert_eq!(joints[4..8], [5.0, 3.0, 0.0, 0.0]);
    assert_eq!(joints[12..16], [7.0, 0.0, 0.0, 0.0]);
    let weights = decoded.attribute(6).expect("weights");
    let expected = [0.7, 0.3, 0.0, 0.0];
    assert_eq!(weights[4..8], expected);
    for vertex in weights.chunks(4) {
        assert!((vertex.iter().sum::<f32>() - 1.0).abs() < 1e-6);
    }
    let targets = decoded.attribute(7).expect("targets");
    assert_eq!(targets[6..12], [0.0, 0.5, 0.0, 0.0, 0.0, 0.0]);
}

#[test]
fn soft_ids_survive_welding_permutation_and_reduction_origins() {
    let mut deformation = Deformation::default();
    let source = serde_json::json!({"nodes":[{"mesh":0,"extras":{"physics":{"type":"cloth"}}}]});
    deformation
        .soft_source(&source, 0, &POSITIONS)
        .expect("soft mapping");
    // The declared kind reaches the manifest: the runtime draws a cloth on both faces.
    assert_eq!(deformation.soft_source, Some("cloth"));
    assert_eq!(deformation.reach(&POSITIONS)["softKind"], "cloth");
    let mut positions = POSITIONS.to_vec();
    // A reduction's new point follows source vertex 2's displacement, not its absolute position.
    positions.extend([0.25, 1.0, 0.0]);
    let page = encode_deformed(
        &[4, 3, 0, 0, 1, 4],
        &positions,
        &[],
        (&deformation, &[2]),
        (-8, UV_EXPONENT),
    )
    .expect("encode");
    assert_ne!(
        page.header.flags & trillion3d_page_codec::FLAG_SOFT_SOURCE,
        0
    );
    let decoded = trillion3d_page_codec::decode(&page.bytes, 1 << 24).expect("decode");
    // The duplicate positions 1 and 3 weld to the same simulation ID, despite first-use order.
    assert_eq!(decoded.vertex_count, 3);
    assert_eq!(
        decoded.attribute(5).expect("source IDs"),
        &[2.0, 2.0, 2.0, 2.0, 1.0, 1.0, 1.0, 1.0, 0.0, 0.0, 0.0, 0.0]
    );
    assert_eq!(
        decoded.attribute(6).expect("source weights"),
        &[1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0]
    );
    // Rest offset survives: applying a source displacement cannot snap the reduced vertex.
    assert_eq!(
        &decoded.attribute(0).expect("positions")[..3],
        &[0.25, 1.0, 0.0]
    );
}

#[test]
fn all_influences_and_float_weights_survive_large_joint_separation() {
    let deform = Deformation {
        influences: 8,
        skin: Some(((0..8).cycle().take(24).collect(), vec![0.125; 24])),
        targets: vec![MorphTarget {
            position: vec![0.12345679; 9],
            normal: None,
        }],
        soft_source: None,
    };
    let page = encode_deformed(
        &[0, 1, 2],
        &POSITIONS[..9],
        &[],
        (&deform, &[]),
        (-8, UV_EXPONENT),
    )
    .unwrap();
    let decoded = trillion3d_page_codec::decode(&page.bytes, 1 << 24).unwrap();
    let weights = decoded.attribute(6).unwrap();
    assert_eq!(weights, &[0.125; 24]);
    let x: f32 = weights[..8]
        .iter()
        .enumerate()
        .map(|(j, w)| if j >= 4 { w * 8.0 } else { 0.0 })
        .sum();
    assert_eq!(x, 4.0);
    assert_eq!(decoded.attribute(7).unwrap()[0], 0.12345679);
    let mut half = deform;
    half.skin.as_mut().unwrap().1 = [0.5, 0.5, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0].repeat(3);
    let page = encode_deformed(
        &[0, 1, 2],
        &POSITIONS[..9],
        &[],
        (&half, &[]),
        (-8, UV_EXPONENT),
    )
    .unwrap();
    let decoded = trillion3d_page_codec::decode(&page.bytes, 1 << 24).unwrap();
    assert_eq!(decoded.attribute(6).unwrap()[1] * 1000.0, 500.0);
    let reach = half.reach(&POSITIONS[..9]);
    let delta = decoded.attribute(7).unwrap();
    let radius = trillion3d_math::vec3::length([0, 1, 2].map(|axis| f64::from(delta[axis])));
    assert!(reach["targets"][0].as_f64().unwrap() >= radius);
}

#[test]
fn a_joint_base_near_the_top_stays_within_what_the_reader_admits() {
    let joints = vec![65000, 65535, 65000, 65000];
    let mut fields = vec![Vec::new()];
    let skin = skin_fields(&joints, &[1.0, 0.0, 0.0, 0.0], 4, &[0], &mut fields).unwrap();
    assert_eq!(skin.bits, 10);
    assert!(u64::from(skin.base) + (1u64 << skin.bits) - 1 <= 0xffff);
    assert_eq!(fields[0][1] + skin.base, 65535);
}
