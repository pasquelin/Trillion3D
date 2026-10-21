//! The simplifier's attributes: normals and texture sets count in the error.
use super::simplify;
use crate::simplify::*;

/// A flat `n` by `n` grid on z = 0, one vertex per corner, `u` running with x.
fn plane(n: usize) -> (Vec<f32>, Vec<u32>) {
    let mut positions = Vec::new();
    for y in 0..=n {
        for x in 0..=n {
            positions.extend([x as f32, y as f32, 0.0]);
        }
    }
    let w = n + 1;
    let indices = crate::tests::fixtures::grid_indices(n, n, |x, y| (y * w + x) as u32);
    (positions, indices)
}

/// Normals leaning a different way at every vertex of `plane(n)`.
fn wavy_normals(n: usize) -> Vec<f32> {
    (0..(n + 1) * (n + 1))
        .flat_map(|v| {
            let (x, y) = ((v % (n + 1)) as f32, (v / (n + 1)) as f32);
            let (a, b) = ((x * 1.3).sin() * 0.6, (y * 0.7).cos() * 0.6);
            let length = trillion3d_math::vector::vecn::length([a, b, 1.0]);
            [a / length, b / length, 1.0 / length]
        })
        .collect()
}

// Behaviour: on a flat plane positions alone cost nothing; normals that lean count in the error.
#[test]
fn normals_count_in_the_error() {
    let (positions, indices) = plane(16);
    let normals = wavy_normals(16);
    let attributes = [Attribute {
        values: &normals,
        width: 3,
        weight: 0.5,
        role: Role::Normal,
    }];
    let flat = simplify(&positions, &[], &indices, 64, &|_| false).expect("plane");
    let shaded = simplify(&positions, &attributes, &indices, 64, &|_| false).expect("plane");
    assert!(
        shaded.error_object > flat.error_object * 2.0,
        "the normals cost {} over {}",
        shaded.error_object,
        flat.error_object
    );
}

#[test]
#[should_panic]
fn a_vertex_an_attribute_lacks_is_refused_never_zero_filled() {
    // Normals for three of a region's four vertices: a cook defect, refused by the compaction.
    let normals = [0.0, 0.0, 1.0, 0.0, 0.0, 1.0, 0.0, 0.0, 1.0];
    let attribute = Attribute {
        values: &normals,
        width: 3,
        weight: 1.0,
        role: Role::Normal,
    };
    compact_attributes(&[attribute], &[0, 1, 2, 3]);
}
