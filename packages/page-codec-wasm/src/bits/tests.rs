//! Bit fields, the sequential reader, the grid's step and record, and the octahedral normals.

use super::*;
use trillion3d_math::GOLDEN_32;

/// The reference `field`: two word reads, a shift and a mask per field.
pub fn random_field(words: &[u32], at: usize, bits: u32) -> u32 {
    if bits == 0 {
        return 0;
    }
    let (shift, index) = ((at % 32) as u32, at / 32);
    let mut value = u64::from(words[index]) >> shift;
    if shift + bits > 32 {
        value |= u64::from(words[index + 1]) << (32 - shift);
    }
    (value & ((1u64 << bits) - 1)) as u32
}

#[test]
fn a_field_crosses_a_word_boundary_and_a_zero_width_field_reads_zero() {
    let words = [0xF000_0000u32, 0x0000_00AB];
    let field = |at, bits| BitReader::at(&words, at).read(bits);
    assert_eq!(field(28, 12), 0xABF);
    assert_eq!(field(28, 0), 0);
    assert_eq!(field(32, 8), 0xAB);
    assert_eq!(bits_for(0), 0);
    assert_eq!(bits_for(255), 8);
    assert_eq!(bits_for(256), 9);
    assert_eq!(stream_words(3, 24), 3);
}

#[test]
fn the_sequential_reader_reads_each_field_where_the_random_reader_finds_it() {
    let words: Vec<u32> = (1..=40u32).map(|i| i.wrapping_mul(GOLDEN_32)).collect();
    for bits in 0..=MAX_BITS {
        for start in [0, 5, 31, 32] {
            let mut stream = BitReader::at(&words, start);
            for i in 0..(words.len() * 32 - 32 - start) / bits.max(1) as usize {
                assert_eq!(
                    stream.read(bits),
                    random_field(&words, start + i * bits as usize, bits)
                );
            }
        }
    }
}

#[test]
fn the_step_is_exact_and_the_record_survives_its_word() {
    assert_eq!(pow2(-16), 1.0 / 65536.0);
    assert_eq!(pow2(3), 8.0);
    let grid = PositionGrid {
        start: [-7, 0, 1 << 30],
        bits: [17, 0, 21],
        precision: -20,
    };
    assert_eq!(PositionGrid::unpack(grid.packed(), grid.start), Some(grid));
    // A precision, a width or a stray bit past the format's, and a cell past an `i32`.
    assert_eq!(PositionGrid::unpack(44 << 24, [0; 3]), None);
    assert_eq!(PositionGrid::unpack(22, [0; 3]), None);
    assert_eq!(PositionGrid::unpack(1 << 18, [0; 3]), None);
    assert_eq!(PositionGrid::unpack(21, [i32::MAX, 0, 0]), None);
}

#[test]
fn octahedral_cells_decode_to_unit_vectors_on_both_hemispheres_at_every_precision() {
    for bits in 1..=15 {
        let top = (1u32 << bits) - 1;
        let cells = [
            [0, 0],
            [top, top],
            [0, top],
            [top / 2, top / 2],
            [top / 3, top - 1],
        ];
        for q in cells {
            let [x, y, z] = normal_decode(q, bits);
            assert!(
                (x * x + y * y + z * z - 1.0).abs() < 1e-6,
                "{q:?} on {bits}"
            );
        }
        assert!(normal_decode([0, 0], bits)[2] < 0.0);
    }
    assert!(normal_decode([128, 128], 8)[2] > 0.99);
}
