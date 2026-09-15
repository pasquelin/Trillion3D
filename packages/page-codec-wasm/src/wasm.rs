//! ABI brute du module WebAssembly : pas de `wasm-bindgen`, rien que des entiers et des offsets
//! dans la mémoire linéaire. Le chargeur JavaScript écrit la page à l'offset rendu par `page_alloc`,
//! appelle `page_decode`, lit le bloc de résultat, puis rend tout avec `page_release`.

use crate::{decode, OPTIONAL};

/// Le bloc de résultat, en mots de 32 bits :
/// 0 état (0 = décodée), 1 sommets, 2 indices, 3 drapeaux, 4 octets décompressés,
/// 5 offset des indices, 6 offset des positions, 7 à 11 offsets des attributs facultatifs (0 = absent).
const RESULT_WORDS: usize = 12;

fn fuite<T>(valeurs: Vec<T>) -> u32 {
    let boite = valeurs.into_boxed_slice();
    Box::into_raw(boite) as *mut T as u32
}

/// Rend une allocation faite par `fuite` : la capacité d'une boîte tranchée vaut sa longueur.
unsafe fn rends<T>(offset: u32, len: usize) {
    if offset != 0 {
        drop(Vec::from_raw_parts(offset as *mut T, len, len));
    }
}

/// Réserve `len` octets pour la page compressée. Rend 0 si la taille est absurde.
#[no_mangle]
pub extern "C" fn page_alloc(len: usize) -> u32 {
    if len == 0 || len > 1 << 30 {
        return 0;
    }
    fuite(vec![0u8; len])
}

/// Rend une réservation de `page_alloc`.
///
/// # Safety
/// `offset` doit venir de `page_alloc` avec ce même `len`, et n'avoir pas déjà été rendu.
#[no_mangle]
pub unsafe extern "C" fn page_free(offset: u32, len: usize) {
    rends::<u8>(offset, len);
}

/// Décode la page écrite à `offset` et rend l'offset du bloc de résultat, ou 0 si la mémoire manque.
///
/// # Safety
/// `offset` et `len` doivent décrire une réservation vivante de `page_alloc`.
#[no_mangle]
pub unsafe extern "C" fn page_decode(offset: u32, len: usize, max_decoded_bytes: usize) -> u32 {
    let data = core::slice::from_raw_parts(offset as *const u8, len);
    let mut bloc = vec![0u32; RESULT_WORDS];
    match decode(data, max_decoded_bytes) {
        Err(cause) => bloc[0] = cause as u32,
        Ok(page) => {
            bloc[1] = page.vertex_count as u32;
            bloc[2] = page.indices.len() as u32;
            bloc[3] = page.flags;
            bloc[4] = page.decoded_bytes as u32;
            bloc[5] = fuite(page.indices);
            bloc[6] = fuite(page.position);
            for (rang, valeurs) in page.optional.into_iter().enumerate() {
                bloc[7 + rang] = valeurs.map_or(0, fuite);
            }
        }
    }
    fuite(bloc)
}

/// Rend le bloc de résultat et tous les tampons qu'il désigne.
///
/// # Safety
/// `offset` doit venir de `page_decode` et n'avoir pas déjà été rendu.
#[no_mangle]
pub unsafe extern "C" fn page_release(offset: u32) {
    if offset == 0 {
        return;
    }
    let bloc = core::slice::from_raw_parts(offset as *const u32, RESULT_WORDS);
    let vertex_count = bloc[1] as usize;
    rends::<u32>(bloc[5], bloc[2] as usize);
    rends::<f32>(bloc[6], vertex_count * 3);
    for (rang, &(_, size)) in OPTIONAL.iter().enumerate() {
        rends::<f32>(bloc[7 + rang], vertex_count * size);
    }
    rends::<u32>(offset, RESULT_WORDS);
}
