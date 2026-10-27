//! The file of a light profile (`light-profile-<hash>.bin`), little-endian.
//!
//! Five words, then the texels. The words: the magic `T3IE` (`0x45493354`), the version, the
//! texture's width and height in texels, and the profile's brightness in candelas as the bits of an
//! `f32`. The texels follow, `width × height` half-floats, one channel, row after row (a row is a
//! horizontal angle, a column a vertical one, `grid.rs`), the candela over the greatest of the file.
//! The reader is `packages/sdk-browser/src/lighting/lightProfile/profileFile.ts`.
use super::{Photometry, SIDE};

pub(super) const MAGIC: u32 = 0x4549_3354;
pub(super) const VERSION: u32 = 1;
/// Bytes of the five words before the texels.
pub(super) const HEADER_BYTES: usize = 20;

/// The bytes of the profile of `photometry`.
pub(super) fn encode(photometry: &Photometry) -> Vec<u8> {
    let mut bytes = Vec::with_capacity(HEADER_BYTES + 2 * SIDE * SIDE);
    for word in [
        MAGIC,
        VERSION,
        SIDE as u32,
        SIDE as u32,
        photometry.brightness().to_bits(),
    ] {
        bytes.extend_from_slice(&word.to_le_bytes());
    }
    for texel in photometry.texture() {
        bytes.extend_from_slice(&texel.to_le_bytes());
    }
    bytes
}

/// The name of the file whose bytes are `bytes`: the head of their fingerprint, so that two scenes
/// naming the same profile share one product and a changed file is a new one.
pub(super) fn file_name(bytes: &[u8]) -> String {
    format!("light-profile-{}.bin", &crate::hash(bytes)[..16])
}
