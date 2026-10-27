//! The values a file gives, by the scope it names: widths, attributes and group names.
use super::{groom, row};
use crate::hair_strands::description::{finite_width, Widths};
use crate::hair_strands::scope::{given, ranked, Given, Scope};

// Behaviour: a width given for the object is the first value for each strand, one given for each strand
// or each point is theirs, each times the unit's scale; one that holds too few, or names another
// scope, gives none.
#[test]
fn widths_are_taken_to_metres_by_the_scale_of_their_scope() {
    let scale = |scope, values: &[f32]| Widths::from_scope(scope, values, (2, 3), 0.5);
    assert_eq!(
        scale(Scope::Constant, &[0.25, 9.0]),
        Widths::Strand(vec![0.125; 2])
    );
    assert_eq!(
        scale(Scope::Uniform, &[0.25, 0.5, 9.0]),
        Widths::Strand(vec![0.125, 0.25])
    );
    assert_eq!(
        scale(Scope::Vertex, &[1.0, 2.0, 4.0, 9.0]),
        Widths::Vertex(vec![0.5, 1.0, 2.0])
    );
    assert_eq!(scale(Scope::Uniform, &[1.0]), Widths::None);
    assert_eq!(scale(Scope::Vertex, &[1.0, 2.0]), Widths::None);
    assert_eq!(scale(Scope::Constant, &[]), Widths::None);
    assert_eq!(scale(Scope::Other, &[1.0; 3]), Widths::None);
    assert_eq!(finite_width(0.25), Some(0.25));
    assert_eq!(finite_width(f64::NAN), None);
    assert_eq!(finite_width(f64::INFINITY), None);
}

// Behaviour: the values of an attribute are given for each strand where the scope says the object's
// or each strand's, or where there are as many values as strands; else for each point where the scope
// says so, or where there are as many as points; the object's value is the first, for all. They are
// cut to what they cover, and none when they hold too few or fit neither. Three strands of two points.
#[test]
fn the_scope_and_the_count_say_what_values_are_given_for() {
    let shape = (3, 6);
    let of = |scope, values: &[i32], width| given(scope, values.to_vec(), width, shape);
    assert_eq!(
        of(Scope::Constant, &[7], 1),
        Some(Given::Strands(vec![7; 3]))
    );
    assert_eq!(
        of(Scope::Constant, &[1, 2], 2),
        Some(Given::Strands(vec![1, 2, 1, 2, 1, 2])),
        "the first element for all"
    );
    assert_eq!(
        of(Scope::Constant, &[7, 8, 9], 1),
        Some(Given::Strands(vec![7; 3])),
        "the object's scope is the object's, whatever the count"
    );
    assert_eq!(
        of(Scope::Uniform, &[7, 8, 9, 10], 1),
        Some(Given::Strands(vec![7, 8, 9])),
        "cut to the strands"
    );
    assert_eq!(of(Scope::Uniform, &[7, 8], 1), None, "too few");
    assert_eq!(
        of(Scope::Other, &[7, 8, 9], 1),
        Some(Given::Strands(vec![7, 8, 9])),
        "as many as strands"
    );
    assert_eq!(
        of(Scope::Vertex, &[1, 2, 3, 4, 5, 6, 7], 1),
        Some(Given::Points(vec![1, 2, 3, 4, 5, 6]))
    );
    assert_eq!(of(Scope::Vertex, &[1, 2, 3, 4], 1), None, "too few points");
    assert_eq!(
        of(Scope::Other, &[0; 12], 2),
        Some(Given::Points(vec![0; 12])),
        "as many pairs as points"
    );
    assert_eq!(of(Scope::Other, &[0; 4], 1), None, "neither");
    assert_eq!(Given::Strands(vec![1]).points(), Vec::<i32>::new());
    assert_eq!(Given::Points(vec![1]).strands(), Vec::<i32>::new());
}

// Behaviour: a groom's attributes are set from the scope the file names: group numbers, root
// coordinates and names for the strands, colours and roughness for the points; one given for the
// other (a colour for each strand) is left out, as is one that does not fit.
#[test]
fn the_attributes_of_a_groom_are_set_by_their_scope() {
    let mut set = groom(&[2, 2, 1], &row(0.0, 5));
    set.set_group_ids(Scope::Uniform, vec![4, 5, 6]);
    set.set_root_uvs(Scope::Constant, vec![0.5, 0.25]);
    set.set_colors(Scope::Vertex, vec![0.5; 15]);
    set.set_roughness(Scope::Vertex, vec![0.25; 5]);
    assert_eq!(set.group_ids, [4, 5, 6]);
    assert_eq!(set.root_uvs, [0.5, 0.25, 0.5, 0.25, 0.5, 0.25]);
    assert_eq!((set.colors.len(), set.roughness.len()), (15, 5));
    assert!(set.fits());
    let mut left_out = groom(&[2, 2, 1], &row(0.0, 5));
    left_out.set_colors(Scope::Uniform, vec![0.5; 9]);
    left_out.set_roughness(Scope::Uniform, vec![0.5; 3]);
    left_out.set_group_ids(Scope::Vertex, vec![1; 5]);
    left_out.set_root_uvs(Scope::Uniform, vec![0.5; 4]);
    assert!(left_out.colors.is_empty(), "colours are the points'");
    assert!(left_out.roughness.is_empty(), "roughness is the points'");
    assert!(left_out.group_ids.is_empty(), "numbers are the strands'");
    assert!(left_out.root_uvs.is_empty(), "two strands' worth for three");
    left_out.set_widths(Scope::Vertex, &[0.2; 5], 0.5);
    assert_eq!(left_out.widths, Widths::Vertex(vec![0.1; 5]));
}

// Behaviour: the names of the strands make one table of the distinct names, in the order they are
// met, each strand holding the rank of its name — however many strands share it. An indexed table
// gives the same, the empty name where an index names none, and nothing unless it indexes every
// strand.
#[test]
fn the_names_of_the_strands_make_one_table() {
    let text = |names: &[&str]| {
        names
            .iter()
            .map(|name| name.to_string())
            .collect::<Vec<_>>()
    };
    let (names, ranks) = ranked(["b", "a", "b", "b", "c", "a"].into_iter());
    assert_eq!(
        (names, ranks),
        (text(&["b", "a", "c"]), vec![0, 1, 0, 0, 2, 1])
    );
    let mut named = groom(&[2, 2, 2], &row(0.0, 6));
    named.set_group_names(Scope::Uniform, &text(&["hair", "beard", "hair"]));
    assert_eq!(named.names, text(&["hair", "beard"]));
    assert_eq!(named.group_names, [0, 1, 0]);
    assert!(named.fits());
    let mut one = groom(&[2, 2, 2], &row(0.0, 6));
    one.set_group_names(Scope::Constant, &text(&["lashes"]));
    assert_eq!(
        (one.names, one.group_names),
        (text(&["lashes"]), vec![0; 3])
    );
    let mut indexed = groom(&[2, 2, 2], &row(0.0, 6));
    indexed.set_indexed_group_names(&text(&["x", "y", "x"]), &[2, 1, 9]);
    assert_eq!(indexed.names, text(&["x", "y", ""]));
    assert_eq!(indexed.group_names, [0, 1, 2], "the third names none");
    let mut short = groom(&[2, 2, 2], &row(0.0, 6));
    short.set_indexed_group_names(&text(&["x"]), &[0, 0]);
    assert!(short.names.is_empty() && short.group_names.is_empty());
}
