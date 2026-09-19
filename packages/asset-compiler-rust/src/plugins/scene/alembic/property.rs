//! Properties of an Alembic object: their headers, and the first sample of each.
//!
//! A property group holds one sub-property per child and, as the last child, the block that
//! describes them all. Each description fits in a thirty-two-bit integer — kind, data type,
//! width, sample count, metadata rank — followed by the variable-length fields those bits
//! announce, each written on one, two or four bytes according to the same integer.
//!
//! A **compound** property contains other properties; a **scalar** and an **array** carry
//! samples, one per child for the first, two — values then dimensions — for the second. Each
//! sample opens on sixteen key bytes the writer left there.
use super::archive::{Archive, Cursor, META_INLINE};
use super::ogawa::{invalid, is_data};
use crate::Result;

/// The sixteen key bytes that precede the values of every sample.
const SAMPLE_KEY_BYTES: usize = 16;
/// Data types this driver reads. The others are left at their rank, without being decoded.
pub(super) const POD_BOOL: u32 = 0;
pub(super) const POD_U8: u32 = 1;
pub(super) const POD_U32: u32 = 5;
pub(super) const POD_I32: u32 = 6;
pub(super) const POD_F32: u32 = 10;
pub(super) const POD_F64: u32 = 11;

/// The kind of a property.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum Kind {
    Compound,
    Scalar,
    Array,
}

/// A declared property: what its header says, and the pointer to its samples.
pub(super) struct Property {
    pub(super) name: String,
    pub(super) kind: Kind,
    /// The data type of a sample, and the number of components per element.
    pub(super) pod: u32,
    pub(super) extent: u8,
    /// The sample count: beyond one, the property is animated.
    pub(super) samples: u32,
    pub(super) meta: String,
    child: u64,
}

/// The properties of a group, in declared order.
pub(super) struct Properties {
    entries: Vec<Property>,
}

impl Properties {
    /// Reads the properties the group designated by this pointer holds.
    pub(super) fn read(archive: &Archive, child: u64) -> Result<Properties> {
        let group = archive.file.group(child)?;
        let Some(last) = group.last().copied().filter(|last| is_data(*last)) else {
            return Ok(Properties {
                entries: Vec::new(),
            });
        };
        let block = archive.file.data(last)?;
        let mut cursor = Cursor::new(block);
        let mut entries = Vec::new();
        while !cursor.done() {
            let header = read_header(archive, &mut cursor)
                .ok_or_else(|| invalid("a property header block is truncated"))?;
            let child = group
                .get(entries.len())
                .copied()
                .ok_or_else(|| invalid("a property header has no group"))?;
            entries.push(Property { child, ..header });
        }
        Ok(Properties { entries })
    }

    pub(super) fn find(&self, name: &str) -> Option<&Property> {
        self.entries.iter().find(|entry| entry.name == name)
    }

    /// The properties of a compound sub-property.
    pub(super) fn compound(&self, archive: &Archive, name: &str) -> Result<Option<Properties>> {
        match self.find(name).filter(|found| found.kind == Kind::Compound) {
            Some(found) => Properties::read(archive, found.child).map(Some),
            None => Ok(None),
        }
    }

    /// The first sample of a named property, key stripped. An absent, empty or other-typed
    /// property yields `None`: it is the caller's job to make an absence or a refusal of it. A
    /// given width is required; `None` accepts the one the file declares, for properties whose
    /// width is the count — an `Xform`'s operation stack and its values.
    pub(super) fn sample<'a>(
        &self,
        archive: &'a Archive,
        name: &str,
        pod: u32,
        extent: Option<u8>,
    ) -> Result<Option<&'a [u8]>> {
        let wanted = |found: &&Property| {
            found.pod == pod && extent.is_none_or(|extent| found.extent == extent)
        };
        match self.find(name).filter(wanted) {
            Some(found) => first_sample(archive, found),
            None => Ok(None),
        }
    }
}

/// The first sample of a property, key stripped.
pub(super) fn first_sample<'a>(
    archive: &'a Archive,
    property: &Property,
) -> Result<Option<&'a [u8]>> {
    if property.samples == 0 || property.kind == Kind::Compound {
        return Ok(None);
    }
    let group = archive.file.group(property.child)?;
    let Some(first) = group.first().copied().filter(|first| is_data(*first)) else {
        return Ok(None);
    };
    Ok(archive.file.data(first)?.get(SAMPLE_KEY_BYTES..))
}

/// A property header, without its group's pointer, which the caller attaches afterwards.
fn read_header(archive: &Archive, cursor: &mut Cursor<'_>) -> Option<Property> {
    let info = cursor.u32()?;
    let kind = match info & 0x3 {
        0 => Kind::Compound,
        1 => Kind::Scalar,
        _ => Kind::Array,
    };
    let hint = (info >> 2) & 0x3;
    let mut pod = 0;
    let mut extent = 0;
    let mut samples = 0;
    if kind != Kind::Compound {
        pod = (info >> 4) & 0xf;
        extent = ((info >> 12) & 0xff) as u8;
        samples = sized(cursor, hint)?;
        // The ranks of the first and last changed samples only serve to look up a sample in the
        // middle of an animation; this driver reads only the first, but their bytes are in the
        // stream and must be consumed to reach the name.
        if info & 0x0200 != 0 {
            sized(cursor, hint)?;
            sized(cursor, hint)?;
        }
        if info & 0x0100 != 0 {
            sized(cursor, hint)?;
        }
    }
    let size = sized(cursor, hint)?;
    let name = cursor.text(size)?;
    let rank = ((info >> 20) & 0xff) as usize;
    let meta = if rank == META_INLINE {
        let size = sized(cursor, hint)?;
        cursor.text(size)?
    } else {
        archive.meta(rank)
    };
    Some(Property {
        name,
        kind,
        pod,
        extent,
        samples,
        meta,
        child: 0,
    })
}

/// An integer whose width — one, two or four bytes — is announced by the header.
fn sized(cursor: &mut Cursor<'_>, hint: u32) -> Option<u32> {
    match hint {
        0 => cursor.u8().map(u32::from),
        1 => cursor.u16(),
        2 => cursor.u32(),
        _ => None,
    }
}
