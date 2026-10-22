//! Affine arithmetic over the barycentric ranges of a sub-triangle.
use crate::displace::affine::{Affine, AffineV};

#[test]
fn a_symbol_ranges_over_its_interval_and_cancels_against_itself() {
    let symbol = Affine::symbol(0.25, 0.75, 0);
    assert_eq!((symbol.least(), symbol.most()), (0.25, 0.75));
    let rest = Affine::constant(1.0).minus(symbol);
    assert_eq!((rest.least(), rest.most()), (0.25, 0.75));
    let same = symbol.minus(symbol);
    assert_eq!((same.least(), same.most()), (0.0, 0.0));
}

#[test]
fn an_interval_does_not_cancel_against_itself() {
    let interval = Affine::interval(1.0, 3.0);
    assert_eq!((interval.least(), interval.most()), (1.0, 3.0));
    let apart = interval.minus(interval);
    assert_eq!((apart.least(), apart.most()), (-2.0, 2.0));
}

#[test]
fn a_vector_of_a_half_is_made_unit() {
    let unit = AffineV::constant([0.0, 0.0, 0.5])
        .normalized()
        .squared_length();
    assert!((unit.least() - 1.0).abs() < 1e-6 && (unit.most() - 1.0).abs() < 1e-6);
    let long = AffineV::constant([3.0, 4.0, 0.0]).squared_length();
    assert_eq!((long.least(), long.most()), (25.0, 25.0));
}
