//! A hit shades with the texture coordinate, the shading normal and the colour of the corners it
//! lies between: the cut's triangles keep them, the file closes with them.
use super::cluster;
use crate::ray_tracing::abi::*;
use crate::ray_tracing::encode::encode;
use crate::ray_tracing::tree::{primitive_tree, Traced};
use crate::support::le::u32_at;
use trillion3d_page_codec::encode::Attribute;
use trillion3d_page_codec::{FLAG_COLOR, FLAG_NORMAL, FLAG_UV};

fn attribute(flag: u32, width: usize, values: Vec<f32>) -> Attribute {
    Attribute {
        flag,
        width,
        values,
    }
}

#[test]
fn the_file_closes_with_the_corners_attributes_of_the_triangles() {
    let positions = [0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0];
    let dag = [cluster(vec![0, 1, 2], (0.0, f64::INFINITY), false)];
    let uvs = attribute(FLAG_UV, 2, vec![0.0, 0.0, 2.0, 0.0, 0.0, 3.0]);
    let normals = attribute(
        FLAG_NORMAL,
        3,
        vec![0.0, 0.0, -1.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0],
    );
    let colours = attribute(
        FLAG_COLOR,
        3,
        vec![1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0],
    );
    let carried = [&uvs, &normals, &colours];
    let tree = primitive_tree(&positions, &carried, &dag, Traced::default())
        .expect("a tree")
        .expect("a triangle");
    assert_eq!(tree.attributes.len(), 3 * RAY_TRACING_CORNER_BYTES);
    let bytes = encode(&[&tree]).expect("a file");
    let word = |at: usize| u32_at(&bytes, at).expect("a word");
    assert_eq!(word(24), 3, "the head counts the corners");
    assert_eq!(
        word(RAY_TRACING_HEAD_BYTES + 8),
        RAY_TRACING_FLAG_ATTRIBUTES | RAY_TRACING_FLAG_NORMALS
    );
    let table = bytes.len() - 3 * RAY_TRACING_CORNER_BYTES;
    // The second corner of the triangle as the tree laid it out: any order, so each corner is found by its uv.
    let corners: Vec<&[u8]> = bytes[table..].chunks(RAY_TRACING_CORNER_BYTES).collect();
    let float = |c: &[u8], at: usize| f32::from_le_bytes(c[at..at + 4].try_into().unwrap());
    let uv_of = |c: &[u8]| (float(c, 0), float(c, 4));
    let second = corners
        .iter()
        .find(|c| uv_of(c) == (2.0, 0.0))
        .expect("the second");
    assert_eq!(&second[12..16], &[0, 255, 0, 255]);
    // (1, 0, 0) in the octahedral map lands on (1, 0).
    assert_eq!(&second[8..12], &[0xff, 0x7f, 0, 0]);
    let third = corners
        .iter()
        .find(|c| uv_of(c) == (0.0, 3.0))
        .expect("the third");
    assert_eq!(&third[12..16], &[0, 0, 255, 255]);
}

#[test]
fn a_mesh_without_attributes_writes_none() {
    let positions = [0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0];
    let dag = [cluster(vec![0, 1, 2], (0.0, f64::INFINITY), false)];
    let tree = primitive_tree(&positions, &[], &dag, Traced::default())
        .expect("a tree")
        .expect("a triangle");
    assert!(tree.attributes.is_empty());
    let bytes = encode(&[&tree]).expect("a file");
    assert_eq!(u32_at(&bytes, 24), Some(0));
    let flags = u32_at(&bytes, RAY_TRACING_HEAD_BYTES + 8).expect("the flags");
    assert_eq!(
        flags & (RAY_TRACING_FLAG_ATTRIBUTES | RAY_TRACING_FLAG_NORMALS),
        0
    );
}

#[test]
fn a_mesh_with_a_uv_and_no_normal_does_not_flag_normals() {
    let positions = [0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0];
    let dag = [cluster(vec![0, 1, 2], (0.0, f64::INFINITY), false)];
    let uvs = attribute(FLAG_UV, 2, vec![0.0, 0.0, 2.0, 0.0, 0.0, 3.0]);
    let tree = primitive_tree(&positions, &[&uvs], &dag, Traced::default())
        .expect("a tree")
        .expect("a triangle");
    let bytes = encode(&[&tree]).expect("a file");
    let flags = u32_at(&bytes, RAY_TRACING_HEAD_BYTES + 8).expect("the flags");
    assert_eq!(flags, RAY_TRACING_FLAG_ATTRIBUTES);
}

#[test]
fn the_pole_normal_is_a_normal() {
    let positions = [0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0];
    let dag = [cluster(vec![0, 1, 2], (0.0, f64::INFINITY), false)];
    let normals = attribute(FLAG_NORMAL, 3, vec![0.0, 0.0, 1.0].repeat(3));
    let tree = primitive_tree(&positions, &[&normals], &dag, Traced::default())
        .expect("a tree")
        .expect("a triangle");
    let bytes = encode(&[&tree]).expect("a file");
    let table = bytes.len() - 3 * RAY_TRACING_CORNER_BYTES;
    assert_eq!(&bytes[table + 8..table + 12], &[0, 0, 0, 0]);
    let flags = u32_at(&bytes, RAY_TRACING_HEAD_BYTES + 8).expect("the flags");
    assert_ne!(flags & RAY_TRACING_FLAG_NORMALS, 0);
}
