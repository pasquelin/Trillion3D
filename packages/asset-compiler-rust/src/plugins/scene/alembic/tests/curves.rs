//! What scope an Alembic curves parameter names, and what it is given for. Real archives go through
//! the golden (`tests/formats/alembic_curves.rs`); what the groom makes of a scope and a count is
//! proven in `hair_strands/tests.rs`.
use super::super::curves::{first_points, scoped};
use super::super::geom::Param;
use crate::hair_strands::Scope;
use crate::plugins::scene::spread::Spread;

/// A direct parameter of floats, with the scope its metadata names.
fn param(values: Vec<f32>, scope: Spread, vertex: bool) -> Param<f32> {
    Param {
        values,
        indices: None,
        scope,
        vertex,
    }
}

// Behaviour: a parameter's scope is the one its metadata names: the object's, each curve's, or each
// point's when it names `vertex` itself; `varying`, a scope of the corners and one the format does
// not know say nothing, and the count of the values then tells what they are given for.
#[test]
fn a_parameters_scope_is_the_one_its_metadata_names() {
    let scope = |spread, vertex| scoped(param(vec![1.0; 6], spread, vertex), 1, 4).map(|(s, _)| s);
    assert_eq!(scope(Spread::Constant, false), Some(Scope::Constant));
    assert_eq!(scope(Spread::Uniform, false), Some(Scope::Uniform));
    assert_eq!(scope(Spread::Point, true), Some(Scope::Vertex));
    assert_eq!(scope(Spread::Point, false), Some(Scope::Other));
    assert_eq!(scope(Spread::FaceVarying, false), Some(Scope::Other));
}

// Behaviour: a scope set to the object's on as many values as there are curves is each curve's, as
// the format's readers take it; on fewer it is the object's, whose first value goes to every curve.
#[test]
fn a_scope_set_to_the_object_on_as_many_values_as_curves_is_each_curves() {
    let constant = |values: Vec<f32>, width, strands| {
        scoped(param(values, Spread::Constant, false), width, strands)
    };
    assert_eq!(
        constant(vec![1.0, 2.0, 3.0], 1, 3),
        Some((Scope::Uniform, vec![1.0, 2.0, 3.0]))
    );
    assert_eq!(
        constant(vec![0.5, 0.25], 2, 1),
        Some((Scope::Uniform, vec![0.5, 0.25])),
        "one pair for one curve"
    );
    assert_eq!(
        constant(vec![0.5, 0.25], 2, 3),
        Some((Scope::Constant, vec![0.5, 0.25]))
    );
}

// Behaviour: the root coordinate of a parameter given for the points is the value at each curve's
// first point; a curve that starts past the values leaves the parameter unread.
#[test]
fn a_root_coordinate_given_for_the_points_is_read_at_each_curves_first_point() {
    let values: Vec<f32> = (0..10).map(|k| k as f32).collect();
    assert_eq!(
        first_points(&values, &[2, 3]),
        Some(vec![0.0, 1.0, 4.0, 5.0])
    );
    assert_eq!(first_points(&values, &[6, 1]), None);
}
