//! Les charges Basis Universal d'un KTX 2.0 — ETC1S sous supercompression BasisLZ, UASTC LDR
//! 4 × 4 — transcodées vers RGBA8 par la crate `basisu` 0.1.0 (Apache-2.0, `marcogomez/basisu`),
//! un portage Rust pur du transcodeur de référence de Binomial, vérifié octet pour octet contre lui.
//!
//! Un tel conteneur écrit `VK_FORMAT_UNDEFINED` et décrit sa charge dans son descripteur de format :
//! c'est le transcodeur qui relit ce descripteur, pas ce pilote. Le pilote lui a déjà refusé les
//! cubes, les tableaux et les volumes ; ce qu'il refuse ici, en plus, ressort sous un seul nom —
//! codec hors de la liste du transcodeur, vidéo à état d'une trame à l'autre, flux corrompu.
//!
//! La cible est RGBA8 et rien d'autre. Garder les blocs compressés jusqu'au GPU est un autre
//! chantier, qui demandera une variante de plus au contrat `DecodedImage` ; il ne commence pas ici.
use super::header::Surface;
use super::{DecodedImage, DATA_TRUNCATED, TOO_LARGE, TRANSCODE_FAILED};
use crate::plugins::image::blocks as shared;
use basisu::{DecodeFlags, TargetFormat, Transcoder};

pub(super) fn decode(
    surface: &Surface,
    bytes: &[u8],
    max_alloc: u64,
) -> std::result::Result<DecodedImage, &'static str> {
    if u64::from(surface.width)
        .saturating_mul(u64::from(surface.height))
        .saturating_mul(4)
        > max_alloc
    {
        return Err(TOO_LARGE);
    }
    let texture = Transcoder::new(bytes).map_err(|_| TRANSCODE_FAILED)?;
    // Seul le niveau 0 est consommé, comme partout dans ce pilote : c'est l'image de base, celle
    // que l'index des niveaux donne en premier.
    let rgba = texture
        .transcode(0, TargetFormat::Rgba32, DecodeFlags::NONE)
        .map_err(|_| TRANSCODE_FAILED)?;
    shared::image(surface.width, surface.height, rgba, DATA_TRUNCATED)
}
