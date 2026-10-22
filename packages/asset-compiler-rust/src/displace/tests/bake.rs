//! A square baked whole: tessellated where the height map bends it, each vertex moved along the
//! normal by the map's displacement, every attribute blended with the position.
use crate::displace::map::DisplacementMap;
use crate::displace::{bake, Bake, Baked, EdgeSplit};
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

/// The bake of a map of `HEIGHTS`, its magnitude in centimetres.
fn settings(magnitude: f32) -> Bake {
    let map = DisplacementMap::new(HEIGHTS.to_vec(), (2, 2), (magnitude, 0.0), [false; 2]);
    Bake {
        maps: vec![map],
        uv_channel: 0,
        edge_split: EdgeSplit::Seams,
    }
}

fn baked(magnitude: f32, trimmed_error: f32) -> Baked {
    bake(
        &settings(magnitude),
        trimmed_error,
        (&SQUARE, &attributes()),
        &CORNERS,
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
