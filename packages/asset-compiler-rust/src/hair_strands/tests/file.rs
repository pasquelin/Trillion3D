//! The file a groom is written into.
use super::{groom, groups, row, SHUFFLED};
use crate::hair_strands::abi::{
    HAIR_STRANDS_FLAG_EXTRA_ENDING_POINT, HAIR_STRANDS_GROUP_BYTES, HAIR_STRANDS_GROUP_WORDS,
    HAIR_STRANDS_MAGIC, HAIR_STRANDS_VERSION,
};
use crate::hair_strands::encode::{report, write};
use serde_json::json;
use std::fs;

// Behaviour: the file is a head, a record per group and the tables, in words; the record names the
// counts, the box and the longest curve, and holds no matrix. The points start on a multiple of
// eight bytes.
#[test]
fn the_file_holds_a_head_a_record_per_group_and_the_tables() {
    assert_eq!(HAIR_STRANDS_GROUP_WORDS * 4, HAIR_STRANDS_GROUP_BYTES);
    let built = groups(&groom(&[3], &row(0.0, 3)), true);
    let directory = crate::tests::directories::scratch("hair", "file");
    let product = write(&built, &directory).expect("written");
    let bytes = fs::read(directory.join(product.name)).expect("the file");
    fs::remove_dir_all(&directory).expect("cleanup");
    assert_eq!(product.bytes as usize, bytes.len());
    assert_eq!(
        product.sha256,
        crate::hash(&bytes),
        "fingerprinted as it went by"
    );
    // The head, one record, one curve padded to eight bytes, four points, a seed and a length, each
    // padded to a word.
    assert_eq!(bytes.len(), 16 + 80 + 8 + 4 * 8 + 4 + 4);
    let all: Vec<u32> = bytes
        .chunks_exact(4)
        .map(|word| u32::from_le_bytes([word[0], word[1], word[2], word[3]]))
        .collect();
    assert_eq!(all[..4], [HAIR_STRANDS_MAGIC, HAIR_STRANDS_VERSION, 1, 4]);
    let record = &all[4..4 + HAIR_STRANDS_GROUP_WORDS];
    assert_eq!(
        record[1],
        HAIR_STRANDS_FLAG_EXTRA_ENDING_POINT | SHUFFLED,
        "flags"
    );
    assert_eq!(&record[3..5], [1, 4], "one curve of four points");
    assert_eq!(&record[5..7], [0, 0], "the first curve and the first point");
    assert_eq!(f32::from_bits(record[10]), 2.1, "the longest curve");
    assert_eq!(f32::from_bits(record[11]), 0.01, "the greatest radius");
    assert_eq!(f32::from_bits(record[15]), 2.1, "the high corner's x");
    assert_eq!(
        &record[18..],
        [1, 3],
        "the curves and the points the source declared"
    );
    // The first point's bytes begin at the byte 104 of the file.
    assert_eq!(&bytes[104..106], &built[0].points[..2]);
    let section = report(&built, bytes.len());
    assert_eq!(
        section["groups"],
        json!([{"groupId": 0, "curves": 1, "points": 4, "flags": 24}])
    );
    assert_eq!(section["bytes"], bytes.len());
    assert_eq!(section["groupBytes"], 80);
    // Streamed group after group, the tables are those of the groups laid end to end.
    let mut two = groups(&groom(&[2], &row(0.0, 2)), true);
    two.extend(built);
    let directory = crate::tests::directories::scratch("hair", "two");
    let product = write(&two, &directory).expect("written");
    let bytes = fs::read(directory.join(product.name)).expect("the file");
    fs::remove_dir_all(&directory).expect("cleanup");
    // The head, two records, two curves of three and four points, the points of both, two seeds and
    // two lengths, each padded to a word.
    assert_eq!(bytes.len(), 16 + 2 * 80 + 8 + (3 + 4) * 8 + 4 + 4);
    assert_eq!(bytes.len() as u64, product.bytes);
}
