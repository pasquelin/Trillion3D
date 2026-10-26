//! The soup's adjacency, kept by the edits the tessellation makes.
use crate::displace::mesh::{cycle3, Soup};
use crate::displace::policy::Displacer;
use crate::displace::tessellate::{Record, Tessellation};
use crate::displace::EdgeSplit;

fn near(a: f32, b: f32) {
    assert!((a - b).abs() < 1e-6, "{a} against {b}");
}

/// A square of two triangles, (0,1,2) and (0,2,3), over the corners (0,0), (1,0), (1,1), (0,1);
/// each vertex's row is its position and a texture coordinate equal to it.
fn quad(split: EdgeSplit, materials: [i32; 2]) -> Soup {
    let corners = [(0.0, 0.0), (1.0, 0.0), (1.0, 1.0), (0.0, 1.0)];
    let rows: Vec<f32> = corners
        .iter()
        .flat_map(|&(x, y)| [x, y, 0.0, x, y])
        .collect();
    Soup::new(
        (rows, 5),
        vec![3],
        (vec![0, 1, 2, 0, 2, 3], materials.to_vec()),
        split,
    )
}

/// Every half edge that has another across it is that one's, and both run between the same two
/// positions, the other way.
fn assert_paired(soup: &Soup) {
    let ends = |half: usize| {
        let from = soup.position(soup.indices[half]);
        let to = soup.position(soup.indices[cycle3(half, 1)]);
        (from, to)
    };
    for half in 0..soup.indices.len() {
        let Ok(across) = usize::try_from(soup.adjacent[half]) else {
            continue;
        };
        assert_eq!(soup.adjacent[across], half as i32, "half edge {half}");
        let ((from, to), (back_from, back_to)) = (ends(half), ends(across));
        assert_eq!((from, to), (back_to, back_from), "half edge {half}");
    }
}

#[test]
fn the_two_triangles_of_a_square_are_paired_across_their_diagonal() {
    let soup = quad(EdgeSplit::Seams, [0, 0]);
    assert_eq!(soup.across(0, 2), Some(1));
    assert_eq!(soup.across_edge(0, 2), Some((1, 0)));
    assert_eq!(soup.across(0, 0), None);
    assert!(soup.manifold(0, 2));
    assert_paired(&soup);
}

#[test]
fn an_edge_split_shares_its_vertex_unless_a_seam_or_the_mode_says_otherwise() {
    let mut shared = quad(EdgeSplit::Seams, [0, 0]);
    let split = shared.split_edge(0, 2, 0.5);
    assert_eq!((split.count, split.vertex[0] == split.vertex[1]), (2, true));
    assert_eq!((shared.triangle_count(), shared.vertex_count()), (4, 5));
    assert_eq!(shared.position(split.vertex[0] as u32), [0.5, 0.5, 0.0]);
    assert_paired(&shared);
    for (mode, materials) in [
        (EdgeSplit::AlwaysDuplicate, [0, 0]),
        (EdgeSplit::Seams, [0, 1]),
    ] {
        let mut soup = quad(mode, materials);
        let split = soup.split_edge(0, 2, 0.5);
        assert_ne!(split.vertex[0], split.vertex[1], "{mode:?} {materials:?}");
        assert_eq!(soup.vertex_count(), 6);
        let at = |vertex: usize| soup.position(vertex as u32);
        let (first, second) = (at(split.vertex[0]), at(split.vertex[1]));
        assert_eq!(first, second);
        assert_paired(&soup);
    }
}

#[test]
fn a_border_edge_splits_one_triangle() {
    let mut soup = quad(EdgeSplit::Seams, [0, 0]);
    let split = soup.split_edge(0, 0, 0.25);
    assert_eq!((split.count, soup.triangle_count()), (1, 3));
    let at = soup.position(split.vertex[0] as u32);
    near(at[0], 0.75);
    assert_paired(&soup);
}

#[test]
fn a_poke_joins_a_new_vertex_to_the_three_corners() {
    let mut soup = quad(EdgeSplit::Seams, [0, 0]);
    let poke = soup.poke(0, [0.2, 0.3, 0.5]);
    assert_eq!(poke.triangles, [0, 2, 3]);
    assert_eq!(soup.triangle_count(), 4);
    let row = soup.row(poke.vertex as u32).to_vec();
    for (got, want) in row.iter().zip([0.8, 0.5, 0.0, 0.8, 0.5]) {
        near(*got, want);
    }
    assert_paired(&soup);
}

