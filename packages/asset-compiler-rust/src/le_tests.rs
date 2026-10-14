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
