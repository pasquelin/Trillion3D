//! Primary item/property associations justify the declared pixel transfer, never a stray colr.
use std::collections::{BTreeMap, BTreeSet};
#[derive(Default)]
pub(super) struct Associations {
    primary: Option<u32>,
    pub(super) srgb: BTreeSet<usize>,
    items: BTreeMap<u32, BTreeSet<usize>>,
}
fn take<'a>(bytes: &mut &'a [u8], count: usize) -> Result<&'a [u8], &'static str> {
    let part = bytes.get(..count).ok_or("image-decode-failed")?;
    *bytes = &bytes[count..];
    Ok(part)
}
fn integer(bytes: &mut &[u8], count: usize) -> Result<u32, &'static str> {
    Ok(take(bytes, count)?
        .iter()
        .fold(0, |value, byte| (value << 8) | u32::from(*byte)))
}
impl Associations {
    pub(super) fn primary(&mut self, mut bytes: &[u8]) -> Result<(), &'static str> {
        let version = integer(&mut bytes, 1)?;
        let flags = integer(&mut bytes, 3)?;
        if version > 1 || flags != 0 {
            return Err("image-decode-failed");
        }
        let id = integer(&mut bytes, if version == 0 { 2 } else { 4 })?;
        if !bytes.is_empty() || id == 0 || self.primary.replace(id).is_some() {
            return Err("image-decode-failed");
        }
        Ok(())
    }
    pub(super) fn read(&mut self, mut bytes: &[u8]) -> Result<(), &'static str> {
        let version = integer(&mut bytes, 1)?;
        let flags = integer(&mut bytes, 3)?;
        if version > 1 || flags > 1 {
            return Err("image-decode-failed");
        }
        let count = integer(&mut bytes, 4)?;
        for _ in 0..count {
            let id = integer(&mut bytes, if version == 0 { 2 } else { 4 })?;
            let count = integer(&mut bytes, 1)?;
            let mut properties = BTreeSet::new();
            for _ in 0..count {
                let index = integer(&mut bytes, if flags == 0 { 1 } else { 2 })?
                    & if flags == 0 { 0x7f } else { 0x7fff };
                if index != 0 {
                    properties.insert(index as usize);
                }
            }
            if self.items.insert(id, properties).is_some() {
                return Err("image-decode-failed");
            }
        }
        if !bytes.is_empty() {
            return Err("image-decode-failed");
        }
        Ok(())
    }
    pub(super) fn validate(&self) -> Result<(), &'static str> {
        let links = self
            .primary
            .and_then(|id| self.items.get(&id))
            .ok_or("image-colour-association-unsupported")?;
        if links.intersection(&self.srgb).count() != 1 {
            return Err("image-transfer-unsupported");
        }
        Ok(())
    }
}
