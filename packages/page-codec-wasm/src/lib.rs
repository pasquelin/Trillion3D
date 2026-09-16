//! Décodeur d'une page de géométrie `.wgpg`, miroir exact de `packages/sdk-browser/geometryPage.ts`.
//!
//! Le même code sert deux hôtes : le compilateur natif, qui s'en sert pour prouver que ce qu'il
//! encode se relit à l'identique, et le module `wasm32-unknown-unknown` chargé par le navigateur.
//! Les refus portent les mêmes causes, dans le même ordre, que le décodeur JavaScript : un octet
//! qui passe ici passe là-bas, un octet qui tombe ici tombe là-bas.
//!
//! Ce module WebAssembly est celui du SDK, et il n'y en a qu'un : une seule compilation
//! (`npm run build:wasm`), une seule ressource livrée, une seule instanciation et une seule mémoire
//! linéaire côté navigateur. À côté du décodeur de pages, il porte donc les noyaux de calcul en lot
//! du socle mathématique (`math.rs`, ABI dans `wasm_math.rs`) et le tampon qu'ils partagent avec
//! JavaScript. Un second module aurait voulu un second pipeline de compilation, un second
//! chargement et une seconde mémoire, sans rien rendre de plus.

mod attributes;
pub mod math;
#[cfg(target_arch = "wasm32")]
mod wasm;
#[cfg(target_arch = "wasm32")]
mod wasm_math;

pub use attributes::{DecodedPage, OPTIONAL};

pub const MAGIC: u32 = 0x3250_4757;
pub const VERSION: u32 = 2;
pub const STRIDE: usize = 72;

/// Les causes de refus, dans l'ordre où le décodeur JavaScript les lève. Les valeurs numériques
/// traversent l'ABI WebAssembly : le chargeur JS les retraduit en messages `GEOMETRY_PAGE_*`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u32)]
pub enum PageError {
    Header = 1,
    Version = 2,
    Bounds = 3,
    Index = 4,
    Nonfinite = 5,
    Meshopt = 6,
}

/// Un sommet entrelacé tel que meshopt le rend : `STRIDE` octets, sans interprétation.
#[derive(Clone, Copy)]
pub(crate) struct Vertex(pub [u8; STRIDE]);
impl Default for Vertex {
    fn default() -> Self {
        Self([0; STRIDE])
    }
}

/// L'en-tête d'une page, une fois ses huit mots lus et toutes ses bornes acceptées.
struct Header {
    vertex_count: usize,
    index_count: usize,
    flags: u32,
    index_bytes: usize,
    decoded_bytes: usize,
}

fn word(data: &[u8], at: usize) -> u32 {
    u32::from_le_bytes([data[at], data[at + 1], data[at + 2], data[at + 3]])
}

/// Les huit mots de l'en-tête et les bornes du décodeur JS, refusées dans le même ordre.
fn header(data: &[u8], max_decoded_bytes: usize) -> Result<Header, PageError> {
    if data.len() < 32 {
        return Err(PageError::Header);
    }
    if word(data, 0) != MAGIC || word(data, 4) != VERSION {
        return Err(PageError::Version);
    }
    let vertex_count = word(data, 8) as usize;
    let index_count = word(data, 12) as usize;
    let flags = word(data, 16);
    let stride = word(data, 20) as usize;
    let index_bytes = word(data, 24) as usize;
    let vertex_bytes = word(data, 28) as usize;
    let decoded_bytes = vertex_count * stride + index_count * 2;
    if vertex_count == 0
        || vertex_count > 65535
        || index_count == 0
        || !index_count.is_multiple_of(3)
        || flags & !31 != 0
        || stride != STRIDE
        || decoded_bytes > max_decoded_bytes
        || 32usize
            .saturating_add(index_bytes)
            .saturating_add(vertex_bytes)
            != data.len()
    {
        return Err(PageError::Bounds);
    }
    Ok(Header {
        vertex_count,
        index_count,
        flags,
        index_bytes,
        decoded_bytes,
    })
}

/// Une page complète, décompressée puis désentrelacée : mêmes tampons que `decodeGeometryPage`.
pub fn decode(data: &[u8], max_decoded_bytes: usize) -> Result<DecodedPage, PageError> {
    let head = header(data, max_decoded_bytes)?;
    let compressed_indices = &data[32..32 + head.index_bytes];
    let local: Vec<u16> = meshopt::decode_index_buffer(compressed_indices, head.index_count)
        .map_err(|_| PageError::Meshopt)?;
    let vertices: Vec<Vertex> =
        meshopt::decode_vertex_buffer(&data[32 + head.index_bytes..], head.vertex_count)
            .map_err(|_| PageError::Meshopt)?;
    let mut page = attributes::split(&local, &vertices, head.vertex_count, head.flags)?;
    page.decoded_bytes = head.decoded_bytes;
    Ok(page)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn page() -> Vec<u8> {
        let mut out = Vec::new();
        for word in [MAGIC, VERSION, 3, 6, 0, STRIDE as u32, 0, 0] {
            out.extend_from_slice(&word.to_le_bytes());
        }
        out
    }

    #[test]
    fn en_tete_trop_court_puis_magie_puis_bornes() {
        assert_eq!(decode(&[0u8; 8], 1 << 24).unwrap_err(), PageError::Header);
        let mut faux = page();
        faux[0] ^= 1;
        assert_eq!(decode(&faux, 1 << 24).unwrap_err(), PageError::Version);
        assert_eq!(decode(&page(), 1 << 24).unwrap_err(), PageError::Bounds);
    }

    #[test]
    fn budget_de_decompression_refuse_avant_toute_decompression() {
        assert_eq!(decode(&page(), 8).unwrap_err(), PageError::Bounds);
    }
}
