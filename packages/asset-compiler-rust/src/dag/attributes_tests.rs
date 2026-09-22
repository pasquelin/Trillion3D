//! The weights the region derives: what one unit of each attribute is worth in object units.
use super::*;
use crate::dag::tests::grid;

/// A flat `n` by `n` sheet of unit cells, its normal up and its texture coordinates laid over
/// the whole sheet: one unit of `u` spans the sheet's `n` world units, one unit of `v` spans
/// `n / stretch` of them.
fn sheet(n: usize, stretch: f32) -> (Vec<f32>, Vec<u32>, Vec<Attribute>) {
    let (mut positions, indices) = grid(n);
    for vertex in positions.as_chunks_mut::<3>().0 {
        vertex[2] = 0.0;
    }
    let chunks = positions.as_chunks::<3>().0.to_vec();
    let attributes = vec![
        Attribute {
            flag: FLAG_NORMAL,
            width: 3,
            values: chunks.iter().flat_map(|_| [0.0, 0.0, 1.0]).collect(),
        },
        Attribute {
            flag: FLAG_UV,
            width: 2,
            values: chunks
                .iter()
                .flat_map(|[x, y, _]| [x / n as f32, y * stretch / n as f32])
                .collect(),
        },
    ];
    (positions, indices, attributes)
}

// Behaviour: the weight of a texture coordinate is the world length one of its units spans, per
// component: a chart laid over `n` world units weighs `n`, and a `v` stretched twice weighs
// half as much, since one unit of it then covers half the sheet.
#[test]
fn a_texture_weight_is_the_world_length_one_of_its_units_spans() {
    let n = 16usize;
    let (positions, indices, attributes) = sheet(n, 2.0);
    let weights = component_weights(&positions, &indices, &attributes);
    assert_eq!(weights.len(), 5, "three normal components and two texture");
    assert!(
        (weights[3] - n as f32).abs() < 1e-3,
        "u weighs {}",
        weights[3]
    );
    assert!(
        (weights[4] - n as f32 / 2.0).abs() < 1e-3,
        "v weighs {}",
        weights[4]
    );
}

// Behaviour: the weight of a normal is the region's edge length — what one unit of tilt over an
// edge displaces the shading plane by. On a sheet of unit cells that is the root mean square of
// 1, 1 and the diagonal, area-weighted over every triangle.
#[test]
fn a_normal_weighs_the_edge_length_of_its_region() {
    let (positions, indices, attributes) = sheet(16, 1.0);
    let weights = component_weights(&positions, &indices, &attributes);
    let expected = ((1.0 + 1.0 + 2.0_f64) / 3.0).sqrt() as f32;
    for weight in &weights[..3] {
        assert!((weight - expected).abs() < 1e-3, "normal weighs {weight}");
    }
}

// Behaviour: a texture set no triangle parameterises weighs zero, which keeps it out of the
// error entirely instead of weighing it at whatever a degenerate Jacobian produced.
#[test]
fn a_texture_no_triangle_parameterises_weighs_nothing() {
    let (positions, indices, mut attributes) = sheet(8, 1.0);
    attributes[1].values.iter_mut().for_each(|v| *v = 0.25);
    let weights = component_weights(&positions, &indices, &attributes);
    assert_eq!(&weights[3..], &[0.0, 0.0]);
    assert!(weights[0] > 0.0, "the normal still weighs its edge");
}

// Behaviour: an attribute the page does not carry in the error — a tangent, say — weighs zero,
// so its value is neither read nor ranked.
#[test]
fn an_attribute_outside_the_error_weighs_nothing() {
    let (positions, indices, _) = sheet(8, 1.0);
    let unknown = vec![Attribute {
        flag: u32::MAX,
        width: 4,
        values: vec![1.0; positions.len() / 3 * 4],
    }];
    assert_eq!(component_weights(&positions, &indices, &unknown), [0.0; 4]);
}
