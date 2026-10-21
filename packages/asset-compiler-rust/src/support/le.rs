//! Little-endian fields of the binary files the compiler reads — image headers, containers,
//! scene archives —, bounded: a field past the end of its bytes is `None`, never a panic and never
//! a read beside it. The one reader of those fields, for every driver: at an offset (`u16_at`,
//! `u32_at`, `u64_at`), in sequence (`Cursor`), or as an array of words (`words`). The few
//! formats that write big-endian (PNG, PSD, JPEG, Radiance, Ogawa) read theirs here too
//! (`be16_at`, `be32_at`, `be64_at`).
#[cfg(test)]
pub(crate) mod tests;

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

/// The big-endian sixteen-bit field at `at`, or `None` past the end of `bytes`.
pub(crate) fn be16_at(bytes: &[u8], at: usize) -> Option<u16> {
    bytes_at(bytes, at).map(u16::from_be_bytes)
}

/// The big-endian thirty-two-bit field at `at`, or `None` past the end of `bytes`.
pub(crate) fn be32_at(bytes: &[u8], at: usize) -> Option<u32> {
    bytes_at(bytes, at).map(u32::from_be_bytes)
}

/// The big-endian sixty-four-bit field at `at`, or `None` past the end of `bytes`.
pub(crate) fn be64_at(bytes: &[u8], at: usize) -> Option<u64> {
    bytes_at(bytes, at).map(u64::from_be_bytes)
}

/// The unsigned field of `width` bytes (1, 2, 4 or 8) at `at`, in the given byte order; `None`
/// past the end of `bytes` or for any other width.
pub(crate) fn uint_at(bytes: &[u8], at: usize, width: usize, big_endian: bool) -> Option<u64> {
    match (width, big_endian) {
        (1, _) => bytes.get(at).copied().map(u64::from),
        (2, false) => u16_at(bytes, at).map(u64::from),
        (2, true) => be16_at(bytes, at).map(u64::from),
        (4, false) => u32_at(bytes, at).map(u64::from),
        (4, true) => be32_at(bytes, at).map(u64::from),
        (8, false) => u64_at(bytes, at),
        (8, true) => be64_at(bytes, at),
        _ => None,
    }
}

/// Every whole `N`-byte word of `bytes`, read by `from` (`f32::from_le_bytes`, …): a tail too
/// short for a word is left, never read beside, so the array comes out shorter than a geometry
/// may ask and its caller refuses by name.
pub(crate) fn words<'a, const N: usize, T: 'a>(
    bytes: &'a [u8],
    from: fn([u8; N]) -> T,
) -> impl Iterator<Item = T> + 'a {
    bytes.as_chunks::<N>().0.iter().copied().map(from)
}

/// `bytes` up to their first null byte, all of them when there is none: a C string's text.
pub(crate) fn until_nul(bytes: &[u8]) -> &[u8] {
    let end = bytes.iter().position(|byte| *byte == 0);
    &bytes[..end.unwrap_or(bytes.len())]
}

/// A cursor over `bytes` that reads its fields in sequence and yields `None` instead of walking
/// off the end; a read that fails leaves the cursor where it was.
pub(crate) struct Cursor<'a> {
    pub(crate) bytes: &'a [u8],
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
