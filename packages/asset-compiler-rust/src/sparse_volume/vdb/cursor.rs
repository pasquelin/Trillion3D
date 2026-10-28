//! A position in the bytes of a file, and the little-endian numbers it reads at it.
use super::invalid;
use crate::Result;

pub(super) struct Cursor<'a> {
    data: &'a [u8],
    position: usize,
}

impl<'a> Cursor<'a> {
    pub(super) fn new(data: &'a [u8]) -> Self {
        Self { data, position: 0 }
    }

    pub(super) fn seek(&mut self, position: usize) {
        self.position = position;
    }

    pub(super) fn bytes(&mut self, count: usize) -> Result<&'a [u8]> {
        let end = self
            .position
            .checked_add(count)
            .filter(|&end| end <= self.data.len())
            .ok_or_else(|| invalid("the file ends inside a record"))?;
        let bytes = &self.data[self.position..end];
        self.position = end;
        Ok(bytes)
    }

    pub(super) fn skip(&mut self, count: usize) -> Result<()> {
        self.bytes(count).map(|_| ())
    }

    pub(super) fn u8(&mut self) -> Result<u8> {
        Ok(self.bytes(1)?[0])
    }

    pub(super) fn u32(&mut self) -> Result<u32> {
        Ok(u32::from_le_bytes(
            self.bytes(4)?.try_into().expect("four bytes"),
        ))
    }

    pub(super) fn i32(&mut self) -> Result<i32> {
        Ok(self.u32()? as i32)
    }

    pub(super) fn i64(&mut self) -> Result<i64> {
        Ok(i64::from_le_bytes(
            self.bytes(8)?.try_into().expect("eight bytes"),
        ))
    }

    pub(super) fn f64(&mut self) -> Result<f64> {
        Ok(f64::from_le_bytes(
            self.bytes(8)?.try_into().expect("eight bytes"),
        ))
    }

    /// A string: its length in a word, then its bytes.
    pub(super) fn string(&mut self) -> Result<String> {
        let length = self.u32()? as usize;
        Ok(String::from_utf8_lossy(self.bytes(length)?).into_owned())
    }

    /// `count` numbers of eight bytes.
    pub(super) fn f64s<const N: usize>(&mut self) -> Result<[f64; N]> {
        let mut out = [0.0; N];
        for slot in &mut out {
            *slot = self.f64()?;
        }
        Ok(out)
    }
}
