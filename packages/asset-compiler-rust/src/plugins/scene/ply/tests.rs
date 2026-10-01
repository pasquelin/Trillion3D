use super::super::mesh_source::test_support::{attribute, read as decode};
use super::*;
const VERTICES: &str = "element vertex 4\nproperty float x\nproperty float y\nproperty float z\n";
const FACES: &str = "element face 2\nproperty list uchar int vertex_indices\n";
fn ascii() -> String {
    format!("ply\nformat ascii 1.0\n{VERTICES}{FACES}end_header\n0 0 0\n1 0 0\n1 1 0\n0 1 0\n3 0 1 2\n3 0 2 3\n")
}
fn binary(big: bool) -> Vec<u8> {
    let format = if big {
        "binary_big_endian"
    } else {
        "binary_little_endian"
    };
    let mut bytes = format!("ply\nformat {format} 1.0\n{VERTICES}{FACES}end_header\n").into_bytes();
    for v in [0.0f32, 0., 0., 1., 0., 0., 1., 1., 0., 0., 1., 0.] {
        bytes.extend(if big {
            v.to_be_bytes()
        } else {
            v.to_le_bytes()
        });
    }
    for face in [[0i32, 1, 2], [0, 2, 3]] {
        bytes.push(3);
        for v in face {
            bytes.extend(if big {
                v.to_be_bytes()
            } else {
                v.to_le_bytes()
            });
        }
    }
    bytes
}
#[test]
fn all_encodings_keep_source_triangle_order() {
    let sources = [ascii().into_bytes(), binary(false), binary(true)];
    for bytes in sources {
        let scene = decode(&PLY, &bytes, 1 << 20).unwrap();
        assert_eq!(scene.mesh_triangles, [2]);
        assert_eq!(
            attribute(&scene, &scene.meshes[0]["primitives"][0], "POSITION"),
            [0., 0., 0., 1., 0., 0., 1., 1., 0., 0., 0., 0., 1., 1., 0., 0., 1., 0.]
        );
    }
}
#[test]
fn colours_and_distinct_equal_materials_keep_their_authored_identity() {
    let text = ascii().replace("element face 2", "property uchar red\nproperty uchar green\nproperty uchar blue\nelement face 2")
        .replace("end_header", "property int material_index\nelement material 2\nproperty uchar red\nproperty uchar green\nproperty uchar blue\nend_header")
        .replace("0 0 0\n1 0 0\n1 1 0\n0 1 0\n3 0 1 2\n3 0 2 3", "0 0 0 255 0 0\n1 0 0 0 255 0\n1 1 0 0 0 255\n0 1 0 255 255 255\n3 0 1 2 1\n3 0 2 3 0\n255 0 0\n255 0 0");
    let scene = decode(&PLY, text.as_bytes(), 1 << 20).unwrap();
    assert_eq!(scene.materials.len(), 2);
    assert_eq!(scene.meshes[0]["primitives"][0]["material"], 1);
    assert_eq!(scene.meshes[0]["primitives"][1]["material"], 0);
    assert_eq!(
        attribute(&scene, &scene.meshes[0]["primitives"][0], "COLOR_0"),
        [1., 0., 0., 1., 0., 1., 0., 1., 0., 0., 1., 1.]
    );
}
#[test]
fn invalid_indices_counts_attributes_and_truncation_are_named_refusals() {
    for source in [
        ascii().replace("3 0 2 3", "3 0 2 99"),
        ascii().replace("3 0 2 3", "-3 0 2 3"),
        ascii().replace("property float x", "property float mystery"),
        ascii().replace("vertex 4", "vertex 999999999"),
        ascii().replace("1 1 0", "NaN 1 0"),
    ] {
        assert!(decode(&PLY, source.as_bytes(), 1 << 20).is_err());
    }
    let mut short = binary(true);
    short.pop();
    assert!(decode(&PLY, &short, 1 << 20).is_err());
}
#[test]
fn translucent_vertex_colors_enable_blending_without_losing_source_materials() {
    let colors = ascii().replace("element face 2", "property uchar red\nproperty uchar green\nproperty uchar blue\nproperty uchar alpha\nelement face 2")
        .replace("0 0 0\n1 0 0\n1 1 0\n0 1 0", "0 0 0 255 255 255 128\n1 0 0 255 255 255 255\n1 1 0 255 255 255 255\n0 1 0 255 255 255 255");
    for declared in [false, true] {
        let text = if declared {
            colors.replace("end_header", "property int material_index\nelement material 1\nproperty uchar red\nproperty uchar green\nproperty uchar blue\nend_header")
            .replace("3 0 1 2\n3 0 2 3", "3 0 1 2 0\n3 0 2 3 0\n255 255 255")
        } else {
            colors.clone()
        };
        let scene = decode(&PLY, text.as_bytes(), 1 << 20).unwrap();
        let primitive = &scene.meshes[0]["primitives"][0];
        let rank = primitive["material"].as_u64().unwrap() as usize;
        assert_eq!(scene.materials[rank]["alphaMode"], "BLEND");
        assert!((attribute(&scene, primitive, "COLOR_0")[3] - 128.0 / 255.0).abs() < 1e-7);
        if declared {
            assert_eq!(scene.materials[rank]["extras"]["sourceMaterial"], 0);
            assert_eq!(scene.materials[0]["name"], "material-0");
        }
    }
}
