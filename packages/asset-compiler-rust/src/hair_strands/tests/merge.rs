//! The objects of a scene merged into one groom.
use super::{flat, groom, row};
use crate::hair_strands::carrier::Carried;
use crate::hair_strands::description::{Description, Widths};
use crate::hair_strands::stage::{merged, HairInputs};
use std::borrow::Cow;
use std::collections::BTreeSet;
use std::sync::atomic::AtomicBool;
use trillion3d_math::matrix::{translation, IDENTITY};

// Behaviour: the groom of a scene is its objects' strands one after the other, each object's points
// placed by its matrix; what only one object gives is the zero of its type for the others, a width
// like a colour, and where widths of both kinds are given those of each point are the groom's; the
// groom's width is the last that an object declares. The expectations are written by hand.
#[test]
fn the_objects_of_a_scene_are_merged_into_one_groom() {
    let mut first = groom(&[2], &row(0.0, 2));
    first.widths = Widths::Strand(vec![0.02]);
    first.groom_width = Some(0.05);
    let mut second = groom(&[2], &row(0.0, 2));
    second.widths = Widths::Vertex(vec![0.04, 0.04]);
    second.roughness = vec![0.5, 0.5];
    second.group_ids = vec![3];
    second.groom_width = Some(0.07);
    let mut third = groom(&[1], &row(0.0, 1));
    third.groom_width = None;
    let moved = translation([10.0, 0.0, 0.0]);
    let mut merged = Description::default();
    merged.append(&first, None);
    merged.append(&second, Some(&moved));
    assert_eq!(
        merged.positions,
        [0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 10.0, 0.0, 0.0, 11.0, 0.0, 0.0]
    );
    assert_eq!(merged.counts, [2, 2]);
    assert_eq!(
        merged.widths,
        Widths::Vertex(vec![0.0, 0.0, 0.04, 0.04]),
        "the first object's strand width counts for nothing beside widths of each point"
    );
    assert_eq!(merged.roughness, [0.0, 0.0, 0.5, 0.5]);
    assert_eq!(merged.group_ids, [0, 3]);
    assert_eq!(merged.groom_width, Some(0.07));
    merged.append(&third, None);
    assert_eq!(merged.counts, [2, 2, 1]);
    assert_eq!(
        merged.widths,
        Widths::Vertex(vec![0.0, 0.0, 0.04, 0.04, 0.0])
    );
    assert_eq!(merged.roughness, [0.0, 0.0, 0.5, 0.5, 0.0]);
    assert_eq!(merged.group_ids, [0, 3, 0]);
    assert_eq!(
        merged.groom_width,
        Some(0.07),
        "a later object that declares none changes nothing"
    );
    assert!(merged.fits());
    let mut strands = Description::default();
    strands.append(&first, None);
    strands.append(&third, None);
    assert_eq!(strands.widths, Widths::Strand(vec![0.02, 0.0]));
    let mut none = Description::default();
    none.append(&third, None);
    none.append(&third, None);
    assert_eq!(none.widths, Widths::None);
}

// Behaviour: the names of the strands of the objects are merged into one table, a strand of an
// object that names none having the empty name.
#[test]
fn the_group_names_of_the_objects_are_merged() {
    let mut named = groom(&[2], &row(0.0, 2));
    named.names = vec!["x".into()];
    named.group_names = vec![0];
    let bare = groom(&[2], &row(0.0, 2));
    let mut other = groom(&[2], &row(0.0, 2));
    other.names = vec!["y".into(), "x".into()];
    other.group_names = vec![1];
    let mut merged = Description::default();
    for one in [&bare, &named, &other, &bare] {
        merged.append(one, None);
    }
    assert_eq!(merged.names, ["", "x", "y"]);
    assert_eq!(merged.group_names, [0, 1, 1, 0]);
    assert!(merged.fits());
}

// Behaviour: the curves a file declares are read to the end of what its points cover: a count that
// passes the points, or is no count, ends the object's curves, which says so; the points past the
// last curve are dropped; an object with no point left brings no groom — curves of no point, or no
// curve at all, are not an error, and the second member still says whether the counts were cut.
#[test]
fn the_curves_a_file_declares_are_read_to_the_end_of_its_points() {
    let points = flat(&row(0.0, 5));
    let declared = |counts: &[i64]| Description::from_declared(points.clone(), counts.to_vec());
    let (read, truncated) = declared(&[2, 3]);
    let read = read.expect("two curves");
    assert_eq!(
        (read.counts, truncated, read.positions.len()),
        (vec![2, 3], false, 15)
    );
    let (read, truncated) = declared(&[2, 4, 1]);
    let read = read.expect("one");
    assert_eq!(
        (read.counts, truncated, read.positions.len()),
        (vec![2], true, 6)
    );
    let (read, truncated) = declared(&[1, -1, 1]);
    assert_eq!((read.expect("one").counts, truncated), (vec![1], true));
    assert_eq!(declared(&[9]), (None, true), "the first count passes");
    assert_eq!(declared(&[]), (None, false), "no curve");
    assert_eq!(
        declared(&[0, 0]),
        (None, false),
        "curves of no point bring no groom"
    );
    let (read, _) = declared(&[0, 2]);
    assert_eq!(read.expect("one with points").counts, [0, 2]);
}

// Behaviour: the groom of the scene is the objects the scene shows; one object that no matrix moves
// is the groom itself, not a copy; a hidden object, and one the scene does not reach, are left out.
#[test]
fn the_groom_of_the_scene_is_the_objects_it_shows() {
    let object = |node: usize, x: f32| Carried {
        node,
        description: groom(&[2], &[[x, 0.0, 0.0], [x + 1.0, 0.0, 0.0]]),
    };
    let carried = [
        object(0, 0.0),
        object(1, 10.0),
        object(2, 20.0),
        object(3, 30.0),
    ];
    let mut world = vec![IDENTITY; 4];
    world[1] = translation([5.0, 0.0, 0.0]);
    let (scene, hidden) = (BTreeSet::from([0, 1, 2]), BTreeSet::from([2]));
    let cancelled = AtomicBool::new(false);
    let settings = crate::HairOptions::default();
    let inputs = |carried| HairInputs {
        carried,
        world: &world,
        scene_nodes: &scene,
        hidden: &hidden,
        settings: &settings,
        cancelled: &cancelled,
    };
    let both = merged(&inputs(&carried));
    assert!(matches!(both, Cow::Owned(_)));
    assert_eq!(
        both.positions,
        [0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 15.0, 0.0, 0.0, 16.0, 0.0, 0.0],
        "objects 0 and 1, the second moved by 5; 2 is hidden and 3 is not in the scene"
    );
    let alone = merged(&inputs(&carried[..1]));
    assert!(matches!(alone, Cow::Borrowed(_)), "not copied");
    assert_eq!(*alone, carried[0].description);
    let moved = merged(&inputs(&carried[1..2]));
    assert_eq!(moved.positions[..3], [15.0, 0.0, 0.0]);
    assert!(merged(&inputs(&carried[2..])).counts.is_empty());
}
