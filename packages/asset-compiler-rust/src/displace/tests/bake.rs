//! A square baked whole: tessellated where the height map bends it, each vertex moved along the
//! normal by the map's displacement, every attribute blended with the position; and two squares
//! baked together, each by the map of its rank.
use crate::displace::load::Bake;
use crate::displace::map::DisplacementMap;
use crate::displace::{bake_mesh, Baked, EdgeSplit, Piece, MAX_TRIANGLES};
use trillion3d_page_codec::encode::Attribute;
use trillion3d_page_codec::{FLAG_NORMAL, FLAG_UV};

const SQUARE: [f32; 12] = [0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 1.0, 1.0, 0.0, 0.0, 1.0, 0.0];
const CORNERS: [u32; 6] = [0, 1, 2, 0, 2, 3];
const HEIGHTS: [f32; 4] = [1.0, 0.0, 0.0, 1.0];

/// The square's normals, all up, and its texture coordinates, equal to its position.
fn attributes() -> Vec<Attribute> {
    let normals = [0.0, 0.0, 1.0].repeat(4);
    let uvs = vec![0.0, 0.0, 1.0, 0.0, 1.0, 1.0, 0.0, 1.0];
    vec![
        Attribute {
            flag: FLAG_NORMAL,
            width: 3,
            values: normals,
        },
        Attribute {
            flag: FLAG_UV,
            width: 2,
            values: uvs,
        },
    ]
}

/// The bake of the maps `maps`.
fn bake_of(maps: Vec<DisplacementMap>) -> Bake {
    Bake {
        maps,
        uv_channel: 0,
        edge_split: EdgeSplit::Seams,
    }
}

/// The bake of a map of `HEIGHTS`, its magnitude in centimetres.
fn settings(magnitude: f32) -> Bake {
    let map = DisplacementMap::new(HEIGHTS.to_vec(), (2, 2), (magnitude, 0.0), [false; 2]);
    bake_of(vec![map])
}

/// One mesh of one primitive, baked under the cap `cap`.
fn bake_one(
    cap: usize,
    (settings, trimmed_error): (&Bake, f32),
    (positions, attributes, indices): (&[f32], &[Attribute], &[u32]),
) -> Baked {
    let piece = Piece {
        material: 0,
        positions,
        attributes,
        indices,
    };
    bake_mesh(cap, settings, trimmed_error, &[piece]).remove(0)
}

fn baked(magnitude: f32, trimmed_error: f32) -> Baked {
    bake_one(
        MAX_TRIANGLES,
        (&settings(magnitude), trimmed_error),
        (&SQUARE, &attributes(), &CORNERS),
    )
}

fn near(a: f32, b: f32, what: &str) {
    assert!((a - b).abs() < 1e-4, "{what}: {a} against {b}");
}

#[test]
fn a_map_of_no_magnitude_leaves_the_square_as_it_is() {
    let flat = baked(0.0, 1.0);
    assert_eq!(flat.indices, CORNERS.to_vec());
    for (got, want) in flat.positions.iter().zip(SQUARE) {
        near(*got, want, "position");
    }
}

#[test]
fn a_bent_square_is_split_and_every_vertex_lies_on_the_map() {
    let out = baked(10.0, 1.0);
    let vertices = out.positions.len() / 3;
    assert!(
        out.indices.len() > CORNERS.len(),
        "{} corners",
        out.indices.len()
    );
    assert_eq!(out.indices.len() % 3, 0);
    assert!(out.indices.iter().all(|&v| (v as usize) < vertices));
    let kinds: Vec<u32> = out.attributes.iter().map(|a| a.flag).collect();
    assert_eq!(kinds, vec![FLAG_NORMAL, FLAG_UV]);
    for attribute in &out.attributes {
        assert_eq!(
            attribute.values.len(),
            vertices * attribute.width,
            "{}",
            attribute.flag
        );
    }
    // The map in metres, as the vertex's own texture coordinates read it.
    let map = DisplacementMap::new(HEIGHTS.to_vec(), (2, 2), (0.1, 0.0), [false; 2]);
    let (normals, uvs) = (&out.attributes[0].values, &out.attributes[1].values);
    for v in 0..vertices {
        let position = &out.positions[v * 3..v * 3 + 3];
        let uv = [uvs[v * 2], uvs[v * 2 + 1]];
        near(uv[0], position[0], "u follows x");
        near(uv[1], position[1], "v follows y");
        near(position[2], map.sample(uv), "z is the displacement");
        near(normals[v * 3 + 2], 1.0, "the normal stays up");
    }
}

