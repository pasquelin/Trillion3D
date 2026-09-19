//! Chunks of a PNG, walked from end to end according to the structure the W3C / ISO-IEC
//! 15948 specification fixes: after the eight signature bytes, each chunk carries its length
//! over four bytes, its type over four, its data, then its CRC over four.
//!
//! This module decodes no pixel: it returns the type and data of each chunk, so that the
//! driver reads what the file **declares** — an animation, a colour profile — where the pixel
//! decoder, itself, only looks at the default image. Length is judged against what remains of
//! the file: a cut file stops the walk, it never reads beside it.

/// The eight signature bytes, which the walk skips before the first chunk.
const SIGNATURE: usize = 8;
/// Header of a chunk: four length bytes, four of type.
const CHUNK_HEADER: usize = 8;
/// CRC-32 that closes a chunk. It is not checked here: that is the pixel decoder's job, which
/// refuses the whole file when it does not match.
const CRC: usize = 4;

/// Cursor that advances from one chunk to the next.
pub(super) struct Chunks<'a> {
    rest: &'a [u8],
}

/// Chunks of this file, from the first — always the IHDR — to the last that fits whole.
pub(super) fn of(bytes: &[u8]) -> Chunks<'_> {
    Chunks {
        rest: bytes.get(SIGNATURE..).unwrap_or_default(),
    }
}

impl<'a> Iterator for Chunks<'a> {
    /// Chunk type over four bytes, and its data.
    type Item = (&'a [u8], &'a [u8]);

    fn next(&mut self) -> Option<Self::Item> {
        let head = self.rest.get(..CHUNK_HEADER)?;
        let length =
            usize::try_from(u32::from_be_bytes([head[0], head[1], head[2], head[3]])).ok()?;
        let end = CHUNK_HEADER.checked_add(length)?;
        let data = self.rest.get(CHUNK_HEADER..end)?;
        let kind = &self.rest[4..CHUNK_HEADER];
        self.rest = self.rest.get(end + CRC..).unwrap_or_default();
        Some((kind, data))
    }
}
