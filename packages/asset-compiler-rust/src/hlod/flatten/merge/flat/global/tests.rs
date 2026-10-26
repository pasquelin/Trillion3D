//! The entries laid out together: the folding of identical triangles, the order of the unique
//! triangles, the methods, and the failure of the whole.
use super::*;
use crate::hlod::flatten::merge::flat::ground::laid_out;
use trillion3d_page_codec::encode::Attribute;
use trillion3d_page_codec::FLAG_UV;

type Set = Vec<[[f64; 2]; 3]>;

/// The corners of a unit square, in order.
const UNIT: [[f32; 2]; 4] = [[0.0, 0.0], [1.0, 0.0], [1.0, 1.0], [0.0, 1.0]];

/// A part of mesh `mesh` made of the triangles `indices` over `positions` (metres, three floats a
/// vertex), wearing the first texture set `uvs`.
fn part(mesh: usize, positions: Vec<f32>, uvs: Vec<f32>, indices: Vec<u32>) -> Part {
    let first = Attribute {
        flag: FLAG_UV,
        width: 2,
        values: uvs,
    };
    Part {
        material: None,
        mesh,
        mirrored: false,
        geometry: (positions, vec![first], indices),
    }
}

/// The positions of a unit square at `at` along the first axis.
fn square_positions(at: f32) -> Vec<f32> {
    (UNIT.iter()).flat_map(|c| [c[0] + at, c[1], 0.0]).collect()
}

/// The indices of the two triangles of a square whose corners start at `first`.
fn square_indices(first: u32) -> Vec<u32> {
    [0, 1, 2, 0, 2, 3].map(|k| first + k).to_vec()
}

/// The positions of the triangle over the first three corners of a unit square, at `at`.
fn triangle_positions(at: f32) -> Vec<f32> {
    square_positions(at)[..9].to_vec()
}

/// The coordinates `corners` twice, flat.
fn twice(corners: &[[f32; 2]]) -> Vec<f32> {
    corners.iter().chain(corners).flatten().copied().collect()
}

/// A unit square at `at`, two triangles, wearing the unit square's texture coordinates.
fn square(mesh: usize, at: f32) -> Part {
    let uvs = UNIT.iter().flatten().copied().collect();
    part(mesh, square_positions(at), uvs, square_indices(0))
}

/// The box of the coordinates of `set`: its lowest and its highest.
fn bounds(set: &[[[f64; 2]; 3]]) -> ([f64; 2], [f64; 2]) {
    let flat = set.iter().flatten().copied();
    flat.fold(([f64::MAX; 2], [f64::MIN; 2]), |(low, high), uv| {
        (
            [0, 1].map(|k| low[k].min(uv[k])),
            [0, 1].map(|k| high[k].max(uv[k])),
        )
    })
}

/// Whether the boxes of `a` and `b` are apart on an axis, and both lie in the unit square.
fn apart_in_the_unit_square(a: &Set, b: &Set) -> bool {
    let ((low_a, high_a), (low_b, high_b)) = (bounds(a), bounds(b));
    let inside =
        |low: [f64; 2], high: [f64; 2]| (0..2).all(|k| low[k] >= -1e-9 && high[k] <= 1.0 + 1e-9);
    let apart = (0..2).any(|k| high_a[k] <= low_b[k] + 1e-9 || high_b[k] <= low_a[k] + 1e-9);
    apart && inside(low_a, high_a) && inside(low_b, high_b)
}

#[test]
fn two_entries_are_laid_out_by_one_legacy_layout_over_both_and_one_box() {
    let (a, b) = (square(0, 0.0), square(1, 5.0));
    // Each mesh on its own, as a layer that reuses lightmap sets lays them: both fill the unit
    // square, one over the other.
    let alone = |part: &Part| bounds(&laid_out(part, HlodUvMethod::Legacy, 256));
    assert_eq!(alone(&a), ([0.0; 2], [1.0; 2]));
    assert_eq!(alone(&b), ([0.0; 2], [1.0; 2]));
    // Together: the layout of both meshes' corners in turn, then the box of all of them.
    let together = laid_together(&[&a, &b], HlodUvMethod::Legacy, 256).expect("laid");
    let mut corners = LayoutCorners::default();
    corners.push(&a, |_| true);
    corners.push(&b, |_| true);
    let laid = corners.lay_out(256).expect("a layout");
    let set_of = |range: Range<usize>| -> Set {
        (laid[range].chunks(3))
            .map(|c| [c[0], c[1], c[2]].map(|uv| uv.map(f64::from)))
            .collect()
    };
    let mut expected = vec![set_of(0..6), set_of(6..12)];
    scaled_to_box(&mut expected);
    assert_eq!(together, expected);
    assert!(apart_in_the_unit_square(&together[0], &together[1]));
}

