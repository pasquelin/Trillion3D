//! Checked little-endian fields; file counts never become unchecked allocations.
use super::*;
/// Conservative live decoded/output admission, not a process-RSS guarantee.
#[derive(Default)]
pub(super) struct Budget {
    used: usize,
    limit: usize,
}
impl Budget {
    pub(super) fn new(limit: usize) -> Self {
        Self { used: 0, limit }
    }
    pub(super) fn charge(&mut self, bytes: usize) -> Result<()> {
        self.used = self.used.saturating_add(bytes);
        source::admit(self.used, self.limit, "vox")
    }
}
pub(super) type Dict = BTreeMap<String, String>;
pub(super) struct Reader<'a> {
    bytes: &'a [u8],
    at: usize,
}
impl<'a> Reader<'a> {
    pub(super) fn new(bytes: &'a [u8]) -> Self {
        Self { bytes, at: 0 }
    }
    pub(super) fn remaining(&self) -> usize {
        self.bytes.len() - self.at
    }
    pub(super) fn take(&mut self, count: usize) -> Result<&'a [u8]> {
        if count > self.remaining() {
            return Err(source::invalid("vox", "truncated chunk"));
        }
        let start = self.at;
        self.at += count;
        Ok(&self.bytes[start..self.at])
    }
    pub(super) fn u32(&mut self) -> Result<u32> {
        Ok(u32::from_le_bytes(self.take(4)?.try_into().unwrap()))
    }
    pub(super) fn i32(&mut self) -> Result<i32> {
        Ok(self.u32()? as i32)
    }
    fn string(&mut self, budget: &mut Budget) -> Result<String> {
        let count = self.u32()? as usize;
        let bytes = self.take(count)?;
        budget.charge(count.saturating_mul(4))?;
        String::from_utf8(bytes.to_vec())
            .map_err(|_| source::invalid("vox", "invalid UTF-8 dictionary"))
    }
    pub(super) fn dict(&mut self, budget: &mut Budget) -> Result<Dict> {
        let count = self.u32()? as usize;
        if count > self.remaining() / 8 {
            return Err(source::invalid("vox", "dictionary count exceeds chunk"));
        }
        budget.charge(count.saturating_mul(128))?;
        let mut dict = Dict::new();
        for _ in 0..count {
            let key = self.string(budget)?;
            if dict.insert(key, self.string(budget)?).is_some() {
                return Err(source::invalid("vox", "duplicate dictionary key"));
            }
        }
        Ok(dict)
    }
    pub(super) fn finish(&self) -> Result<()> {
        if self.remaining() != 0 {
            return Err(source::invalid("vox", "unexpected chunk payload"));
        }
        Ok(())
    }
}
