//! A height map's displacement at a point and its range over a rectangle.
use crate::displace::map::DisplacementMap;

/// A 2 × 2 map, the heights 0 and 1 over the top row, a half and a quarter under it, a magnitude of
/// 2 and a centre of a half: the displacements are −1 and 1 over 0 and −0.5.
fn square(wrap: [bool; 2]) -> DisplacementMap {
    DisplacementMap::new(vec![0.0, 1.0, 0.5, 0.25], (2, 2), (2.0, 0.5), wrap)
}

fn near(a: f32, b: f32) {
    assert!((a - b).abs() < 1e-5, "{a} against {b}");
}

#[test]
fn a_texel_centre_reads_its_own_displacement() {
    let map = square([false; 2]);
    assert_eq!(map.size(), (2, 2));
    near(map.sample([0.25, 0.25]), -1.0);
    near(map.sample([0.75, 0.25]), 1.0);
    near(map.sample([0.25, 0.75]), 0.0);
    near(map.sample([0.75, 0.75]), -0.5);
}

#[test]
fn between_texel_centres_it_filters_bilinearly() {
    let map = square([false; 2]);
    near(map.sample([0.5, 0.25]), 0.0);
    near(map.sample([0.25, 0.5]), -0.5);
    near(map.sample([0.5, 0.5]), -0.125);
}

#[test]
fn past_the_edge_it_holds_the_last_texel_or_wraps_by_axis() {
    let held = square([false; 2]);
    near(held.sample([-5.0, 0.25]), -1.0);
    near(held.sample([9.0, 0.25]), 1.0);
    let wrapped = square([true, false]);
    near(wrapped.sample([-5.0, 0.25]), 0.0);
}

#[test]
fn the_bounds_of_the_whole_map_are_its_extremes() {
    let [low, high] = square([false; 2]).bounds([0.0, 0.0], [1.0, 1.0]);
    near(low, -1.0);
    near(high, 1.0);
}

#[test]
fn a_point_reads_the_four_texels_its_filter_reaches() {
    let [low, high] = square([false; 2]).bounds([0.25, 0.25], [0.25, 0.25]);
    near(low, -1.0);
    near(high, 1.0);
}

#[test]
fn a_negative_magnitude_still_orders_the_ends() {
    let map = DisplacementMap::new(vec![0.0, 1.0, 0.5, 0.25], (2, 2), (-2.0, 0.5), [false; 2]);
    let [low, high] = map.bounds([0.0, 0.0], [1.0, 1.0]);
    near(low, -1.0);
    near(high, 1.0);
}

#[test]
fn the_levels_of_a_wide_map_bound_what_the_texels_do() {
    let map = DisplacementMap::new(vec![0.0, 0.25, 0.5, 1.0], (4, 1), (1.0, 0.0), [false; 2]);
    let [low, high] = map.bounds([0.0, 0.0], [1.0, 1.0]);
    near(low, 0.0);
    near(high, 1.0);
}

#[test]
fn a_map_too_large_or_the_wrong_size_displaces_nothing() {
    let large = DisplacementMap::new(vec![1.0; 8193], (8193, 1), (1.0, 0.0), [true; 2]);
    assert_eq!(large.size(), (1, 1));
    near(large.sample([0.4, 0.4]), 0.0);
    let short = DisplacementMap::new(vec![1.0; 3], (2, 2), (1.0, 0.0), [true; 2]);
    assert_eq!(short.size(), (1, 1));
}
