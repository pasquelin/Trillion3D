//! The gates of a page's header: the words read and every bound refused in one order, before any
//! stream is read. `Header::parse` gates the page on disk (`disk.rs`); the resident page's gate, which
//! the tests alone read it by, is `resident.rs`'s.

use crate::attributes::UV_FLAGS;
use crate::bits::{self, ColorRange, PositionGrid, UvRange};
use crate::{
    deform, Header, PageError, FLAGS_ALL, FLAG_NORMAL, FLAG_SKIN, FLAG_SOFT_SOURCE, FLAG_TANGENT,
    HEADER_BYTES, HEADER_UV_SETS, HEADER_WORDS, MAGIC, MAX_NORMAL_PRECISION, MAX_TANGENT_PRECISION,
    MAX_UV_SETS,
};

impl Header {
    /// The page on disk, gated: its header within the format's bounds, its length what the counts
    /// make, every field it stores read back (`disk::read_raw`), the vertices it names not yet
    /// found.
    pub fn parse(data: &[u8], max_decoded_bytes: usize) -> Result<Self, PageError> {
        crate::disk::read_raw(data, max_decoded_bytes).map(|raw| raw.header)
    }

    /// The header words of `data` read under `version`, the records they pack and the deformation
    /// records after them; no count of the page is bounded here, each form bounds its own.
    pub(crate) fn read_words(data: &[u8], version: u32) -> Result<Self, PageError> {
        if data.len() < HEADER_BYTES {
            return Err(PageError::Header);
        }
        let mut w = [0u32; HEADER_WORDS];
        for (word, value) in w.iter_mut().zip(bits::le_words(&data[..HEADER_BYTES])) {
            *word = value;
        }
        if w[0] != MAGIC || w[1] != version {
            return Err(PageError::Version);
        }
        let start = [w[6], w[7], w[8]].map(|cell| cell as i32);
        let records = (
            PositionGrid::unpack(w[5], start),
            ColorRange::unpack(w[17], w[18] & 0xffff),
        );
        let (Some(position), Some(color)) = records else {
            return Err(PageError::Bounds);
        };
        let mut uv = [UvRange::default(); MAX_UV_SETS];
        for (set, range) in uv.iter_mut().take(HEADER_UV_SETS).enumerate() {
            let Some(read) = UvRange::unpack([w[9 + 2 * set], w[10 + 2 * set]]) else {
                return Err(PageError::Bounds);
            };
            *range = read;
        }
        let Some((skin, morphs)) = deform::parse(w[4], w[21], data) else {
            return Err(PageError::Bounds);
        };
        if w[18] >> 24 != 0 {
            return Err(PageError::Bounds);
        }
        let mut extension = bits::le_words(
            data.get(HEADER_BYTES + morphs.len() * deform::MORPH_WORDS * 4..)
                .unwrap_or_default(),
        );
        for set in (HEADER_UV_SETS..MAX_UV_SETS).filter(|&set| w[4] & UV_FLAGS[set] != 0) {
            let words = [extension.next(), extension.next()];
            let Some(read) = words[0]
                .zip(words[1])
                .and_then(|(a, b)| UvRange::unpack([a, b]))
            else {
                return Err(PageError::Bounds);
            };
            uv[set] = read;
        }
        Ok(Self {
            vertex_count: w[2] as usize,
            index_count: w[3] as usize,
            flags: w[4],
            position,
            uv,
            color,
            normal_precision: (w[18] >> 16) & 15,
            tangent_precision: (w[18] >> 20) & 15,
            corner_bits: w[19] as usize,
            position_count: w[20] as usize,
            skin,
            morphs,
        })
    }

    /// Whether the flags and the precisions are within the format's bounds, whatever the counts.
    pub(crate) fn fields_sane(&self) -> bool {
        self.flags & !FLAGS_ALL == 0
            && (self.flags & FLAG_SOFT_SOURCE == 0 || self.flags & FLAG_SKIN != 0)
            && (self.flags & FLAG_TANGENT == 0 || self.flags & FLAG_NORMAL != 0)
            && (1..=MAX_NORMAL_PRECISION).contains(&self.normal_precision)
            && self.tangent_precision <= MAX_TANGENT_PRECISION
    }
}
