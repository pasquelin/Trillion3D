//! The local codec patch must preserve both wrapper and nested chunk integrity.
use super::*;
use source::test_support::read;

#[test]
fn rhino_instance_parent_and_child_crc_remain_strict() {
    let bytes = include_bytes!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../tests/fixtures/formats/rhino/instances.3dm"
    ));
    // Official Rhino 8 archive uses 12-byte long-chunk headers.
    let record = bytes
        .windows(4)
        .position(|v| v == [0x76, 0x80, 0, 0x20])
        .unwrap();
    let length = u64::from_le_bytes(bytes[record + 4..record + 12].try_into().unwrap()) as usize;
    let parent_crc = record + 12 + length - 4;
    assert_eq!(&bytes[parent_crc..parent_crc + 4], &[0; 4]);
    let child = record + 24;
    assert_eq!(&bytes[child..child + 4], &[0xfb, 0xff, 2, 0]);
    let child_length =
        u64::from_le_bytes(bytes[child + 4..child + 12].try_into().unwrap()) as usize;
    let child_crc = child + 12 + child_length - 4;
    assert!(read(&RHINO, bytes, 64 * 1024 * 1024).is_ok());
    for damaged in [parent_crc, child_crc, child + 12] {
        let mut altered = bytes.to_vec();
        altered[damaged] ^= 1;
        let error = read(&RHINO, &altered, 64 * 1024 * 1024)
            .err()
            .unwrap_or_else(|| panic!("accepted corruption at {damaged}"));
        assert!(error.message.contains("integrity"), "{}", error.message);
    }
}
