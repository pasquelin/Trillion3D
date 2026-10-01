//! Chunk lengths are relative to their own six-byte headers and never escape the parent.
use super::*;
pub(super) struct Reader<'a> {
    bytes: &'a [u8],
    at: usize,
}
impl<'a> Reader<'a> {
    pub(super) fn new(bytes: &'a [u8]) -> Self {
        Self { bytes, at: 0 }
    }
    pub(super) fn empty(&self) -> bool {
        self.at == self.bytes.len()
    }
    pub(super) fn take(&mut self, count: usize) -> Result<&'a [u8]> {
        let end = self
            .at
            .checked_add(count)
            .ok_or_else(|| source::invalid("3ds", "length overflow"))?;
        let value = self
            .bytes
            .get(self.at..end)
            .ok_or_else(|| source::invalid("3ds", "truncated chunk"))?;
        self.at = end;
        Ok(value)
    }
    pub(super) fn u16(&mut self) -> Result<u16> {
        Ok(u16::from_le_bytes(self.take(2)?.try_into().unwrap()))
    }
    pub(super) fn u32(&mut self) -> Result<u32> {
        Ok(u32::from_le_bytes(self.take(4)?.try_into().unwrap()))
    }
    pub(super) fn float(&mut self) -> Result<f64> {
        let value = f32::from_le_bytes(self.take(4)?.try_into().unwrap()) as f64;
        if !value.is_finite() {
            return Err(source::invalid("3ds", "nonfinite float"));
        }
        Ok(value)
    }
    pub(super) fn string(&mut self) -> Result<String> {
        let n = self.bytes[self.at..]
            .iter()
            .position(|v| *v == 0)
            .ok_or_else(|| source::invalid("3ds", "unterminated string"))?;
        let bytes = self.take(n + 1)?;
        std::str::from_utf8(&bytes[..n])
            .map(str::to_string)
            .map_err(|_| source::unsupported("3ds", "non-UTF8 name encoding"))
    }
    pub(super) fn chunk(&mut self) -> Result<(u16, &'a [u8])> {
        let id = self.u16()?;
        let length = self.u32()? as usize;
        let payload = length
            .checked_sub(6)
            .ok_or_else(|| source::invalid("3ds", "chunk shorter than header"))?;
        Ok((id, self.take(payload)?))
    }
    pub(super) fn finish(&self) -> Result<()> {
        if self.empty() {
            Ok(())
        } else {
            Err(source::invalid("3ds", "extra chunk payload"))
        }
    }
}
