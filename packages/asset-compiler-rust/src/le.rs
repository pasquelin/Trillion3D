//! Little-endian fields of the binary files the compiler reads — image headers, containers,
//! scene archives —, bounded: a field past the end of its bytes is `None`, never a panic and never
//! a read beside it. The one reader of those fields, for every driver: at an offset (`u16_at`,
//! `u32_at`, `u64_at`), or in sequence (`Cursor`).

/// The `N` bytes at `at`, or `None` when they pass the end of `bytes`.
fn bytes_at<const N: usize>(bytes: &[u8], at: usize) -> Option<[u8; N]> {
    Some(*bytes.get(at..)?.first_chunk()?)
}

/// The sixteen-bit field at `at`, or `None` past the end of `bytes`.
pub(crate) fn u16_at(bytes: &[u8], at: usize) -> Option<u16> {
    bytes_at(bytes, at).map(u16::from_le_bytes)
}

/// The thirty-two-bit field at `at`, or `None` past the end of `bytes`.
pub(crate) fn u32_at(bytes: &[u8], at: usize) -> Option<u32> {
    bytes_at(bytes, at).map(u32::from_le_bytes)
}

/// The sixty-four-bit field at `at`, or `None` past the end of `bytes`.
pub(crate) fn u64_at(bytes: &[u8], at: usize) -> Option<u64> {
    bytes_at(bytes, at).map(u64::from_le_bytes)
}

/// A cursor over `bytes` that reads its fields in sequence and yields `None` instead of walking
/// off the end; a read that fails leaves the cursor where it was.
pub(crate) struct Cursor<'a> {
    bytes: &'a [u8],
    at: usize,
}

impl<'a> Cursor<'a> {
    pub(crate) fn new(bytes: &'a [u8]) -> Self {
        Cursor { bytes, at: 0 }
    }
    /// Whether every byte has been read.
    pub(crate) fn done(&self) -> bool {
        self.at >= self.bytes.len()
    }
    /// The bytes not read yet.
    pub(crate) fn rest(&self) -> &'a [u8] {
        self.bytes.get(self.at..).unwrap_or_default()
    }
    /// The next `length` bytes.
    pub(crate) fn take(&mut self, length: usize) -> Option<&'a [u8]> {
        let slice = self.bytes.get(self.at..self.at.checked_add(length)?)?;
        self.at += length;
        Some(slice)
    }
    /// Moves to the next multiple of `alignment`, which may lie past the end.
    pub(crate) fn align(&mut self, alignment: usize) {
        self.at = self.at.next_multiple_of(alignment);
    }
    pub(crate) fn u8(&mut self) -> Option<u8> {
        self.take(1).map(|bytes| bytes[0])
    }
    pub(crate) fn u16(&mut self) -> Option<u16> {
        let value = u16_at(self.bytes, self.at)?;
        self.at += 2;
        Some(value)
    }
    pub(crate) fn u32(&mut self) -> Option<u32> {
        let value = u32_at(self.bytes, self.at)?;
        self.at += 4;
        Some(value)
    }
}

#[cfg(test)]
#[path = "le_tests.rs"]
mod tests;
