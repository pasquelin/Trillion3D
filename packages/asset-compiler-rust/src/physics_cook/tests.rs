use super::cut::tolerance;
use super::stage::trs;
use super::*;
use crate::dag::DagCluster;

/// The golden tile: a 2 × 2 m quad tilted up along x, two triangles, cooked by native Jolt. The
/// physics module's tests restore these very bytes (`packages/sdk-browser/src/physics`).
const RAMP: [f32; 12] = [0., 0., -1., 2., 1., -1., 2., 1., 1., 0., 0., 1.];
const RAMP_TRIANGLES: [u32; 6] = [0, 2, 1, 0, 3, 2];
const GOLDEN: &str = "../../tests/fixtures/physics/ramp-tile.bin";

// Behaviour: the cook is deterministic and its bytes are the golden ones the runtime restores.
#[test]
fn a_tile_cooks_to_the_same_golden_bytes() {
    let first = mesh_shape(&RAMP, &RAMP_TRIANGLES).unwrap();
    assert_eq!(first, mesh_shape(&RAMP, &RAMP_TRIANGLES).unwrap());
    if std::env::var_os("TRILLION3D_WRITE_GOLDEN").is_some() {
        std::fs::write(GOLDEN, &first).unwrap();
    }
    assert_eq!(
        first,
        std::fs::read(GOLDEN).unwrap(),
        "golden tile moved: {GOLDEN}"
    );
}

// Behaviour: a regular grid is detected, sample for sample; one vertex off the lattice is not a grid.
#[test]
fn a_regular_grid_becomes_a_height_field() {
    let (n, mut pos, mut triangles) = (5usize, Vec::new(), Vec::new());
    for z in 0..n {
        for x in 0..n {
            pos.extend([x as f32 * 0.5, (x * z) as f32 * 0.1, z as f32 * 0.5]);
        }
    }
    for z in 0..n - 1 {
        for x in 0..n - 1 {
            let i = (z * n + x) as u32;
            triangles.extend([
                i,
                i + n as u32,
                i + 1,
                i + 1,
                i + n as u32,
                i + n as u32 + 1,
            ]);
        }
    }
    let grid = height::detect(&pos, &triangles).expect("a grid");
    assert_eq!((grid.size, grid.cells), (6, [4, 4]));
    assert_eq!(grid.samples[3 * grid.size + 2], 0.6f32);
    assert_eq!(grid.scale, [0.5, 1.0, 0.5]);
    assert!(height_field_shape(&grid.samples, grid.size, grid.offset, grid.scale).is_ok());
    pos[3 * 3] += 0.2;
    assert!(height::detect(&pos, &triangles).is_none());
}

fn cluster(level: usize, lod_error: f64, parent_error: f64) -> DagCluster {
    DagCluster {
        indices: vec![0, 1, 2],
        level,
        lod_error,
        parent_error,
        sphere: [0.0; 4],
        parent_sphere: [0.0; 4],
        replacement: None,
        source_rank: 0,
        group: None,
        source: None,
    }
}

// Behaviour: the tolerance is the object's own — the median error of its first simplified level —
// and a DAG without one collides at level 0.
#[test]
fn the_tolerance_is_the_median_error_of_level_one() {
    let dag = [
        cluster(0, 0.0, 0.2),
        cluster(1, 0.3, 1.0),
        cluster(1, 0.1, 1.0),
        cluster(1, 0.2, 1.0),
    ];
    assert_eq!(tolerance(&dag), 0.2);
    assert_eq!(tolerance(&dag[..1]), 0.0);
}

// Behaviour: the measured distance of a cut to level 0 is the true gap: a quad lifted by 0.25
// against the flat one is 0.25 away, and a surface against itself is 0.
#[test]
fn the_hausdorff_distance_is_measured() {
    let mut pos = vec![0., 0., 0., 1., 0., 0., 1., 0., 1., 0., 0., 1.];
    pos.extend([0., 0.25, 0., 1., 0.25, 0., 1., 0.25, 1., 0., 0.25, 1.]);
    let (flat, lifted) = ([0u32, 1, 2, 0, 2, 3], [4u32, 5, 6, 4, 6, 7]);
    let gap = hausdorff::distance(&pos, &flat, &lifted);
    assert!((gap - 0.25).abs() < 1e-6, "{gap}");
    assert!(hausdorff::distance(&pos, &flat, &flat) < 1e-9);
}

// Behaviour: an L of two boxes is cut into convex parts, and the mass of a unit cube at the
// runtime's density is 1000 kg about its centre.
#[test]
fn a_concave_body_is_decomposed_and_weighed() {
    let cube = |o: [f32; 3], s: [f32; 3]| -> Vec<f32> {
        (0..8)
            .flat_map(|c| (0..3).map(move |a| o[a] + if c >> a & 1 == 1 { s[a] } else { 0.0 }))
            .collect()
    };
    let faces: [u32; 36] = [
        0, 2, 1, 1, 2, 3, 4, 5, 6, 5, 7, 6, 0, 1, 4, 1, 5, 4, 2, 6, 3, 3, 6, 7, 0, 4, 2, 2, 4, 6,
        1, 3, 5, 3, 7, 5,
    ];
    let (mut pos, mut triangles) = (cube([0.0; 3], [4.0, 1.0, 1.0]), faces.to_vec());
    pos.extend(cube([0.0, 1.0, 0.0], [1.0, 3.0, 1.0]));
    triangles.extend(faces.iter().map(|i| i + 8));
    let parts = decompose::decompose(&pos, &triangles, 0.05);
    assert!(parts.len() >= 2, "{} parts", parts.len());
    let (_, mass) = hulls_shape(&[cube([0.0; 3], [1.0; 3])], 1000.0).unwrap();
    assert!((mass.mass - 1000.0).abs() < 1.0 && mass.centre.iter().all(|c| (c - 0.5).abs() < 1e-4));
}

// Behaviour: a node matrix splits into the pose a body takes; a sheared one is refused.
#[test]
fn a_node_matrix_splits_into_a_pose() {
    let turn = [0., 1., 0., 0., -1., 0., 0., 0., 0., 0., 1., 0.]; // a quarter turn about z
    let mut m = [0.0f64; 16];
    for c in 0..3 {
        for r in 0..3 {
            m[c * 4 + r] = turn[c * 4 + r] * 2.0;
        }
    }
    m[12..16].copy_from_slice(&[1.0, 2.0, 3.0, 1.0]);
    let (t, q, s) = trs(&m).unwrap();
    let half = std::f64::consts::FRAC_1_SQRT_2;
    assert_eq!((t, s), ([1.0, 2.0, 3.0], [2.0, 2.0, 2.0]));
    assert!(
        (q[2] - half).abs() < 1e-9 && (q[3] - half).abs() < 1e-9,
        "{q:?}"
    );
    m[5] += 0.5;
    assert!(trs(&m).is_none());
}
