//! The texture deviation a reduction publishes, looked up on the triangles it replaced
//! (`texture.rs`, #977).
use super::*;
use crate::geometry_page::{Attribute as Carried, FLAG_UV};
use texture::texture_deviation;

/// A flat 2 m brick of 3 x 3 vertices at `(x, 0, z)`, its texture the unit square, the centre's
/// coordinate moved by `warp`; its 8 triangles and the 2 coarse ones spanning its corners.
fn brick(mesh: &mut (Vec<f32>, Vec<f32>), x: f32, z: f32, warp: f32) -> (Vec<u32>, Vec<u32>) {
    let base = (mesh.0.len() / 3) as u32;
    for row in 0..3 {
        for column in 0..3 {
            mesh.0.extend([x + column as f32, row as f32, z]);
            let centre = if row == 1 && column == 1 { warp } else { 0.0 };
            mesh.1
                .extend([column as f32 * 0.5 + centre, row as f32 * 0.5]);
        }
    }
    let live = crate::tests::fixtures::grid_indices(2, 2, |c, r| base + (r * 3 + c) as u32);
    (live, [0, 2, 8, 0, 8, 6].map(|v| base + v).to_vec())
}

fn deviation(mesh: &(Vec<f32>, Vec<f32>), live: &[u32], kept: &[u32]) -> f64 {
    let uvs = Carried {
        flag: FLAG_UV,
        width: 2,
        values: mesh.1.clone(),
    };
    let carried = [&uvs];
    let welds = attributes::Welds::of(&mesh.0, DagAttributes { carried: &carried }, live);
    let locks = vec![false; mesh.0.len() / 3];
    let input = welds.input(&mesh.0, &locks, quality::NORMAL_DEVIATION_BOUND);
    texture_deviation(&input, live, kept)
}

#[test]
fn bricks_repeating_one_texture_are_each_measured_on_their_own_triangles() {
    // A tiled facade: 8 bricks 40 m apart, each mapping the same square, coarsened exactly.
    let mut mesh = (Vec::new(), Vec::new());
    let (mut live, mut kept) = (Vec::new(), Vec::new());
    for b in 0..8 {
        let (l, k) = brick(&mut mesh, b as f32 * 40.0, 0.0, 0.0);
        live.extend(l);
        kept.extend(k);
    }
    assert!(deviation(&mesh, &live, &kept) < 1e-9);
    // A warped brick slides by a measured amount; a brick with the same coordinates 1 mm away
    // never stands in for the triangles the collapse replaced.
    let mut mesh = (Vec::new(), Vec::new());
    let (live, kept) = brick(&mut mesh, 0.0, 0.0, 0.25);
    let alone = deviation(&mesh, &live, &kept);
    assert!(alone > 0.2 && alone < 2.0, "{alone}");
    let (twin, _) = brick(&mut mesh, 0.0, 0.001, 0.0);
    let both: Vec<u32> = live.iter().chain(&twin).copied().collect();
    assert_eq!(deviation(&mesh, &both, &kept).to_bits(), alone.to_bits());
}

#[test]
fn a_coordinate_that_is_not_a_number_or_an_empty_side_measures_nothing() {
    let mut mesh = (Vec::new(), Vec::new());
    let (live, kept) = brick(&mut mesh, 0.0, 0.0, 0.0);
    assert_eq!(deviation(&mesh, &live, &[]), 0.0);
    assert_eq!(deviation(&mesh, &[], &kept), 0.0);
    for bad in [f32::NAN, f32::INFINITY, -0.0] {
        mesh.1[0] = bad;
        assert!(deviation(&mesh, &live, &kept).is_finite(), "{bad}");
    }
}

#[test]
fn every_group_publishes_at_least_its_texture_deviation() {
    let (positions, indices) = grid(48);
    let uvs: Vec<f32> = positions
        .chunks_exact(3)
        .flat_map(|p| [p[0] / 48.0 + (p[1] * 0.4).sin() * 0.02, p[1] / 48.0])
        .collect();
    let carried = Carried {
        flag: FLAG_UV,
        width: 2,
        values: uvs.clone(),
    };
    let attributes = DagAttributes {
        carried: &[&carried],
    };
    let strategy = DagStrategy::QemEndpoints;
    let built = build_dag_tallied(&positions, attributes, &indices, strategy, &|| Ok(()));
    let (dag, groups, _, _) = built.expect("dag");
    assert!(!groups.is_empty());
    let mesh = (positions, uvs);
    for group in &groups {
        let side = |ids: &[usize]| -> Vec<u32> {
            ids.iter()
                .flat_map(|&id| dag[id].indices.iter().copied())
                .collect()
        };
        let measured = deviation(&mesh, &side(&group.children), &side(&group.outputs));
        assert!(group.error >= measured, "{} below {measured}", group.error);
    }
}
