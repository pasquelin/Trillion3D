//! Lire des nombres dans les octets bruts d'un bloc.
//!
//! Un bloc de données de Blender n'est parfois qu'un tableau nu — des positions, des indices de
//! coin, des offsets de face. Ces trois fonctions le relisent sans rien supposer de plus que la
//! largeur d'un élément, et s'arrêtent à ce que le bloc porte réellement.
use super::*;

/// Un entier lu à la largeur et à la signature que le SDNA déclare.
pub(super) fn scalar(field: &Field, bytes: &[u8]) -> Option<i64> {
    if bytes.is_empty() {
        return None;
    }
    let unsigned = matches!(
        field.kind.as_str(),
        "uchar" | "ushort" | "uint" | "uint8_t" | "uint16_t" | "uint32_t" | "uint64_t"
    );
    Some(match (field.unit, unsigned) {
        (1, false) => i64::from(bytes[0] as i8),
        (1, true) => i64::from(bytes[0]),
        (2, false) => i64::from(i16::from_le_bytes(bytes[..2].try_into().ok()?)),
        (2, true) => i64::from(u16::from_le_bytes(bytes[..2].try_into().ok()?)),
        (4, false) => i64::from(i32::from_le_bytes(bytes[..4].try_into().ok()?)),
        (4, true) => i64::from(u32::from_le_bytes(bytes[..4].try_into().ok()?)),
        (8, _) => i64::from_le_bytes(bytes[..8].try_into().ok()?),
        _ => return None,
    })
}

/// Les flottants d'un bloc brut, bornés par ce que le bloc porte.
pub(super) fn floats(bytes: &[u8], count: usize) -> Vec<f32> {
    bytes
        .as_chunks::<4>()
        .0
        .iter()
        .take(count)
        .map(|word| f32::from_le_bytes(*word))
        .collect()
}

/// Les entiers de trente-deux bits d'un bloc brut, bornés de la même façon.
pub(super) fn ints(bytes: &[u8], count: usize) -> Vec<i32> {
    bytes
        .as_chunks::<4>()
        .0
        .iter()
        .take(count)
        .map(|word| i32::from_le_bytes(*word))
        .collect()
}
