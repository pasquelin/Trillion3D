//! The gate of a page's header (`Header::parse`): its words read, every bound the JavaScript decoder
//! checks refused in the same order, before any stream is read.

use crate::bits::{self, ColorRange, PositionGrid, UvRange};
use crate::{
    deform, positions, triangles, Header, Layout, PageError, FLAGS_ALL, FLAG_NORMAL, FLAG_SKIN,
    FLAG_SOFT_SOURCE, FLAG_TANGENT, HEADER_BYTES, HEADER_WORDS, MAGIC, MAX_NORMAL_PRECISION,
    MAX_TANGENT_PRECISION, MAX_UV_SETS, MAX_VERTICES, VERSION,
};

impl Header {
    /// The header words and the JS decoder's bounds, refused in the same order; the byte
    /// length must be exactly what the streams need and the decoded page under the budget.
    pub fn parse(data: &[u8], max_decoded_bytes: usize) -> Result<Self, PageError> {
        if data.len() < HEADER_BYTES {
            return Err(PageError::Header);
        }
        let mut w = [0u32; HEADER_WORDS];
        for (word, value) in w.iter_mut().zip(bits::le_words(&data[..HEADER_BYTES])) {
            *word = value;
        }
        if w[0] != MAGIC || w[1] != VERSION {
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
        for (set, range) in uv.iter_mut().enumerate() {
            let Some(read) = UvRange::unpack([w[9 + 2 * set], w[10 + 2 * set]]) else {
                return Err(PageError::Bounds);
            };
            *range = read;
        }
        let Some((skin, morphs)) = deform::parse(w[4], w[21], data) else {
            return Err(PageError::Bounds);
        };
        let header = Self {
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
        };
        let layout = Layout::of(&header);
        let (table, v, n) = (layout.triangles[1] * 4, w[2] as usize, w[3] as usize);
        let sane = (1..=MAX_VERTICES).contains(&header.vertex_count)
            && (1..=header.vertex_count).contains(&header.position_count)
            && (3..=max_decoded_bytes / 4).contains(&header.index_count)
            && header.index_count.is_multiple_of(3)
            && header.corner_bits <= header.index_count.saturating_mul(triangles::MAX_WIDTH)
            && header.flags & !FLAGS_ALL == 0
            && (header.flags & FLAG_SOFT_SOURCE == 0 || header.flags & FLAG_SKIN != 0)
            && (header.flags & FLAG_TANGENT == 0 || header.flags & FLAG_NORMAL != 0)
            && w[18] >> 24 == 0
            && (1..=MAX_NORMAL_PRECISION).contains(&header.normal_precision)
            && header.tangent_precision <= MAX_TANGENT_PRECISION
            && header.decoded_bytes() <= max_decoded_bytes
            && layout.bytes() == data.len()
            && layout.morphs_at(&header)
            && deform::finite(&data[header.bytes()..], &header, &layout)
            && layout.corners.fits(&data[header.bytes()..][..table], v, n)
            && positions::links_fit(&data[header.bytes()..], &layout, &header);
        if !sane {
            return Err(PageError::Bounds);
        }
        Ok(header)
    }
}
