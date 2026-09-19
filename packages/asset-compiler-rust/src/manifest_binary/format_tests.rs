use super::*;

// Lot B2: vector_into writes numbers straight into column, without intermediate Vec<f64>, and
// constructs entry name only when faulty. Produced bytes unchanged.

#[test]
fn vector_into_writes_the_same_bytes_as_a_manual_concatenation_including_hostile_floats() {
    // NaNs and infinities have no JSON representation: JSON never carries them, only -0.0
    // and f64 bounds cross the format. Verified bit-for-bit, including -0.0.
    let values = [-0.0, 0.0, f64::MAX, f64::MIN_POSITIVE, -f64::MAX];
    let array = json!(values.to_vec());
    let mut column = Column::default();
    vector_into(Some(&array), values.len(), "test.values", &mut column).expect("vector_into");
    let mut expected = Vec::new();
    for value in values {
        expected.extend_from_slice(&value.to_le_bytes());
    }
    assert_eq!(column.bytes, expected);
    let negative_zero = f64::from_le_bytes(column.bytes[0..8].try_into().unwrap());
    assert_eq!(negative_zero.to_bits(), (-0.0f64).to_bits());
}

#[test]
fn vector_into_rejects_a_nan_or_infinity_that_a_producer_serialized_as_null() {
    // Non-finite number (NaN, Infinity) has no JSON form: serde_json serializes it as
    // `null`, which vector_into must refuse like any entry that is not a number.
    let array = json!([1.0, serde_json::Value::Null, 3.0]);
    let mut column = Column::default();
    let error = vector_into(Some(&array), 3, "page.sphere", &mut column).unwrap_err();
    assert!(error.message.contains("page.sphere[1]"));
}

#[test]
fn vector_into_reserve_does_not_change_the_bytes_it_writes() {
    let array = json!([1.5, -2.25, 3.0]);
    let mut reserved = Column::default();
    reserved.reserve(1024);
    vector_into(Some(&array), 3, "test.reserved", &mut reserved).expect("vector_into reserved");
    let mut bare = Column::default();
    vector_into(Some(&array), 3, "test.bare", &mut bare).expect("vector_into bare");
    assert_eq!(reserved.bytes, bare.bytes);
}

#[test]
fn vector_into_accepts_an_empty_vector_when_the_expected_length_is_zero() {
    let array = json!([]);
    let mut column = Column::default();
    vector_into(Some(&array), 0, "test.empty", &mut column).expect("vector_into empty");
    assert!(column.bytes.is_empty());
}

#[test]
fn vector_into_rejects_a_wrong_length_without_writing_anything() {
    let array = json!([1.0, 2.0]);
    let mut column = Column::default();
    let error = vector_into(Some(&array), 3, "page.min", &mut column).unwrap_err();
    assert_eq!(error.code, "INVALID_MANIFEST");
    assert!(error.message.contains("page.min"));
    assert!(column.bytes.is_empty());
}

#[test]
fn vector_into_names_only_the_faulty_entry_and_stops_there() {
    let array = json!([1.0, "not a number", 3.0]);
    let mut column = Column::default();
    let error = vector_into(Some(&array), 3, "page.sphere", &mut column).unwrap_err();
    assert!(
        error.message.contains("page.sphere[1]"),
        "the message must name the faulty entry: {}",
        error.message
    );
    // First value, valid, already written: function stops at first fault.
    assert_eq!(column.bytes, 1.0f64.to_le_bytes());
}
