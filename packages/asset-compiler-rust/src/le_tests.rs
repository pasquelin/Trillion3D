use super::*;

#[test]
fn a_field_past_the_end_is_none_and_one_inside_reads_little_endian() {
    let bytes = [0x01, 0x02, 0x03, 0x04, 0x05];
    assert_eq!(u16_at(&bytes, 3), Some(0x0504));
    assert_eq!(u16_at(&bytes, 4), None);
    assert_eq!(u32_at(&bytes, 1), Some(0x0504_0302));
    assert_eq!(u32_at(&bytes, usize::MAX), None);
    assert_eq!(u64_at(&bytes, 0), None);
}

#[test]
fn big_endian_fields_and_words_stay_inside_their_bytes() {
    let bytes = [0x01, 0x02, 0x03, 0x04, 0x05];
    assert_eq!(be16_at(&bytes, 3), Some(0x0405));
    assert_eq!(be16_at(&bytes, 4), None);
    assert_eq!(be32_at(&bytes, 1), Some(0x0203_0405));
    assert_eq!(be64_at(&bytes, 0), None);
    let read: Vec<u16> = words(&bytes, u16::from_le_bytes).collect();
    assert_eq!(read, [0x0201, 0x0403], "the odd tail byte is left");
}

#[test]
fn uint_at_reads_each_width_in_either_order_and_refuses_the_rest() {
    let bytes = [0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08];
    for big_endian in [false, true] {
        assert_eq!(uint_at(&bytes, 7, 1, big_endian), Some(0x08));
        assert_eq!(uint_at(&bytes, 8, 1, big_endian), None);
        assert_eq!(uint_at(&bytes, 7, 2, big_endian), None);
        assert_eq!(
            uint_at(&bytes, 0, 3, big_endian),
            None,
            "no three-byte field"
        );
    }
    assert_eq!(uint_at(&bytes, 1, 2, false), Some(0x0302));
    assert_eq!(uint_at(&bytes, 1, 2, true), Some(0x0203));
    assert_eq!(uint_at(&bytes, 0, 4, false), Some(0x0403_0201));
    assert_eq!(uint_at(&bytes, 0, 4, true), Some(0x0102_0304));
    assert_eq!(uint_at(&bytes, 0, 8, false), Some(0x0807_0605_0403_0201));
    assert_eq!(uint_at(&bytes, 0, 8, true), Some(0x0102_0304_0506_0708));
}

#[test]
fn a_cursor_reads_in_sequence_and_stays_put_on_a_short_read() {
    let bytes = [7, 0x34, 0x12, 1, 0, 0];
    let mut cursor = Cursor::new(&bytes);
    assert_eq!(cursor.u8(), Some(7));
    assert_eq!(cursor.u16(), Some(0x1234));
    assert_eq!(cursor.u32(), None, "three bytes are left");
    assert_eq!(cursor.rest(), [1, 0, 0]);
    assert_eq!(cursor.take(3), Some(&[1u8, 0, 0][..]));
    assert!(cursor.done());
    cursor.align(4);
    assert_eq!(cursor.rest(), [0u8; 0]);
}

#[test]
fn until_nul_stops_at_the_first_null_or_keeps_every_byte() {
    assert_eq!(until_nul(b"rd\0\0pad"), b"rd");
    assert_eq!(until_nul(b"sRGB"), b"sRGB");
    assert_eq!(until_nul(b""), b"");
}