#[test]
fn a_flip_turns_the_diagonal_of_a_quad() {
    let mut soup = quad(EdgeSplit::Seams, [0, 0]);
    assert_eq!(soup.flip(0, 2), [0, 1]);
    assert_eq!(soup.triangle(0), [3, 1, 2]);
    assert_eq!(soup.triangle(1), [1, 3, 0]);
    assert_eq!(soup.across(0, 0), Some(1));
    assert_paired(&soup);
}

#[test]
fn a_half_edge_pairs_with_the_latest_earlier_one_that_has_no_partner() {
    // Three triangles on one edge, (0 → 1) twice then (1 → 0): the last takes the second.
    let rows: Vec<f32> = [
        [0.0, 0.0, 0.0],
        [1.0, 0.0, 0.0],
        [0.0, 1.0, 0.0],
        [0.0, -1.0, 0.0],
        [0.0, 0.0, 1.0],
    ]
    .concat();
    let indices = vec![0, 1, 2, 0, 1, 3, 1, 0, 4];
    let soup = Soup::new((rows, 3), vec![], (indices, vec![0; 3]), EdgeSplit::Seams);
    assert_eq!((soup.adjacent[6], soup.adjacent[3]), (3, 6));
    assert_eq!(soup.adjacent[0], -1, "the earlier one waits");
}

/// The refinement of `mesh`, displacing nothing, its first two triangles asking to be split and the
/// queue holding the first.
fn refinement<'a>(mesh: Soup, policy: &'a Displacer<'a>) -> Tessellation<'a> {
    let mut records = vec![Record::default(); mesh.triangle_count()];
    records[0].request = 0;
    Tessellation {
        mesh,
        policy,
        target_error: 1.0,
        sample_rate: 1.0,
        displacements: Vec::new(),
        records,
        find: Vec::new(),
        splits: vec![0],
        new_triangles: 0,
        cap: usize::MAX,
    }
}

/// Two triangles over the quad (−1, 0), (0, −0.2), (1, 0), (0, 0.2) — the angles across their
/// diagonal 157° each — or over the unit square.
fn flat_quad(skinny: bool) -> Soup {
    let corners: [[f32; 3]; 4] = match skinny {
        true => [
            [-1.0, 0.0, 0.0],
            [0.0, -0.2, 0.0],
            [1.0, 0.0, 0.0],
            [0.0, 0.2, 0.0],
        ],
        false => [
            [0.0, 0.0, 0.0],
            [1.0, 0.0, 0.0],
            [1.0, 1.0, 0.0],
            [0.0, 1.0, 0.0],
        ],
    };
    let indices = vec![0, 1, 2, 0, 2, 3];
    Soup::new(
        (corners.concat(), 3),
        vec![],
        (indices, vec![0; 2]),
        EdgeSplit::Seams,
    )
}

#[test]
fn a_diagonal_whose_angles_are_obtuse_is_flipped_and_its_triangles_look_again() {
    let policy = Displacer {
        maps: &[],
        normal: None,
        uv: None,
    };
    let mut work = refinement(flat_quad(true), &policy);
    work.try_flip(0, 2);
    assert_eq!(work.mesh.triangle(0), [3, 1, 2]);
    assert_eq!(work.mesh.triangle(1), [1, 3, 0]);
    // Both look again, the first first; the request the first held is out of the queue.
    assert_eq!(work.find, vec![0, 1]);
    assert!(work.splits.is_empty());
    assert_eq!((work.records[0].request, work.records[1].request), (-2, -2));
}

#[test]
fn a_diagonal_whose_triangles_are_as_well_shaped_across_it_stays() {
    let policy = Displacer {
        maps: &[],
        normal: None,
        uv: None,
    };
    let mut work = refinement(flat_quad(false), &policy);
    work.try_flip(0, 2);
    assert_eq!(work.mesh.triangle(0), [0, 1, 2]);
    assert!(work.find.is_empty());
    assert_eq!(work.splits, vec![0], "its request stands");
}
