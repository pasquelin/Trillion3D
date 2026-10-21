use crate::compiler::accessor::codes::{
    index_bytes_of, BYTE, FLOAT, INDEX_COMPONENTS, SHORT, UNSIGNED_BYTE, UNSIGNED_INT,
    UNSIGNED_SHORT,
};
use crate::*;

impl Accessor<'_> {
    /// Every element's bytes, `width × bytes` from `base + i·stride`, tightly packed or
    /// interleaved: the one walk the collectors and the content digest read. Its range is the one
    /// `accessor_validation::layout` checked, now or in the pass that validated the accessor.
    pub(crate) fn elements(&self) -> impl Iterator<Item = &[u8]> + '_ {
        let element = self.width * self.bytes;
        (0..self.count).map(move |i| &self.bin[self.base + i * self.stride..][..element])
    }
    /// Every sparse substitution in order: the element it replaces and its `width × bytes` value
    /// bytes. The one walk of the sparse indices and values the collectors read.
    fn substitutions(&self) -> impl Iterator<Item = Result<(usize, &[u8])>> + '_ {
        let element = self.width * self.bytes;
        self.sparse.iter().flat_map(move |sparse| {
            (0..sparse.count).map(move |k| {
                let component = sparse.indices_component;
                let width = index_bytes_of(component)
                    .ok_or_else(|| invalid("Unsupported sparse indices component"))?;
                let at = sparse.indices_offset + k * width;
                let index = self
                    .bin
                    .get(at..at + width)
                    .and_then(|bytes| index_value(component, bytes))
                    .ok_or_else(|| invalid("Sparse index out of bounds"))?
                    as usize;
                if index >= self.count {
                    return Err(CompilerError::new(
                        "INDEX_OUT_OF_BOUNDS",
                        "Sparse index exceeds count",
                    ));
                }
                let at = sparse.values_offset + k * element;
                let value = self
                    .bin
                    .get(at..at + element)
                    .ok_or_else(|| invalid("Sparse value out of bounds"))?;
                Ok((index, value))
            })
        })
    }
    pub(crate) fn decoded_value(&self, b: &[u8]) -> Result<f64> {
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
    pub(crate) fn collect_u32(&self) -> Result<Vec<u32>> {
        if self.normalized || !INDEX_COMPONENTS.contains(&self.component) {
            return Err(invalid("Indices require an unsigned integer accessor"));
        }
        // An index accessor is SCALAR: `index_value` reads the element's one component.
        let value = |bytes| {
            index_value(self.component, bytes).ok_or_else(|| invalid("Unsupported component"))
        };
        let mut out = reserve(self.count)?;
        if !self.has_buffer_view {
            out.resize(self.count, 0);
        } else {
            for element in self.elements() {
                out.push(value(element)?);
            }
        }
        for substitution in self.substitutions() {
            let (index, element) = substitution?;
            out[index] = value(element)?;
        }
        Ok(out)
    }
    pub(crate) fn collect_f32(&self) -> Result<Vec<f32>> {
        let n = self
            .count
            .checked_mul(self.width)
            .ok_or_else(|| invalid("Accessor offset overflow"))?;
        let finite = |component| -> Result<f32> {
            let value = self.decoded_value(component)? as f32;
            if !value.is_finite() {
                return Err(CompilerError::new(
                    "NONFINITE_POSITION",
                    "Position is not finite",
                ));
            }
            Ok(value)
        };
        let mut out = reserve(n)?;
        if !self.has_buffer_view {
            out.resize(n, 0.0);
        } else {
            for element in self.elements() {
                for component in element.chunks_exact(self.bytes) {
                    out.push(finite(component)?);
                }
            }
        }
        for substitution in self.substitutions() {
            let (index, element) = substitution?;
            for (c, component) in element.chunks_exact(self.bytes).enumerate() {
                out[index * self.width + c] = finite(component)?;
            }
        }
        Ok(out)
    }
}
