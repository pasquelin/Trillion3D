//! The published error is never below the measured geometry, measured only where it can raise it
//! (`measured.rs`, #929).
use super::*;
use crate::physics_cook::hausdorff::{distance, distance_above};

#[test]
fn a_bounded_distance_is_the_full_one_raised_to_its_floor_bit_for_bit() {
    let mut rng = crate::compute_bench::inputs::Xorshift::new(0x929);
    let (positions, indices) = cylinder(24);
    let triangles = indices.len() / 3;
    for case in 0..60 {
        // Two random subsets of the same surface, one of them a single triangle or empty.
        let pick = |rng: &mut crate::compute_bench::inputs::Xorshift, keep: usize| -> Vec<u32> {
            (0..triangles)
                .filter(|_| rng.below(keep.max(1)) == 0)
                .flat_map(|t| indices[t * 3..t * 3 + 3].to_vec())
                .collect()
        };
        let a = pick(&mut rng, 2);
        let b = match case % 6 {
            0 => Vec::new(),
            1 => indices[..3].to_vec(),
            _ => pick(&mut rng, 3),
        };
        let full = distance(&positions, &a, &b);
        for floor in [
            0.0,
            -0.0,
            full * 0.5,
            full,
            full * 2.0,
            1e-9,
            f64::INFINITY,
            f64::NAN,
        ] {
            let bounded = distance_above(&positions, &a, &b, floor);
            assert_eq!(
                bounded.to_bits(),
                floor.max(full).to_bits(),
                "case {case}, floor {floor}: {bounded} against {full}"
            );
        }
    }
}

#[test]
fn every_group_publishes_at_least_the_distance_between_its_children_and_its_outputs() {
    for (positions, indices) in [grid(64), cylinder(64)] {
        let (dag, groups, _) = build_of(&positions, &indices);
        assert!(!groups.is_empty());
        for group in &groups {
            let side = |ids: &[usize]| -> Vec<u32> {
                ids.iter()
                    .flat_map(|&id| dag[id].indices.iter().copied())
                    .collect()
            };
            let measured = distance(&positions, &side(&group.children), &side(&group.outputs));
            assert!(
                group.error >= measured,
                "level {}: {} published below {measured}",
                group.level,
                group.error
            );
        }
    }
}
