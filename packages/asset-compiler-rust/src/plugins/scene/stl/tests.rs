use super::super::mesh_source::test_support::{attribute, read as decode};
use super::*;
const FACET: &str =
    "facet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 1 0 0\nvertex 0 1 0\nendloop\nendfacet\n";
fn binary(header: &[u8], attribute: u16) -> Vec<u8> {
    let mut bytes = vec![0; 80];
    bytes[..header.len()].copy_from_slice(header);
    bytes.extend(1u32.to_le_bytes());
    for value in [
        0.0f32, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0,
    ] {
        bytes.extend(value.to_le_bytes());
    }
    bytes.extend(attribute.to_le_bytes());
    bytes
}
#[test]
fn ascii_solids_and_binary_solid_header_keep_triangles_and_normals() {
    let ascii = format!(
        "solid two words\n{FACET}endsolid two words\nsolid another\n{FACET}endsolid another\n"
    );
    let scene = decode(&STL, ascii.as_bytes(), 1 << 20).unwrap();
    assert_eq!(scene.nodes[0]["name"], "two words");
    assert_eq!(scene.nodes[1]["name"], "another");
    assert_eq!(scene.mesh_triangles, [1, 1]);
    let binary = decode(&STL, &binary(b"solid this is binary", 0), 1 << 20).unwrap();
    let primitive = &binary.meshes[0]["primitives"][0];
    assert_eq!(
        attribute(&binary, primitive, "POSITION"),
        [0., 0., 0., 1., 0., 0., 0., 1., 0.]
    );
    assert_eq!(
        attribute(&binary, primitive, "NORMAL"),
        [0., 0., 1., 0., 0., 1., 0., 0., 1.]
    );
}
#[test]
fn both_binary_colour_conventions_preserve_five_bit_components() {
    let viscam = decode(
        &STL,
        &binary(b"", 0x8000 | (7 << 10) | (13 << 5) | 25),
        1 << 20,
    )
    .unwrap();
    let magics = decode(
        &STL,
        &binary(b"COLOR=\xff\0\0\xff", 7 | (13 << 5) | (25 << 10)),
        1 << 20,
    )
    .unwrap();
    for scene in [&viscam, &magics] {
        let color = &scene.materials[0]["pbrMetallicRoughness"]["baseColorFactor"];
        for (axis, expected) in [7.0f32 / 31.0, 13.0 / 31.0, 25.0 / 31.0, 1.0]
            .iter()
            .enumerate()
        {
            let expected = if axis == 3 {
                1.0
            } else {
                (((*expected as f64 + 0.055) / 1.055).powf(2.4)) as f32
            };
            assert!((color[axis].as_f64().unwrap() as f32 - expected).abs() < 1e-7);
        }
    }
    let object = decode(&STL, &binary(b"COLOR=\xff\0\0\x80", 0x8000), 1 << 20).unwrap();
    assert_eq!(object.materials[0]["alphaMode"], "BLEND");
}
#[test]
fn malformed_facets_are_refused_instead_of_returning_partial_geometry() {
    let good = format!("solid a\n{FACET}endsolid a\n");
    for text in [
        good.replace("endfacet\n", ""),
        good.replace("endsolid a", "endsolid b"),
        good.replace("vertex 1 0 0", "vertex NaN 0 0"),
    ] {
        assert!(decode(&STL, text.as_bytes(), 1 << 20).is_err());
    }
    let mut short = binary(b"", 0);
    short.pop();
    assert!(decode(&STL, &short, 1 << 20).is_err());
    assert!(decode(&STL, &binary(b"", 1), 1 << 20).is_err());
}
