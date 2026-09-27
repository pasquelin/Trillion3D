//! The Voronoi cut (`voronoi.rs`): the cells of seeds inside a convex solid tile it, and a dense
//! convex mesh is cut into closed pieces that weigh it (`pieces.rs`).
use super::mass::{solid_mass, DENSITY};
use super::mass_tests::{cube, FACES};
use super::pieces::{pieces, PIECES};
use super::voronoi::{cells, clip, face_planes, supporting, welded};
/// Share of a solid its cells may miss or overlap: their corners are rounded to 32 bits.
const TILED: f64 = 1e-6;

/// The volume the polytope `faces` bounds; 0 for none or a flat one.
fn volume(faces: &[Vec<[f64; 3]>]) -> f64 {
    let (pos, triangles) = welded(faces);
    solid_mass(&pos, &triangles, [1.0; 3], 0).map_or(0.0, |m| m["mass"].as_f64().unwrap() / DENSITY)
}

// Behaviour: the Voronoi cells of seeds inside a convex solid — a box, a pyramid leaning over one
// corner of its base, and a prism of many faces — tile it: their volumes sum to the solid's, and no two cells overlap,
// within `TILED` of it.
#[test]
fn voronoi_cells_tile_a_convex_solid_without_gap_or_overlap() {
    let pyramid = (
        vec![
            0.0, 0.0, 0.0, 3.0, 0.0, 0.0, 0.0, 2.0, 0.0, 0.0, 0.0, 1.5, 3.0, 2.0, 0.0,
        ],
        vec![0, 2, 1, 1, 2, 4, 0, 1, 3, 1, 4, 3, 4, 2, 3, 2, 0, 3],
    );
    // A 24-sided prism about (1, 0.5), radius 1.2, 0.5 high: 48 corners, 92 face triangles.
    let (mut prism, mut sides) = (Vec::new(), Vec::new());
    for k in 0..24u32 {
        let turn = k as f32 * std::f32::consts::TAU / 24.0;
        let (x, y) = (1.0 + 1.2 * turn.cos(), 0.5 + 1.2 * turn.sin());
        prism.extend([x, y, 0.0, x, y, 0.5]);
        let [a, b, c, d] = [2 * k, 2 * k + 1, (2 * k + 2) % 48, (2 * k + 3) % 48];
        sides.extend([a, c, b, b, c, d]);
        if k > 1 {
            sides.extend([0, 2 * k, 2 * k - 2, 1, 2 * k - 1, 2 * k + 1]);
        }
    }
    let solids = [
        (cube([0.0; 3], [2.0, 1.0, 0.5]), FACES.to_vec()),
        pyramid,
        (prism, sides),
    ];
    for (pos, triangles) in solids {
        let whole = solid_mass(&pos, &triangles, [1.0; 3], 0).unwrap()["mass"]
            .as_f64()
            .unwrap()
            / DENSITY;
        let planes = face_planes(&pos, &triangles);
        let seeds = [
            [0.3, 0.2, 0.1],
            [1.1, 0.4, 0.2],
            [0.5, 0.7, 0.3],
            [1.6, 0.3, 0.15],
        ];
        let bounds = ([-1.0; 3], [3.0, 2.0, 1.5]);
        let pieces = cells(&seeds, bounds, &planes);
        let total: f64 = pieces.iter().map(|faces| volume(faces)).sum();
        assert!((total - whole).abs() <= whole * TILED, "{total} of {whole}");
        for (i, a) in pieces.iter().enumerate() {
            assert!(volume(a) > 0.0, "cell {i} is empty");
            for b in &pieces[i + 1..] {
                let (pos, triangles) = welded(b);
                let shared = face_planes(&pos, &triangles)
                    .into_iter()
                    .fold(a.clone(), |faces, plane| clip(faces, plane, 1e-12));
                assert!(
                    volume(&shared) <= whole * TILED,
                    "overlap {}",
                    volume(&shared)
                );
            }
        }
    }
}

