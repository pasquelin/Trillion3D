use super::*;
use crate::gltf_codes::{
    BYTE, FLOAT, INDEX_COMPONENTS, SHORT, UNSIGNED_BYTE, UNSIGNED_INT, UNSIGNED_SHORT,
};

impl Accessor<'_> {
    /// Every element's bytes, `width × bytes` from `base + i·stride`, the range checked once:
    /// the one walk the collectors and the content digest read, tightly packed or interleaved.
    pub(super) fn elements(&self) -> Result<impl Iterator<Item = &[u8]> + '_> {
        let element = self.width * self.bytes;
        let end = match self.count.checked_sub(1) {
            None => self.base,
            Some(last) => last
                .checked_mul(self.stride)
                .and_then(|offset| offset.checked_add(self.base))
                .and_then(|offset| offset.checked_add(element))
                .ok_or_else(|| invalid("Accessor offset overflow"))?,
        };
        if end > self.bin.len() {
            return Err(CompilerError::new(
                "BUFFER_OUT_OF_BOUNDS",
                "Accessor exceeds binary buffer",
            ));
        }
        Ok((0..self.count).map(move |i| &self.bin[self.base + i * self.stride..][..element]))
    }
    pub(super) fn decoded_value(&self, b: &[u8]) -> Result<f64> {
        let raw = match self.component {
            BYTE => (b[0] as i8) as f64,
            UNSIGNED_BYTE => b[0] as f64,
            SHORT => i16::from_le_bytes([b[0], b[1]]) as f64,
            UNSIGNED_SHORT => u16::from_le_bytes([b[0], b[1]]) as f64,
            UNSIGNED_INT => u32::from_le_bytes([b[0], b[1], b[2], b[3]]) as f64,
            FLOAT => f32::from_le_bytes([b[0], b[1], b[2], b[3]]) as f64,
            _ => return Err(invalid("Unsupported component")),
        };
        if !self.normalized {
            return Ok(raw);
        }
        Ok(match self.component {
            BYTE => (raw / 127.).max(-1.),
            UNSIGNED_BYTE => trillion3d_math::scalar::byte_to_unit(b[0]),
            SHORT => (raw / 32767.).max(-1.),
            UNSIGNED_SHORT => raw / 65535.,
            UNSIGNED_INT => raw / 4294967295.,
            _ => return Err(invalid("Unsupported normalized component")),
        })
    }
    pub(super) fn collect_u32(&self) -> Result<Vec<u32>> {
        if self.normalized || !INDEX_COMPONENTS.contains(&self.component) {
            return Err(invalid("Indices require an unsigned integer accessor"));
        }
        let mut out = reserve(self.count)?;
        if !self.has_buffer_view {
            out.resize(self.count, 0);
        } else {
            // An index accessor is SCALAR: `index_value` reads the element's one component.
            for element in self.elements()? {
                out.push(
                    index_value(self.component, element)
                        .ok_or_else(|| invalid("Unsupported component"))?,
                );
            }
        }
        if let Some(sparse) = &self.sparse {
            for k in 0..sparse.count {
                let idx = sparse.index(k, self.count)?;
                let vo = sparse.values_offset + k * self.bytes;
                let b = sparse
                    .values_bin
                    .get(vo..vo + self.bytes)
                    .ok_or_else(|| invalid("Sparse value out of bounds"))?;
                let val = index_value(self.component, b)
                    .ok_or_else(|| invalid("Unsupported component"))?;
                out[idx] = val;
            }
        }
        Ok(out)
    }
    pub(super) fn collect_f32(&self) -> Result<Vec<f32>> {
        let n = self
            .count
            .checked_mul(self.width)
            .ok_or_else(|| invalid("Accessor offset overflow"))?;
        let mut out = reserve(n)?;
        if !self.has_buffer_view {
            out.resize(n, 0.0);
        } else {
            for element in self.elements()? {
                for component in element.chunks_exact(self.bytes) {
                    let value = self.decoded_value(component)? as f32;
                    if !value.is_finite() {
                        return Err(CompilerError::new(
                            "NONFINITE_POSITION",
                            "Position is not finite",
                        ));
                    }
                    out.push(value);
                }
            }
        }
        if let Some(sparse) = &self.sparse {
            for k in 0..sparse.count {
                let idx = sparse.index(k, self.count)?;
                for c in 0..self.width {
                    let vo = sparse.values_offset + (k * self.width + c) * self.bytes;
                    let b = sparse
                        .values_bin
                        .get(vo..vo + self.bytes)
                        .ok_or_else(|| invalid("Sparse value out of bounds"))?;
                    let val = self.decoded_value(b)? as f32;
                    if !val.is_finite() {
                        return Err(CompilerError::new(
                            "NONFINITE_POSITION",
                            "Position is not finite",
                        ));
                    }
                    out[idx * self.width + c] = val;
                }
            }
        }
        Ok(out)
    }
}
