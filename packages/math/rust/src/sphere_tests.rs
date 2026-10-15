use super::*;

#[test]
fn an_empty_side_or_a_contained_sphere_returns_the_other() {
    let ball = [1.0, 2.0, 3.0, 4.0];
    let empty = [9.0, 9.0, 9.0, -1.0];
    assert_eq!(merge_spheres(ball, empty), ball);
    assert_eq!(merge_spheres(empty, ball), ball);
    let inside = [1.5, 2.0, 3.0, 1.0];
    assert_eq!(merge_spheres(ball, inside), ball);
    assert_eq!(merge_spheres(inside, ball), ball);
}

#[test]
fn two_apart_spheres_meet_in_the_one_through_their_far_points() {
    let merged = merge_spheres([0.0, 0.0, 0.0, 1.0], [4.0, 0.0, 0.0, 1.0]);
    assert_eq!(merged, [2.0, 0.0, 0.0, 3.0]);
    // Equal centres, one radius larger: containment, no division by the zero distance.
    assert_eq!(
        merge_spheres([1.0, 1.0, 1.0, 1.0], [1.0, 1.0, 1.0, 2.0]),
        [1.0, 1.0, 1.0, 2.0]
    );
}