// Behaviour: a turned cube whose bottom face holds a sliver, a corner 1e-6 off one edge, is still
// tiled by its cells: the sliver's plane, tilted into the cube by its corners' 32-bit rounding,
// is no supporting plane and cuts nothing.
#[test]
fn a_sliver_plane_tilted_by_rounding_cuts_nothing() {
    let turn = |[x, y, z]: [f64; 3]| {
        let (a, b) = (0.7f64, 0.4f64);
        let (y, z) = (y * a.cos() - z * a.sin(), y * a.sin() + z * a.cos());
        [x * b.cos() - z * b.sin(), y, x * b.sin() + z * b.cos()]
    };
    let mut corners: Vec<[f64; 3]> = (0..8)
        .map(|c| [c & 1, c >> 1 & 1, c >> 2 & 1].map(f64::from))
        .collect();
    corners.push([0.5, 1e-6, 0.0]);
    let pos: Vec<f32> = corners
        .iter()
        .flat_map(|&p| turn(p).map(|v| v as f32))
        .collect();
    let triangles = [
        0, 2, 8, 2, 3, 8, 3, 1, 8, 1, 0, 8, 4, 5, 7, 4, 7, 6, 0, 1, 5, 0, 5, 4, 2, 6, 7, 2, 7, 3,
        0, 4, 6, 0, 6, 2, 1, 3, 7, 1, 7, 5,
    ];
    let whole = solid_mass(&pos, &triangles, [1.0; 3], 0).unwrap()["mass"]
        .as_f64()
        .unwrap()
        / DENSITY;
    let bounds = ([-2.0; 3], [2.0; 3]);
    let planes = supporting(face_planes(&pos, &triangles), &pos, &triangles, 1e-6);
    let seeds = [turn([0.3, 0.3, 0.3]), turn([0.7, 0.6, 0.5])];
    let total: f64 = cells(&seeds, bounds, &planes)
        .iter()
        .map(|f| volume(f))
        .sum();
    assert!((total - whole).abs() <= whole * TILED, "{total} of {whole}");
}

// Behaviour: a dense convex mesh, a sphere of 7 080 triangles whose neighbouring faces are nearly
// coplanar, is cut into `PIECES` closed pieces that weigh the mesh within `MASS_TOLERANCE`.
#[test]
fn a_dense_convex_mesh_is_cut_into_closed_pieces() {
    let (n, m) = (60u32, 60u32);
    let mut pos = vec![0.0f32, 0.0, -1.0, 0.0, 0.0, 1.0];
    for i in 1..n {
        for j in 0..m {
            let theta = std::f32::consts::PI * i as f32 / n as f32;
            let phi = std::f32::consts::TAU * j as f32 / m as f32;
            pos.extend([
                theta.sin() * phi.cos(),
                theta.sin() * phi.sin(),
                -theta.cos(),
            ]);
        }
    }
    let v = |i: u32, j: u32| 2 + (i - 1) * m + j % m;
    let mut triangles = Vec::new();
    for j in 0..m {
        triangles.extend([0, v(1, j + 1), v(1, j), 1, v(n - 1, j), v(n - 1, j + 1)]);
        for i in 1..n - 1 {
            triangles.extend([v(i, j), v(i, j + 1), v(i + 1, j)]);
            triangles.extend([v(i, j + 1), v(i + 1, j + 1), v(i + 1, j)]);
        }
    }
    let root = std::path::Path::new(env!("OUT_DIR")).join(format!("sphere-{}", std::process::id()));
    let o = crate::texture_preview::tests::options(&root);
    std::fs::create_dir_all(o.cache.join("native/objects")).unwrap();
    let cut = pieces(&o, (&pos, &triangles, 0), 7, [1.0; 3]).unwrap();
    assert_eq!(cut.len(), PIECES);
    std::fs::remove_dir_all(root).unwrap();
}
