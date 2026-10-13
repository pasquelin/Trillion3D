//! The gate of a page's header (`Header::parse`): its words read, every bound the JavaScript decoder
//! checks refused in the same order, before any stream is read.

use crate::bits::{self, Quant};
use crate::{
    deform, positions, triangles, Header, Layout, PageError, FLAGS_ALL, FLAG_SKIN,
    FLAG_SOFT_SOURCE, HEADER_BYTES, HEADER_WORDS, MAGIC, MAX_VERTICES, VERSION,
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
        let f = f32::from_bits;
        let records = (
            Quant::unpack(w[5], [f(w[6]), f(w[7]), f(w[8])]),
            Quant::unpack(w[9], [f(w[10]), f(w[11])]),
            Quant::unpack(w[12], [f(w[13]), f(w[14])]),
            Quant::unpack(w[15], [f(w[16]), f(w[17]), f(w[18]), f(w[19])]),
        );
        let (Some(position), Some(uv), Some(uv1), Some(color)) = records else {
            return Err(PageError::Bounds);
        };
        let Some((skin, morphs)) = deform::parse(w[4], w[23], data) else {
            return Err(PageError::Bounds);
        };
        let header = Self {
            vertex_count: w[2] as usize,
            index_count: w[3] as usize,
            flags: w[4],
            position,
            uv,
            uv1,
            color,
            quantization_error: f(w[20]),
            corner_bits: w[21] as usize,
            position_count: w[22] as usize,
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
            && header.quantization_error.is_finite()
            && header.quantization_error >= 0.0
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