#[test]
fn the_same_mesh_bakes_to_the_same_bytes() {
    let (first, second) = (baked(10.0, 1.0), baked(10.0, 1.0));
    assert_eq!(first.positions, second.positions);
    assert_eq!(first.indices, second.indices);
}

#[test]
fn vertices_at_one_position_take_the_mean_of_their_displacements() {
    // Two triangles whose diagonal's ends are two vertices each, as a texture seam leaves them: the
    // heights of the map at their coordinates differ (1 and 0), the displacements 10 and 0
    // centimetres. No triangle is split: the error asked is far above any the map makes.
    let positions = [
        0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 1.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 1.0, 0.0, 0.0, 1.0, 0.0,
    ];
    let attributes = [
        Attribute {
            flag: FLAG_NORMAL,
            width: 3,
            values: [0.0, 0.0, 1.0].repeat(6),
        },
        Attribute {
            flag: FLAG_UV,
            width: 2,
            values: vec![0.0, 0.0, 1.0, 0.0, 1.0, 1.0, 1.0, 0.0, 0.0, 1.0, 0.0, 1.0],
        },
    ];
    let corners = [0, 1, 2, 3, 4, 5];
    let settings = settings(10.0);
    let mesh = (&positions[..], &attributes[..], &corners[..]);
    let out = bake_one(MAX_TRIANGLES, (&settings, 1000.0), mesh);
    assert_eq!(out.indices, corners.to_vec());
    let z = |vertex: usize| out.positions[vertex * 3 + 2];
    near(z(0), 0.05, "a diagonal end");
    near(z(3), 0.05, "its copy");
    near(z(2), 0.05, "the other end");
    near(z(4), 0.05, "its copy");
    near(z(1), 0.0, "a vertex of one triangle");
    near(z(5), 0.0, "a vertex of the other");
}

#[test]
fn a_mesh_that_begins_at_the_cap_is_left_undisplaced_and_one_below_it_stops_at_the_round_that_reaches_it(
) {
    let (settings, attributes) = (settings(10.0), attributes());
    let run = |cap| bake_one(cap, (&settings, 1.0), (&SQUARE, &attributes, &CORNERS));
    let begun = run(2);
    assert_eq!(begun.indices, CORNERS.to_vec());
    for (got, want) in begun.positions.iter().zip(SQUARE) {
        near(*got, want, "position");
    }
    // One request fits under the cap, a split that makes the triangle three or the edge two more.
    let stopped = run(3);
    let triangles = stopped.indices.len() / 3;
    assert!((3..=4).contains(&triangles), "{triangles} triangles");
    assert!(
        stopped
            .positions
            .as_chunks::<3>()
            .0
            .iter()
            .any(|p| p[2].abs() > 1e-4),
        "displaced"
    );
}

/// The heights of the vertices of `baked` at the plane position (`x`, `y`), in metres.
fn heights_at(baked: &Baked, (x, y): (f32, f32)) -> Vec<f32> {
    (baked.positions.as_chunks::<3>().0.iter())
        .filter(|p| (p[0] - x).abs() < 1e-5 && (p[1] - y).abs() < 1e-5)
        .map(|p| p[2])
        .collect()
}

