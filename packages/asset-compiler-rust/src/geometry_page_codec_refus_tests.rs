//! Les refus du décodeur partagé, sur des pages que l'encodeur n'écrirait jamais.

use crate::geometry_page::STRIDE;
use web_geometry_page_codec as codec;

/// Une page bricolée à la main : l'en-tête et les deux flux, sans passer par l'encodeur, pour
/// pouvoir y glisser ce que l'encodeur refuse d'écrire.
fn page_brute(sommets: &[[u8; STRIDE]], locaux: &[u32], declare: u32, flags: u32) -> Vec<u8> {
    let index = meshopt::encode_index_buffer(locaux, sommets.len()).expect("indices");
    let vertex = meshopt::encode_vertex_buffer(sommets).expect("sommets");
    let mut out = Vec::new();
    for word in [
        0x3250_4757u32,
        2,
        declare,
        locaux.len() as u32,
        flags,
        STRIDE as u32,
        index.len() as u32,
        vertex.len() as u32,
    ] {
        out.extend_from_slice(&word.to_le_bytes());
    }
    out.extend_from_slice(&index);
    out.extend_from_slice(&vertex);
    out
}

#[test]
fn le_decodeur_refuse_ce_que_l_encodeur_n_ecrit_jamais() {
    let mut sommets = vec![[0u8; STRIDE]; 3];
    let bonne = page_brute(&sommets, &[0, 1, 2], 3, 0);
    assert!(codec::decode(&bonne, 1 << 20).is_ok());
    assert_eq!(
        codec::decode(&page_brute(&sommets, &[0, 1, 3], 3, 0), 1 << 20).unwrap_err(),
        codec::PageError::Index
    );
    sommets[1][4..8].copy_from_slice(&f32::NAN.to_le_bytes());
    assert_eq!(
        codec::decode(&page_brute(&sommets, &[0, 1, 2], 3, 0), 1 << 20).unwrap_err(),
        codec::PageError::Nonfinite
    );
    sommets[1][4..8].copy_from_slice(&f32::NEG_INFINITY.to_le_bytes());
    assert_eq!(
        codec::decode(&page_brute(&sommets, &[0, 1, 2], 3, 0), 1 << 20).unwrap_err(),
        codec::PageError::Nonfinite
    );
    assert_eq!(
        codec::decode(&bonne[..bonne.len() - 1], 1 << 20).unwrap_err(),
        codec::PageError::Bounds
    );
    assert_eq!(
        codec::decode(&bonne, 8).unwrap_err(),
        codec::PageError::Bounds
    );
}
