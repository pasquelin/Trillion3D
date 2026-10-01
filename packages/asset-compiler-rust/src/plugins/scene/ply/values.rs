//! Scalar decoding rejects out-of-range ASCII integers and short binary records alike.
use super::*;
use header::Format;
pub(super) struct Reader<'a> {
    bytes: &'a [u8],
    at: usize,
    format: Format,
    words: Option<std::str::SplitWhitespace<'a>>,
}
impl<'a> Reader<'a> {
    pub(super) fn new(bytes: &'a [u8], format: Format) -> Result<Self> {
        let words = if matches!(format, Format::Ascii) {
            Some(
                std::str::from_utf8(bytes)
                    .map_err(|_| source::invalid("ply", "ASCII data is not UTF-8"))?
                    .split_whitespace(),
            )
        } else {
            None
        };
        Ok(Self {
            bytes,
            at: 0,
            format,
            words,
        })
    }
    fn take<const N: usize>(&mut self) -> Result<[u8; N]> {
        let end = self
            .at
            .checked_add(N)
            .ok_or_else(|| source::invalid("ply", "offset overflow"))?;
        let bytes = self
            .bytes
            .get(self.at..end)
            .ok_or_else(|| source::invalid("ply", "truncated binary record"))?;
        self.at = end;
        Ok(bytes.try_into().unwrap())
    }
    pub(super) fn scalar(&mut self, kind: Scalar) -> Result<f64> {
        let value = if let Some(words) = self.words.as_mut() {
            let word = words
                .next()
                .ok_or_else(|| source::invalid("ply", "truncated ASCII record"))?;
            let value: f64 = word
                .parse()
                .map_err(|_| source::invalid("ply", "invalid scalar"))?;
            let (low, high) = match kind {
                Scalar::I8 => (i8::MIN as f64, i8::MAX as f64),
                Scalar::U8 => (0.0, u8::MAX as f64),
                Scalar::I16 => (i16::MIN as f64, i16::MAX as f64),
                Scalar::U16 => (0.0, u16::MAX as f64),
                Scalar::I32 => (i32::MIN as f64, i32::MAX as f64),
                Scalar::U32 => (0.0, u32::MAX as f64),
                Scalar::F32 => (-(f32::MAX as f64), f32::MAX as f64),
                Scalar::F64 => (-f64::MAX, f64::MAX),
            };
            if value < low || value > high || (kind.integral() && value.fract() != 0.0) {
                return Err(source::invalid("ply", "scalar outside its declared type"));
            }
            value
        } else {
            let little = matches!(self.format, Format::Little);
            macro_rules! number {
                ($t:ty) => {{
                    let bytes = self.take()?;
                    (if little {
                        <$t>::from_le_bytes(bytes)
                    } else {
                        <$t>::from_be_bytes(bytes)
                    }) as f64
                }};
            }
            match kind {
                Scalar::I8 => i8::from_ne_bytes(self.take()?) as f64,
                Scalar::U8 => u8::from_ne_bytes(self.take()?) as f64,
                Scalar::I16 => number!(i16),
                Scalar::U16 => number!(u16),
                Scalar::I32 => number!(i32),
                Scalar::U32 => number!(u32),
                Scalar::F32 => number!(f32),
                Scalar::F64 => number!(f64),
            }
        };
        if !value.is_finite() {
            return Err(source::invalid("ply", "non-finite scalar"));
        }
        Ok(value)
    }
    pub(super) fn index(&mut self, kind: Scalar) -> Result<usize> {
        let value = self.scalar(kind)?;
        if value < 0.0 || value.fract() != 0.0 {
            return Err(source::invalid("ply", "negative or fractional index"));
        }
        Ok(value as usize)
    }
    pub(super) fn finish(&mut self) -> Result<()> {
        let extra = match self.words.as_mut() {
            Some(words) => words.next().is_some(),
            None => self.at != self.bytes.len(),
        };
        if extra {
            return Err(source::invalid("ply", "data beyond declared elements"));
        }
        Ok(())
    }
}
