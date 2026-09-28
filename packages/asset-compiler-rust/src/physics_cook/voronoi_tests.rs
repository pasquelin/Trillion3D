//! The Voronoi cut (`voronoi.rs`): the cells of seeds inside a convex solid tile it, and a dense
//! convex mesh is cut into closed pieces that weigh it (`pieces.rs`).
use super::mass::{solid_mass, DENSITY};
use super::mass_tests::{cube, FACES};
use super::pieces::{pieces, PIECES};
use super::voronoi::{cells, clip, face_planes, welded};

/// Share of a solid its cells may miss or overlap: their corners are rounded to 32 bits.
const TILED: f64 = 1e-6;

/// The volume the mesh `triangles` over `pos` bounds; 0 for none or a flat one.
fn solid(pos: &[f32], triangles: &[u32]) -> f64 {
    let mass = solid_mass(pos, triangles, [1.0; 3], 0);
    mass.map_or(0.0, |m| m["mass"].as_f64().unwrap() / DENSITY)
}

/// The volume the polytope `faces` bounds.
fn volume(faces: &[Vec<[f64; 3]>]) -> f64 {
    let (pos, triangles) = welded(faces);
    solid(&pos, &triangles)
}

// Behaviour: the Voronoi cells of seeds inside a convex solid — a box, a pyramid leaning over one
// corner of its base, and a turned cube whose bottom face holds a sliver 1e-6 off one edge, its
// plane tilted into the cube by 32-bit rounding and left out — tile it: their volumes sum to the
// solid's, and no two cells overlap, within `TILED` of it.
#[test]
fn voronoi_cells_tile_a_convex_solid_without_gap_or_overlap() {
    let pyramid = [0., 0., 0., 3., 0., 0., 0., 2., 0., 0., 0., 1.5, 3., 2., 0.];
    let pyramid_faces = [0, 2, 1, 1, 2, 4, 0, 1, 3, 1, 4, 3, 4, 2, 3, 2, 0, 3];
    let turn = |[x, y, z]: [f64; 3]| {
        // Turned so that rounding tilts the sliver's plane inward: 1e-3 of the cube lost, unfiltered.
        let (a, b) = (0.3f64, 0.9f64);
        let (y, z) = (y * a.cos() - z * a.sin(), y * a.sin() + z * a.cos());
        [x * b.cos() - z * b.sin(), y, x * b.sin() + z * b.cos()]
    };
    let mut sliver = cube([0.0; 3], [1.0; 3]);
    sliver.extend([0.5, 1e-6, 0.0]);
    let sliver: Vec<f32> = (sliver.as_chunks::<3>().0.iter())
        .flat_map(|p| turn(p.map(f64::from)).map(|v| v as f32))
        .collect();
    let mut sliver_faces = vec![0, 2, 8, 2, 3, 8, 3, 1, 8, 1, 0, 8];
    sliver_faces.extend(&FACES[6..]);
    let seeds = [
        [0.3, 0.2, 0.1],
        [1.1, 0.4, 0.2],
        [0.5, 0.7, 0.3],
        [1.6, 0.3, 0.15],
    ];
    let slab = cube([0.0; 3], [2.0, 1.0, 0.5]);
    let turned = vec![turn([0.3, 0.3, 0.3]), turn([0.7, 0.6, 0.5])];
    for (pos, triangles, seeds) in [
        (slab, FACES.to_vec(), seeds.to_vec()),
        (pyramid.to_vec(), pyramid_faces.to_vec(), seeds.to_vec()),
        (sliver, sliver_faces, turned),
    ] {
        let whole = solid(&pos, &triangles);
        let corners = pos.as_chunks::<3>().0.iter().map(|p| p.map(f64::from));
        let planes = face_planes((&pos, &triangles), &corners.collect::<Vec<_>>(), 1e-6);
        let pieces = cells(&seeds, ([-2.0; 3], [3.0; 3]), &planes, 1e-6);
        let total: f64 = pieces.iter().map(|faces| volume(faces)).sum();
        assert!((total - whole).abs() <= whole * TILED, "{total} of {whole}");
        for (i, a) in pieces.iter().enumerate() {
            assert!(volume(a) > 0.0, "cell {i} is empty");
            for b in &pieces[i + 1..] {
                let (pos, triangles) = welded(b);
                // A cell is convex: none of its planes needs leaving out.
                let shared = face_planes((&pos, &triangles), &[], 1e-6)
                    .into_iter()
                    .fold(a.clone(), |faces, plane| clip(faces, plane, 1e-12));
                assert!(volume(&shared) <= whole * TILED, "{}", volume(&shared));
            }
        }
    }
}

// Behaviour: a dense convex mesh, a sphere of 7 080 triangles whose neighbouring faces are nearly
// coplanar, is cut into `PIECES` closed pieces that weigh the mesh within `MASS_TOLERANCE`, though
// its accessor also holds 100 000 positions its triangles do not use.
#[test]
fn a_dense_convex_mesh_is_cut_into_closed_pieces() {
    let (n, m) = (60u32, 60u32);
    let mut pos = vec![0.0f32, 0.0, -1.0, 0.0, 0.0, 1.0];
    for (i, j) in (1..n).flat_map(|i| (0..m).map(move |j| (i as f32, j as f32))) {
        let (theta, phi) = (
            i * std::f32::consts::PI / n as f32,
            j * std::f32::consts::TAU / m as f32,
        );
        pos.extend([
            theta.sin() * phi.cos(),
            theta.sin() * phi.sin(),
            -theta.cos(),
        ]);
    }
    let v = |i: u32, j: u32| 2 + (i - 1) * m + j % m;
    let mut triangles = Vec::new();
    for j in 0..m {
        triangles.extend([0, v(1, j + 1), v(1, j), 1, v(n - 1, j), v(n - 1, j + 1)]);
        for i in 1..n - 1 {
            triangles.extend([
                v(i, j),
                v(i, j + 1),
                v(i + 1, j),
                v(i, j + 1),
                v(i + 1, j + 1),
                v(i + 1, j),
            ]);
        }
    }
    let root = std::path::Path::new(env!("OUT_DIR")).join(format!("sphere-{}", std::process::id()));
    let o = crate::texture_preview::tests::options(&root);
    std::fs::create_dir_all(o.cache.join("native/objects")).unwrap();
    // Positions of another mesh sharing the accessor, used by no triangle: never a seed's corner.
    pos.extend(vec![10.0f32; 300_000]);
    let cut = pieces(&o, (&pos, &triangles, 0), (7, [1.0; 3])).unwrap();
    assert_eq!(cut.len(), PIECES);
    std::fs::remove_dir_all(root).unwrap();
}
