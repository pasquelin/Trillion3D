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
        skin: Some((joints, weights)),
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
    let expected = [179.0 / 255.0, 76.0 / 255.0, 0.0, 0.0];
    assert_eq!(weights[4..8], expected);
    for vertex in weights.chunks(4) {
        assert!((vertex.iter().sum::<f32>() - 1.0).abs() < 1e-6);
    }
    let targets = decoded.attribute(7).expect("targets");
    assert_eq!(targets[6..12], [0.0, 0.5, 0.0, 0.0, 0.0, 0.0]);
}

#[test]
fn weights_sum_to_the_scale_whatever_their_rounding() {
    assert_eq!(quantize_weights([0.25; 4]), [64, 64, 64, 63]);
    assert_eq!(quantize_weights([0.0; 4]), [255, 0, 0, 0]);
    let odd = quantize_weights([0.1, 0.2, 0.3, 0.4]);
    assert_eq!(odd.iter().sum::<u32>(), 255);
}
