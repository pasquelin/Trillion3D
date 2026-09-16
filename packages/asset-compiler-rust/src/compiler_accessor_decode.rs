use super::*;

impl Accessor<'_> {
    pub(super) fn bytes_at(&self, i: usize, c: usize) -> Result<&[u8]> {
        if i >= self.count || c >= self.width {
            return Err(CompilerError::new(
                "INDEX_OUT_OF_BOUNDS",
                "Accessor element is out of bounds",
            ));
        }
        if !self.has_buffer_view {
            return Ok(&[0u8; 4][..self.bytes]);
        }
        let o = self
            .base
            .checked_add(
                i.checked_mul(self.stride)
                    .ok_or_else(|| invalid("Accessor offset overflow"))?,
            )
            .and_then(|value| value.checked_add(c * self.bytes))
            .ok_or_else(|| invalid("Accessor offset overflow"))?;
        self.bin.get(o..o + self.bytes).ok_or_else(|| {
            CompilerError::new("BUFFER_OUT_OF_BOUNDS", "Accessor exceeds binary buffer")
        })
    }
    pub(super) fn decoded_value(&self, b: &[u8]) -> Result<f64> {
        let raw = match self.component {
            5120 => (b[0] as i8) as f64,
            5121 => b[0] as f64,
            5122 => i16::from_le_bytes([b[0], b[1]]) as f64,
            5123 => u16::from_le_bytes([b[0], b[1]]) as f64,
            5125 => u32::from_le_bytes([b[0], b[1], b[2], b[3]]) as f64,
            5126 => f32::from_le_bytes([b[0], b[1], b[2], b[3]]) as f64,
            _ => return Err(invalid("Unsupported component")),
        };
        if !self.normalized {
            return Ok(raw);
        }
        Ok(match self.component {
            5120 => (raw / 127.).max(-1.),
            5121 => raw / 255.,
            5122 => (raw / 32767.).max(-1.),
            5123 => raw / 65535.,
            5125 => raw / 4294967295.,
            _ => return Err(invalid("Unsupported normalized component")),
        })
    }
    pub(super) fn value(&self, i: usize, c: usize) -> Result<f64> {
        self.decoded_value(self.bytes_at(i, c)?)
    }
    pub(super) fn u32_at(&self, i: usize) -> Result<u32> {
        let b = self.bytes_at(i, 0)?;
        match self.component {
            5121 => Ok(b[0] as u32),
            5123 => Ok(u16::from_le_bytes([b[0], b[1]]) as u32),
            5125 => Ok(u32::from_le_bytes([b[0], b[1], b[2], b[3]])),
            5126 => {
                let value = f32::from_le_bytes([b[0], b[1], b[2], b[3]]);
                if !value.is_finite()
                    || value.fract() != 0.
                    || value < 0.
                    || value > u32::MAX as f32
                {
                    return Err(invalid("Index is not an unsigned 32-bit integer"));
                }
                Ok(value as u32)
            }
            _ => Err(invalid("Unsupported component")),
        }
    }
    pub(super) fn f32_at(&self, i: usize, c: usize) -> Result<f32> {
        let value = self.value(i, c)? as f32;
        if !value.is_finite() {
            return Err(CompilerError::new(
                "NONFINITE_POSITION",
                "Position is not finite",
            ));
        }
        Ok(value)
    }
    pub(super) fn collect_u32(&self) -> Result<Vec<u32>> {
        if self.normalized || !matches!(self.component, 5121 | 5123 | 5125) {
            return Err(invalid("Indices require an unsigned integer accessor"));
        }
        let mut out = reserve(self.count)?;
        if !self.has_buffer_view {
            out.resize(self.count, 0);
        } else if self.width == 1 && self.stride == self.bytes && self.component != 5126 {
            let nbytes = self
                .count
                .checked_mul(self.bytes)
                .ok_or_else(|| invalid("Accessor offset overflow"))?;
            let end = self
                .base
                .checked_add(nbytes)
                .ok_or_else(|| invalid("Accessor offset overflow"))?;
            let slice = self.bin.get(self.base..end).ok_or_else(|| {
                CompilerError::new("BUFFER_OUT_OF_BOUNDS", "Accessor exceeds binary buffer")
            })?;
            match self.component {
                5121 => out.extend(slice.iter().map(|&b| b as u32)),
                5123 => {
                    for chunk in slice.as_chunks::<2>().0 {
                        out.push(u16::from_le_bytes([chunk[0], chunk[1]]) as u32);
                    }
                }
                5125 => {
                    for chunk in slice.as_chunks::<4>().0 {
                        out.push(u32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]));
                    }
                }
                _ => {}
            }
        } else {
            for i in 0..self.count {
                out.push(self.u32_at(i)?);
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
                let val = match self.component {
                    5121 => b[0] as u32,
                    5123 => u16::from_le_bytes([b[0], b[1]]) as u32,
                    5125 => u32::from_le_bytes([b[0], b[1], b[2], b[3]]),
                    _ => return Err(invalid("Unsupported component")),
                };
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
        } else if self.component == 5126 && self.stride == self.width * self.bytes {
            let nbytes = n
                .checked_mul(4)
                .ok_or_else(|| invalid("Accessor offset overflow"))?;
            let end = self
                .base
                .checked_add(nbytes)
                .ok_or_else(|| invalid("Accessor offset overflow"))?;
            let slice = self.bin.get(self.base..end).ok_or_else(|| {
                CompilerError::new("BUFFER_OUT_OF_BOUNDS", "Accessor exceeds binary buffer")
            })?;
            for chunk in slice.as_chunks::<4>().0 {
                let value = f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]);
                if !value.is_finite() {
                    return Err(CompilerError::new(
                        "NONFINITE_POSITION",
                        "Position is not finite",
                    ));
                }
                out.push(value);
            }
        } else {
            for i in 0..self.count {
                for c in 0..self.width {
                    out.push(self.f32_at(i, c)?);
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
