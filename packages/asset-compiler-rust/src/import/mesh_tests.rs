use super::*;

// Lot B4 : index_bytes part d'un tampon dimensionné d'avance au lieu d'un `flat_map(...).collect()`
// qui le redécouvre morceau par morceau. Mêmes octets, au bit près, des deux côtés de la limite
// u16/u32, et sur une liste d'indices vide.

#[test]
fn index_bytes_is_empty_for_an_empty_index_list() {
    let (bytes, component) = index_bytes(&[], 0);
    assert!(bytes.is_empty());
    assert_eq!(component, 5123);
}

#[test]
fn index_bytes_encodes_u16_at_and_below_the_boundary() {
    let indices = [0u32, 1, 65_535];
    let (bytes, component) = index_bytes(&indices, 65_535);
    assert_eq!(component, 5123, "65 535 sommets tiennent encore en 16 bits");
    let mut expected = Vec::new();
    for i in indices {
        expected.extend_from_slice(&(i as u16).to_le_bytes());
    }
    assert_eq!(bytes, expected);
}

#[test]
fn index_bytes_encodes_u32_just_above_the_boundary() {
    let indices = [0u32, 1, 65_536];
    let (bytes, component) = index_bytes(&indices, 65_536);
    assert_eq!(
        component, 5125,
        "65 536 sommets dépassent la limite 16 bits"
    );
    let mut expected = Vec::new();
    for i in indices {
        expected.extend_from_slice(&i.to_le_bytes());
    }
    assert_eq!(bytes, expected);
}