#[test]
fn identical_triangles_of_an_entry_take_one_coordinate_set() {
    // Two triangles far apart that wear the same texture coordinates: the two instances of one
    // mesh, folded into one.
    let positions = [triangle_positions(0.0), triangle_positions(9.0)].concat();
    let uvs = twice(&UNIT[..3]);
    let both = part(0, positions, uvs, vec![0, 1, 2, 3, 4, 5]);
    let folded = Folded::of(&[&both]);
    assert_eq!(folded.first, [true, false]);
    assert_eq!(folded.ranks, [0, 0]);
    let sets = laid_together(&[&both], HlodUvMethod::Legacy, 256).expect("laid");
    assert_eq!(sets[0][0], sets[0][1]);
    // Another entry's triangle is never the same triangle, whatever it wears; the points the
    // folded triangles name are not in the merged mesh.
    let other = part(
        1,
        both.geometry.0.clone(),
        both.geometry.1[0].values.clone(),
        vec![0, 1, 2, 3, 4, 5],
    );
    let folded = Folded::of(&[&both, &other]);
    assert_eq!(folded.first, [true, false, true, false]);
    assert_eq!(folded.ranks, [0, 0, 1, 1]);
    let (points, triangles) = merged(&[&both, &other], &folded);
    assert_eq!(points.len(), 6);
    assert_eq!(triangles, [[0, 1, 2], [3, 4, 5]]);
}

#[test]
fn triangles_a_32_bit_checksum_of_their_bytes_cannot_tell_apart_stay_two() {
    // Texture coordinates `(0.25, 0.5)` and `(0.2504431, 0.5157871)`: different bytes, the same
    // 32-bit checksum (0xacfdea64 of their eight bytes), so a key of that width would fold the
    // second triangle into the first.
    let other = [0x3e803a14, 0x3f040aa0].map(f32::from_bits);
    assert_ne!(other, [0.25, 0.5]);
    let rest = [1.0, 0.0, 0.0, 1.0];
    let uvs: Vec<f32> = [&[0.25, 0.5][..], &rest[..], &other[..], &rest[..]].concat();
    let positions = [triangle_positions(0.0), triangle_positions(9.0)].concat();
    let two = part(0, positions, uvs, vec![0, 1, 2, 3, 4, 5]);
    let folded = Folded::of(&[&two]);
    assert_eq!(folded.first, [true, true]);
    assert_eq!(folded.ranks, [0, 1]);
}

#[test]
fn the_other_methods_fold_and_rank_triangles_the_same_way() {
    // Entry 0: two identical squares far apart (four triangles, two unique); entry 1: one square
    // wearing other coordinates. The unwrap sees the unique triangles of both, in that order.
    let positions: Vec<f32> = [square_positions(0.0), square_positions(3.0)].concat();
    let uvs = twice(&UNIT);
    let indices = [square_indices(0), square_indices(4)].concat();
    let twin = part(0, positions, uvs, indices);
    let uvs: Vec<f32> = UNIT.iter().flatten().map(|x| x * 0.5 + 0.1).collect();
    let other = part(1, square_positions(8.0), uvs, square_indices(0));
    let folded = Folded::of(&[&twin, &other]);
    assert_eq!(folded.first, [true, true, false, false, true, true]);
    assert_eq!(folded.ranks, [0, 1, 0, 1, 2, 3]);
    for method in [HlodUvMethod::Patches, HlodUvMethod::Charts] {
        let sets = laid_together(&[&twin, &other], method, 256).expect("laid");
        let (first, second) = (&sets[0], &sets[1]);
        // The folded squares take the coordinates of the ones they fold into.
        assert_eq!([first[2], first[3]], [first[0], first[1]], "{method:?}");
        // The entry that follows takes the unique triangles that follow, not the first ones.
        assert_ne!(second[0], first[0], "{method:?}");
        if method == HlodUvMethod::Patches {
            assert!(apart_in_the_unit_square(first, second));
        }
    }
}

#[test]
fn an_unwrap_of_the_whole_that_fails_lays_nothing_out_together() {
    // One triangle of no area, the only one: the spectral charts have nothing to cut.
    let flat = part(
        0,
        vec![0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 2.0, 0.0, 0.0],
        vec![0.0, 0.0, 1.0, 0.0, 0.0, 1.0],
        vec![0, 1, 2],
    );
    assert!(laid_together(&[&flat], HlodUvMethod::UvAtlas, 256).is_none());
}
