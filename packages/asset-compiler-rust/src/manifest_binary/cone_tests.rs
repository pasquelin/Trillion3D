use super::page::FLAG_CONE;
use super::tests::sample;
use super::*;

const TEMPLATES: Templates = Templates {
    binary: "clusters.bin",
    page: "../../objects/{sha}.bin",
    geometry: "../../objects/{sha}.bin",
    bundle: "../../objects/{sha}.bin",
};

/// The words of page `page` in column `index`, and that page's flag word.
fn page_words(bytes: &[u8], index: usize, page: usize, words: usize) -> (Vec<f64>, u32) {
    let offset = |column: usize| {
        let at = (HEADER_WORDS + column * 2) * 4;
        u32::from_le_bytes(bytes[at..at + 4].try_into().unwrap()) as usize
    };
    let start = offset(index) + page * words * 8;
    let values = (0..words)
        .map(|i| f64::from_le_bytes(bytes[start + i * 8..start + i * 8 + 8].try_into().unwrap()))
        .collect();
    let flags = offset(PAGE_U32) + page * 8 + 4;
    let flags = u32::from_le_bytes(bytes[flags..flags + 4].try_into().unwrap());
    (values, flags)
}

// Behaviour: a cooked cone is written as its four numbers, bit for bit, and flagged; a page
// without one keeps a zeroed slot and no flag, so the reader leaves its cone out.
#[test]
fn a_page_cone_is_written_in_its_column_and_flagged() {
    let mut manifest = sample();
    let axis = [
        -0.0621135613999339,
        0.027174688463389093,
        0.9976990737678042,
    ];
    let angle: f64 = 1.7498532116605978;
    manifest["primitives"][0]["pages"][0]["cone"] = json!({"axis": axis, "angle": angle});
    let (_, bytes) = split(&manifest, &TEMPLATES, &[]).expect("split");
    let (cone, flags) = page_words(&bytes, PAGE_CONE, 0, 4);
    assert_eq!(cone[3].to_bits(), angle.to_bits());
    assert_eq!(cone[..3], axis);
    assert_ne!(flags & FLAG_CONE, 0);
    let (cone, flags) = page_words(&bytes, PAGE_CONE, 1, 4);
    assert_eq!(cone, [0.0; 4]);
    assert_eq!(flags & FLAG_CONE, 0);
}

#[test]
fn a_cone_without_three_axis_numbers_is_refused() {
    let mut manifest = sample();
    manifest["primitives"][0]["pages"][0]["cone"] = json!({"axis": [0.0, 1.0], "angle": 0.5});
    let error = split(&manifest, &TEMPLATES, &[]).unwrap_err();
    assert_eq!(error.code, "INVALID_MANIFEST");
    assert!(
        error.message.contains("page.cone.axis"),
        "{}",
        error.message
    );
}
