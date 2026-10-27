//! The strands cut into groups, the strands left out or cut, and the attributes that follow a curve.
use super::{groom, groups, point, row, SHUFFLED};
use crate::hair_strands::abi::{
    HAIR_STRANDS_ATTRIBUTE_COLOR, HAIR_STRANDS_ATTRIBUTE_ROOT_UV, HAIR_STRANDS_ATTRIBUTE_ROUGHNESS,
    HAIR_STRANDS_FLAG_EXTRA_ENDING_POINT, HAIR_STRANDS_FLAG_INVALID_POINT,
    HAIR_STRANDS_FLAG_ROOT_TILE, HAIR_STRANDS_FLAG_TRIMMED_POINT,
};

// Behaviour: strands are cut into groups by their group number, in the order the groups are first
// met; a strand of no point is counted without making a group of its own.
#[test]
fn strands_are_cut_into_groups_in_the_order_they_are_met() {
    let mut cut = groom(&[2, 2, 2, 0], &row(0.0, 6));
    cut.group_ids = vec![5, 7, 5, 9];
    let built = groups(&cut, true);
    let seen: Vec<(i32, usize, u32)> = built
        .iter()
        .map(|group| (group.id, group.curves.len(), group.source_curves))
        .collect();
    assert_eq!(seen, [(5, 2, 2), (7, 1, 1)], "group 9 kept no curve");
    let whole = groups(&groom(&[2, 2], &row(0.0, 4)), true);
    assert_eq!(whole.iter().map(|group| group.id).collect::<Vec<_>>(), [0]);
}

// Behaviour: where no group number is given, the strands are cut by the name of their group, a name
// having no case and the empty one being none; a group takes for its number the rank it is met at,
// the groups a strand of no point makes included. A group number given wins over the names.
#[test]
fn strands_are_cut_into_groups_by_name_where_no_number_is_given() {
    let mut named = groom(&[2, 2, 2, 2, 2, 0], &row(0.0, 10));
    named.names = ["Hair", "hair", "Beard", "None", "", "Lashes"]
        .map(String::from)
        .to_vec();
    named.group_names = vec![0, 1, 2, 3, 4, 5];
    let seen: Vec<(i32, usize)> = groups(&named, true)
        .iter()
        .map(|group| (group.id, group.curves.len()))
        .collect();
    assert_eq!(
        seen,
        [(0, 2), (1, 1), (2, 2)],
        "hair twice, a beard, none twice; the lashes of no point are the group 3, and kept no curve"
    );
    named.group_ids = vec![5, 5, 6, 6, 6, 6];
    let seen: Vec<(i32, usize)> = groups(&named, true)
        .iter()
        .map(|group| (group.id, group.curves.len()))
        .collect();
    assert_eq!(seen, [(5, 2), (6, 3)], "the numbers, and no name");
}

// Behaviour: a strand with a point that is not a number is left out and flagged; one of more than 255
// points loses the rest and is flagged, with no ending point; one of 254 is given an ending point to
// make 255, and one of a single point is not given one, whatever curve comes before it.
#[test]
fn bad_and_long_strands_are_flagged_and_cut() {
    let mut points = vec![[f32::NAN, 0.0, 0.0], [1.0, 0.0, 0.0]];
    points.extend(row(0.0, 2));
    let built = groups(&groom(&[2, 2], &points), true);
    let group = &built[0];
    assert_eq!(group.curves.len(), 1);
    assert_eq!(
        group.flags,
        HAIR_STRANDS_FLAG_INVALID_POINT | HAIR_STRANDS_FLAG_EXTRA_ENDING_POINT | SHUFFLED
    );
    assert_eq!(group.source_curves, 2, "the curve left out is counted");
    let long = groups(&groom(&[300], &row(0.0, 300)), true);
    assert_eq!(long[0].curves, [255 << 24]);
    assert_eq!(long[0].flags, HAIR_STRANDS_FLAG_TRIMMED_POINT | SHUFFLED);
    let edge = groups(&groom(&[254], &row(0.0, 254)), true);
    assert_eq!(edge[0].curves, [255 << 24]);
    let single = groups(&groom(&[1], &row(0.0, 1)), true);
    assert_eq!(single[0].curves, [1 << 24], "no segment to extend");
    assert_eq!(single[0].flags, SHUFFLED);
    assert_eq!(
        point(&single[0], 0).2 >> 6,
        1,
        "a single point starts its curve"
    );
    let after = groups(&groom(&[2, 1], &row(0.0, 3)), true);
    assert_eq!(
        after[0].curves,
        [1 << 24, 1 | 3 << 24],
        "the single point of the second curve is not extended from the first curve's last point"
    );
    let without = groups(&groom(&[3], &row(0.0, 3)), false);
    assert_eq!(
        without[0].curves,
        [3 << 24],
        "an ending point is the build's to give"
    );
    assert_eq!(without[0].flags, SHUFFLED);
}

// Behaviour: the seed of a curve is drawn from the stream of its group's number, the root coordinates
// are packed on a word with the tile they lie on, the colours by their square roots and the
// roughness on a byte.
#[test]
fn seeds_root_coordinates_colours_and_roughness_are_packed() {
    let seeds = |id: i32, curves: usize| {
        let mut many = groom(&vec![2; curves], &row(0.0, 2 * curves));
        many.group_ids = vec![id; curves];
        groups(&many, true)[0].seeds.clone()
    };
    assert_eq!(seeds(0, 3), [53, 156, 244]);
    assert_eq!(seeds(5, 3), [112, 35, 129]);
    assert_eq!(seeds(-1, 2), [42, 232]);
    let mut painted = groom(&[2], &row(0.0, 2));
    painted.root_uvs = vec![0.5, 0.25];
    painted.colors = vec![1.0, 0.25, 0.0, 1.0, 0.25, 0.0];
    painted.roughness = vec![0.5, 0.5];
    let group = &groups(&painted, true)[0];
    assert_eq!(group.root_uvs, [1047551]);
    assert_eq!(
        group.colors, [2097151; 3],
        "the ending point is coloured as its point"
    );
    assert_eq!(group.roughness, [127; 3]);
    assert_eq!(
        group.attributes,
        HAIR_STRANDS_ATTRIBUTE_ROOT_UV
            | HAIR_STRANDS_ATTRIBUTE_COLOR
            | HAIR_STRANDS_ATTRIBUTE_ROUGHNESS
    );
    let mut tiled = groom(&[2], &row(0.0, 2));
    tiled.root_uvs = vec![2.5, 1.0];
    let group = &groups(&tiled, true)[0];
    assert_eq!(
        group.root_uvs,
        [12579839],
        "the tile 2 along u, the end of the tile 0 along v"
    );
    assert_eq!(
        group.flags & HAIR_STRANDS_FLAG_ROOT_TILE,
        HAIR_STRANDS_FLAG_ROOT_TILE
    );
}

// Behaviour: the colours, the roughness and the root coordinates of a curve go with it when the
// curves are shuffled.
#[test]
fn the_attributes_of_a_curve_follow_it_through_the_shuffle() {
    let mut two = groom(&[2, 2], &row(0.0, 4));
    two.root_uvs = vec![0.5, 0.25, 0.25, 0.5];
    two.roughness = vec![0.0, 0.0, 1.0, 1.0];
    let group = &groups(&two, true)[0];
    assert_eq!(
        group.roughness,
        [255, 255, 255, 0, 0, 0],
        "the second curve first"
    );
    assert_eq!(
        group.root_uvs,
        [2095615, 1047551],
        "the second curve's, then the first's"
    );
}