#[test]
fn two_primitives_are_displaced_each_by_the_map_of_its_rank_and_meet_without_a_crack() {
    // Two squares side by side, the second 1 m on: the first reads the map of `HEIGHTS` (10 cm), the
    // second a map of one height, 4 cm along the normal. The vertices of the edge they share take
    // the mean of what each asks (0 and 4 cm at its first end, 10 and 4 cm at its second).
    let maps = vec![
        DisplacementMap::new(HEIGHTS.to_vec(), (2, 2), (10.0, 0.0), [false; 2]),
        DisplacementMap::new(vec![1.0; 4], (2, 2), (4.0, 0.0), [false; 2]),
    ];
    let next: Vec<f32> = SQUARE
        .chunks(3)
        .flat_map(|p| [p[0] + 1.0, p[1], p[2]])
        .collect();
    let attributes = attributes();
    let piece = |material, positions| Piece {
        material,
        positions,
        attributes: &attributes,
        indices: &CORNERS,
    };
    let pieces = [piece(0, &SQUARE[..]), piece(1, &next[..])];
    let out = bake_mesh(MAX_TRIANGLES, &bake_of(maps), 1.0, &pieces);
    assert_eq!(out.len(), 2);
    for baked in &out {
        assert!(baked.indices.len() >= CORNERS.len() && baked.indices.len() % 3 == 0);
        let kinds: Vec<u32> = baked.attributes.iter().map(|a| a.flag).collect();
        assert_eq!(kinds, vec![FLAG_NORMAL, FLAG_UV]);
    }
    let all_at = |x, y| [heights_at(&out[0], (x, y)), heights_at(&out[1], (x, y))].concat();
    for (at, want) in [
        ((0.0, 0.0), 0.10),
        ((0.0, 1.0), 0.0),
        ((1.0, 0.0), 0.02),
        ((1.0, 1.0), 0.07),
        ((2.0, 0.0), 0.04),
        ((2.0, 1.0), 0.04),
    ] {
        let found = all_at(at.0, at.1);
        assert!(!found.is_empty(), "a vertex at {at:?}");
        for z in found {
            near(z, want, &format!("the height at {at:?}"));
        }
    }
    // The first primitive's two ends of the shared edge are found in the second as well.
    assert_eq!(heights_at(&out[1], (1.0, 0.0)).len(), 1);
}

#[test]
fn a_primitive_gets_back_only_the_kinds_of_attribute_it_brought() {
    // The second primitive, far from the first, has texture coordinates alone and no map of its
    // rank: its rows are laid out with the first's normals (read as nothing), it is not displaced,
    // and it takes back its coordinates, nothing more.
    let first = attributes();
    let second = vec![first[1].clone()];
    let far: Vec<f32> = SQUARE
        .chunks(3)
        .flat_map(|p| [p[0] + 10.0, p[1], p[2]])
        .collect();
    let settings = settings(10.0);
    let pieces = [
        Piece {
            material: 0,
            positions: &SQUARE,
            attributes: &first,
            indices: &CORNERS,
        },
        Piece {
            material: 1,
            positions: &far,
            attributes: &second,
            indices: &CORNERS,
        },
    ];
    let out = bake_mesh(MAX_TRIANGLES, &settings, 1.0, &pieces);
    let kinds = |baked: &Baked| baked.attributes.iter().map(|a| a.flag).collect::<Vec<_>>();
    assert_eq!(kinds(&out[0]), vec![FLAG_NORMAL, FLAG_UV]);
    assert_eq!(kinds(&out[1]), vec![FLAG_UV]);
    assert_eq!(out[1].indices, CORNERS.to_vec());
    assert_eq!(
        out[1].attributes[0].values.len(),
        out[1].positions.len() / 3 * 2
    );
    assert!(out[1]
        .positions
        .as_chunks::<3>()
        .0
        .iter()
        .all(|p| p[2] == 0.0));
}
