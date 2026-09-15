use super::*;

// Lot B2 : vector_into écrit les nombres droit dans la colonne, sans Vec<f64> intermédiaire, et ne
// construit le nom d'une entrée que lorsqu'elle est fautive. Les octets produits sont inchangés.

#[test]
fn vector_into_writes_the_same_bytes_as_a_manual_concatenation_including_hostile_floats() {
    // NaN et les infinis n'ont pas de représentation JSON : le JSON n'en porte jamais, seul -0.0
    // et les bornes de f64 traversent le format. Vérifiés au bit près, -0.0 compris.
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
    // Un nombre non fini (NaN, Infinity) n'a pas de forme JSON : serde_json le sérialise en
    // `null`, que vector_into doit refuser comme n'importe quelle entrée qui n'est pas un nombre.
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
        "le message doit nommer l'entrée fautive : {}",
        error.message
    );
    // La première valeur, valide, est déjà écrite : la fonction s'arrête à la première faute.
    assert_eq!(column.bytes, 1.0f64.to_le_bytes());
}
