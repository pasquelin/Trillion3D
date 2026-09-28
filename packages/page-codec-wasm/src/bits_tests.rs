//! Bit fields, the sequential reader, the step and the octahedral normals.

use super::*;

#[test]
fn a_field_crosses_a_word_boundary_and_a_zero_width_field_reads_zero() {
    let words = [0xF000_0000u32, 0x0000_00AB];
    assert_eq!(field(&words, 28, 12), 0xABF);
    assert_eq!(field(&words, 28, 0), 0);
    assert_eq!(field(&words, 32, 8), 0xAB);
    assert_eq!(bits_for(0), 0);
    assert_eq!(bits_for(255), 8);
    assert_eq!(bits_for(256), 9);
    assert_eq!(stream_words(3, 24), 3);
}

#[test]
fn the_sequential_reader_reads_each_field_where_field_finds_it() {
    let words: Vec<u32> = (1..=40u32).map(|i| i.wrapping_mul(0x9E37_79B9)).collect();
    for bits in 0..=MAX_BITS {
        for start in [0, 5, 31, 32] {
            let mut stream = BitReader::at(&words, start);
            for i in 0..(words.len() * 32 - 32 - start) / bits.max(1) as usize {
                assert_eq!(
                    stream.read(bits),
                    field(&words, start + i * bits as usize, bits)
                );
            }
        }
    }
}

#[test]
fn the_step_is_exact_and_the_record_survives_its_word() {
    assert_eq!(pow2(-16), 1.0 / 65536.0);
    assert_eq!(pow2(3), 8.0);
    let record = Quant {
        min: [1.5, -2.0, 0.0],
        exponent: -20,
        bits: [17, 0, 24],
    };
    assert_eq!(Quant::unpack(record.packed(), record.min), Some(record));
    assert_eq!(Quant::<3>::unpack(25, record.min), None);
    assert_eq!(Quant::<3>::unpack(1 << 18, record.min), None);
    assert_eq!(
        Quant::<3>::unpack(record.packed(), [f32::NAN, 0.0, 0.0]),
        None
    );
    assert_eq!(dequant(1.5, 3, 0.25), 2.25);
}

#[test]
fn octahedral_bytes_decode_to_unit_vectors_on_both_hemispheres() {
    for q in [0u32, 255, 255 << 8, 0xFFFF, 128 | (128 << 8), 0x40C0] {
        let [x, y, z] = oct_decode(q);
        assert!((x * x + y * y + z * z - 1.0).abs() < 1e-6, "{q}");
    }
    assert!(oct_decode(0)[2] < 0.0);
    assert!(oct_decode(128 | (128 << 8))[2] > 0.99);
}
