use super::tests::{expand_meshopt, meshopt_source};
use super::*;

fn expand<const N: usize>(filtered: [u8; N], filter: &str) -> Vec<u8> {
    let encoded = ::meshopt::encode_vertex_buffer(&[filtered]).unwrap();
    let (mut g, binary) = meshopt_source(encoded, 1, N, "ATTRIBUTES");
    g["bufferViews"][0]["extensions"][MESHOPT]["filter"] = json!(filter);
    let (g, out) = expand_meshopt(g, binary);
    let start = g["bufferViews"][0]["byteOffset"].as_u64().unwrap() as usize;
    out.bytes()[start..start + N].to_vec()
}
#[test]
fn meshopt_filters_reconstruct_known_vectors() {
    assert_eq!(expand([0, 0, 127, 0], "OCTAHEDRAL"), [0, 0, 127, 0]);
    let quaternion = [0f32, 0., 0., 1.];
    let mut filtered = [0u8; 8];
    unsafe {
        ::meshopt::ffi::meshopt_encodeFilterQuat(
            filtered.as_mut_ptr().cast(),
            1,
            8,
            16,
            quaternion.as_ptr(),
        );
    }
    let result = expand(filtered, "QUATERNION");
    let expected: Vec<_> = [0i16, 0, 0, 32767]
        .iter()
        .flat_map(|v| v.to_le_bytes())
        .collect();
    assert_eq!(result, expected);
    let vector = [1f32, 2., 3., 4.];
    let mut filtered = [0u8; 16];
    unsafe {
        ::meshopt::ffi::meshopt_encodeFilterExp(
            filtered.as_mut_ptr().cast(),
            1,
            16,
            24,
            vector.as_ptr(),
            0,
        );
    }
    let expected: Vec<_> = vector.iter().flat_map(|v| v.to_le_bytes()).collect();
    assert_eq!(expand(filtered, "EXPONENTIAL"), expected);
}
#[test]
fn meshopt_index_sequence_preserves_non_triangle_order() {
    let indices = [2u32, 0, 3, 1];
    let mut encoded = vec![0; unsafe { ::meshopt::ffi::meshopt_encodeIndexSequenceBound(4, 4) }];
    let size = unsafe {
        ::meshopt::ffi::meshopt_encodeIndexSequence(
            encoded.as_mut_ptr(),
            encoded.len(),
            indices.as_ptr(),
            4,
        )
    };
    encoded.truncate(size);
    let (g, binary) = meshopt_source(encoded, 4, 4, "INDICES");
    let (g, out) = expand_meshopt(g, binary);
    let start = g["bufferViews"][0]["byteOffset"].as_u64().unwrap() as usize;
    let expected: Vec<_> = indices.iter().flat_map(|v| v.to_le_bytes()).collect();
    assert_eq!(&out.bytes()[start..start + 16], expected);
}
