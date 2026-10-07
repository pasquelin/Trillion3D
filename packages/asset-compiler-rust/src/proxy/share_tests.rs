use super::*;
use crate::compiler_world::{scaling, translation, IDENTITY};
use crate::proxy::encode::tests::fixture::plate;
use trillion3d_math::matrix::multiply_matrix4_from_zero;

/// Placements of `runs`, each a world matrix and its already placed world triangles.
fn shared(runs: &[(Mat4, Vec<f32>)]) -> Sharing {
    let flat: Vec<f32> = runs.iter().flat_map(|(_, t)| t.clone()).collect();
    let owner: Vec<u32> = runs
        .iter()
        .enumerate()
        .flat_map(|(i, (_, t))| vec![i as u32; t.len() / 9])
        .collect();
    let rank: Vec<usize> = (0..owner.len()).collect();
    let worlds: Vec<f64> = runs.iter().flat_map(|(matrix, _)| *matrix).collect();
    share(&flat, &vec![7; owner.len()], &owner, &rank, &worlds)
}

/// `plate()` placed by `matrix` in f64, rounded once, as `proxy::place` does.
fn placed(matrix: Mat4) -> (Mat4, Vec<f32>) {
    let mut out = Vec::new();
    crate::proxy::place(&plate(), &matrix, &mut out);
    (matrix, out)
}

#[test]
fn one_instance_stays_flat() {
    assert!(shared(&[placed(IDENTITY)]).instances.is_empty());
}

#[test]
fn a_mirrored_copy_shares_its_shape() {
    let mirrored =
        multiply_matrix4_from_zero(&translation([9.0, 0.0, 0.0]), &scaling([-1.0, 1.0, 1.0]));
    let sharing = shared(&[
        placed(IDENTITY),
        placed(translation([4.0, 0.0, 0.0])),
        placed(mirrored),
    ]);
    assert_eq!(sharing.shapes.len(), 1);
    assert_eq!(sharing.instances.len(), 3);
}

#[test]
fn copies_that_differ_stay_flat() {
    let mut other = placed(translation([4.0, 0.0, 0.0]));
    other.1[4] += 0.5;
    let sharing = shared(&[placed(IDENTITY), other]);
    assert!(sharing.instances.is_empty());
}

/// Right in real numbers, one unit in the last place off in f32: the map does not round-trip.
#[test]
fn a_map_off_by_one_ulp_stays_flat() {
    let mut other = placed(translation([4.0, 0.0, 0.0]));
    other.1[40] = f32::from_bits(other.1[40].to_bits() + 1);
    let sharing = shared(&[
        placed(IDENTITY),
        placed(translation([8.0, 0.0, 0.0])),
        other,
    ]);
    assert_eq!(
        sharing.instances.len(),
        2,
        "the two exact copies share, the third stays flat"
    );
    assert!(!sharing.positions.iter().any(|p| (64..96).contains(p)));
}

#[test]
fn singular_and_nonfinite_inputs_never_create_unreadable_maps() {
    for value in [f32::NAN, f32::INFINITY, f32::NEG_INFINITY, -0.0] {
        let mut triangles = plate();
        triangles[0] = value;
        assert!(
            shared(&[(IDENTITY, triangles.clone()), (IDENTITY, triangles)])
                .instances
                .is_empty()
        );
    }
    let singular = scaling([0.0, 1.0, 1.0]);
    assert!(shared(&[(singular, plate()), (singular, plate())])
        .instances
        .is_empty());
    assert!(shared(&[]).instances.is_empty());
}

#[test]
fn maximal_finite_coordinates_share_only_if_every_bit_round_trips() {
    let mut triangles = plate();
    triangles[0] = f32::MAX;
    let sharing = shared(&[(IDENTITY, triangles.clone()), (IDENTITY, triangles)]);
    assert_eq!(sharing.instances.len(), 2);
}
