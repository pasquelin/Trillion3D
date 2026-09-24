//! The simplifier's attribute-aware options (#484): normals and texture sets in the error, the
//! error clamped to the region, protected seams, pruned parts.
use super::tests::{CUBE_INDICES, CUBE_POSITIONS};
use super::*;

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
            let length = (a * a + b * b + 1.0).sqrt();
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
    }];
    let flat =
        simplify_with_locked_vertices(&positions, &[], &indices, 64, true, &|_| 0).expect("plane");
    let shaded = simplify_with_locked_vertices(&positions, &attributes, &indices, 64, true, &|_| 0)
        .expect("plane");
    assert!(
        shaded.error_object > flat.error_object * 2.0,
        "the normals cost {} over {}",
        shaded.error_object,
        flat.error_object
    );
}

// Behaviour: the attribute share never makes the error larger than the region itself.
#[test]
fn the_error_is_clamped_to_the_region_extent() {
    let (positions, indices) = plane(16);
    let normals = wavy_normals(16);
    let attributes = [Attribute {
        values: &normals,
        width: 3,
        weight: 1000.0,
    }];
    let reduced = simplify_with_locked_vertices(&positions, &attributes, &indices, 8, true, &|_| 0)
        .expect("plane");
    assert!(reduced.triangles < indices.len() / 3);
    assert!(reduced.error_object > 0.0 && reduced.error_object <= 16.0);
}

// Behaviour: a protected texture seam is never crossed: every coarse triangle stays on one chart.
#[test]
fn a_protected_seam_keeps_its_charts_apart() {
    let n = 16usize;
    let (mut positions, _) = plane(n);
    let w = n + 1;
    // The column x = n / 2 again, as the right chart's copies.
    let right_copy = (positions.len() / 3) as u32;
    for y in 0..=n {
        positions.extend([(n / 2) as f32, y as f32, 0.0]);
    }
    let vertex = |x: usize, y: usize, right: bool| match right && x == n / 2 {
        true => right_copy + y as u32,
        false => (y * w + x) as u32,
    };
    let mut indices = crate::tests::fixtures::grid_indices(n / 2, n, |x, y| vertex(x, y, false));
    indices.extend(crate::tests::fixtures::grid_indices(n / 2, n, |x, y| {
        vertex(x + n / 2, y, true)
    }));
    let right = |v: u32| v >= right_copy || v as usize % w > n / 2;
    let uvs: Vec<f32> = (0..positions.len() / 3)
        .flat_map(|v| {
            [
                positions[v * 3] / n as f32 + if right(v as u32) { 0.5 } else { 0.0 },
                0.0,
            ]
        })
        .collect();
    let attributes = [Attribute {
        values: &uvs,
        width: 2,
        weight: 1.0,
    }];
    let on_seam = |v: u32| v >= right_copy || v as usize % w == n / 2;
    let reduced =
        simplify_with_locked_vertices(&positions, &attributes, &indices, 32, true, &|v| {
            if on_seam(v) {
                VERTEX_PROTECT
            } else {
                0
            }
        })
        .expect("plane");
    assert!(reduced.triangles < indices.len() / 3);
    for tri in reduced.indices.as_chunks::<3>().0 {
        assert!(
            tri.iter().all(|&v| right(v)) || tri.iter().all(|&v| !right(v)),
            "a triangle crosses the seam: {tri:?}"
        );
    }
}

// Behaviour: pruning removes a small disconnected part that collapses cannot touch — even a
// locked one, which is why a reduction retrying with extra locks turns pruning off.
#[test]
fn pruning_removes_a_small_part_locks_or_not() {
    let (mut positions, mut indices) = plane(16);
    let first = (positions.len() / 3) as u32;
    positions.extend(CUBE_POSITIONS.iter().map(|&c| 30.0 + c * 0.01));
    indices.extend(CUBE_INDICES.iter().map(|&i| first + i));
    let small = |reduced: &SimplifiedMesh| reduced.indices.iter().any(|&v| v >= first);
    let locked = |v: u32| if v >= first { VERTEX_LOCK } else { 0 };
    let kept =
        simplify_with_locked_vertices(&positions, &[], &indices, 2, false, &locked).expect("plane");
    let pruned =
        simplify_with_locked_vertices(&positions, &[], &indices, 2, true, &locked).expect("plane");
    assert!(small(&kept), "without pruning the locked part stays");
    assert!(!small(&pruned), "pruning removes it all the same");
}
