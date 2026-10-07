//! The texture deviation a reduction publishes, looked up on the triangles it replaced
//! (`texture.rs`).
use super::*;
use crate::geometry_page::{Attribute as Carried, FLAG_UV};
use texture::texture_deviation_above;

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

/// The texture deviation of `kept` from `live`, measured in full: a NaN floor stops no sample.
fn deviation(mesh: &(Vec<f32>, Vec<f32>), live: &[u32], kept: &[u32]) -> f64 {
    deviation_above(mesh, live, kept, f64::NAN)
}

fn deviation_above(mesh: &(Vec<f32>, Vec<f32>), live: &[u32], kept: &[u32], floor: f64) -> f64 {
    let uvs = Carried {
        flag: FLAG_UV,
        width: 2,
        values: mesh.1.clone(),
    };
    let carried = [&uvs];
    let attributes = DagAttributes { carried: &carried };
    let (welds, weighted) = (
        welds::Welds::of(&mesh.0, attributes, live),
        attributes.weighted(),
    );
    let locks = vec![false; mesh.0.len() / 3];
    let bound = quality::NORMAL_DEVIATION_BOUND;
    let input = welds.input(&mesh.0, &carried, &weighted, &locks, bound);
    texture_deviation_above(&measured::Surface::of(&input), live, kept, floor)
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
fn a_floored_deviation_is_the_full_one_raised_to_its_floor_bit_for_bit() {
    let mut mesh = (Vec::new(), Vec::new());
    let (mut live, mut kept) = (Vec::new(), Vec::new());
    for (b, warp) in [0.0, 0.25, -0.1, 0.4].into_iter().enumerate() {
        let (l, k) = brick(&mut mesh, b as f32 * 3.0, 0.0, warp);
        live.extend(l);
        kept.extend(k);
    }
    let full = deviation(&mesh, &live, &kept);
    assert!(full > 0.2, "{full}");
    for floor in [0.0, -0.0, -1.0, full * 0.5, full, full * 2.0, f64::INFINITY] {
        let floored = deviation_above(&mesh, &live, &kept, floor);
        assert_eq!(
            floored.to_bits(),
            floor.max(full).to_bits(),
            "floor {floor}"
        );
    }
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
        .as_chunks::<3>()
        .0
        .iter()
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
    let (dag, groups, ..) = built.expect("dag");
    assert!(!groups.is_empty());
    let mesh = (positions, uvs);
    for group in &groups {
        let measured = deviation(
            &mesh,
            &indices_of(&dag, &group.children),
            &indices_of(&dag, &group.outputs),
        );
        assert!(group.error >= measured, "{} below {measured}", group.error);
    }
}
