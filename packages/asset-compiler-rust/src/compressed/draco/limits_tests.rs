use super::*;
use crate::compressed::tests::box_source;

#[test]
fn pinned_mesh_decoder_enforces_face_and_attribute_byte_limits() {
    let (_, binary) = box_source();
    for limits in [
        DecodeLimits::default().with_max_faces(1),
        DecodeLimits::default().with_max_decoded_bytes(1),
    ] {
        let error = MeshDecoder::new()
            .decode(
                &mut DecoderBuffer::new(binary.bytes()).with_limits(limits),
                &mut Mesh::new(),
            )
            .unwrap_err();
        assert_eq!(error.kind(), draco_core::ErrorKind::LimitExceeded);
    }
}
#[test]
fn sequential_input_backed_workspace_is_admitted_before_decoding() {
    let (mut g, binary) = box_source();
    let mut bytes = binary.bytes().to_vec();
    bytes[8] = 0; // Sequential method: admission runs before parsing its payload.
    let cancelled = AtomicBool::new(false);
    let error = expand(
        &mut g,
        Binary::Owned(bytes),
        &Budget {
            limit: 4096,
            cancelled: &cancelled,
        },
    )
    .err()
    .unwrap();
    assert_eq!(error.code, "RAM_ADMISSION_BUDGET_EXCEEDED");
}
