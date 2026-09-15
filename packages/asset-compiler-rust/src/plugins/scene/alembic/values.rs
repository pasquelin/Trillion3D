//! Les octets d'un échantillon lus comme des nombres, en petit-boutiste comme le format l'écrit.
//!
//! Un bloc dont la longueur n'est pas un multiple de la taille de l'élément est tronqué : les
//! octets de queue sont laissés, ce qui rend un tableau plus court que ce que la géométrie demande.
//! C'est l'appelant qui refuse alors, en nommant ce qui manquait — jamais une lecture hors bornes.

/// Les éléments d'un bloc, chacun lu sur `N` octets.
fn values<const N: usize, T>(bytes: &[u8], from: fn([u8; N]) -> T) -> Vec<T> {
    bytes.as_chunks::<N>().0.iter().copied().map(from).collect()
}

pub(super) fn f32s(bytes: &[u8]) -> Vec<f32> {
    values(bytes, f32::from_le_bytes)
}

pub(super) fn f64s(bytes: &[u8]) -> Vec<f64> {
    values(bytes, f64::from_le_bytes)
}

pub(super) fn i32s(bytes: &[u8]) -> Vec<i32> {
    values(bytes, i32::from_le_bytes)
}

pub(super) fn u32s(bytes: &[u8]) -> Vec<u32> {
    values(bytes, u32::from_le_bytes)
}
