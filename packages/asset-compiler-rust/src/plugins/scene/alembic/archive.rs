//! The Alembic layer above Ogawa blocks: metadata, objects, hierarchy.
//!
//! An archive's root group holds six blocks — version, file version, object group, root metadata,
//! time samplings, indexed metadata. An **object** is a group whose first child holds its
//! properties, the next ones its child objects, and the last the block that names those children.
//! Each name comes with a metadata string, written inline or designated by its rank in the indexed
//! table; that is what names the schema — `AbcGeom_Xform`, `AbcGeom_PolyMesh`, `AbcGeom_FaceSet`
//! — and therefore what the object is.
use super::ogawa::{invalid, is_data, Ogawa};
use crate::Result;
use std::path::Path;

/// The last thirty-two bytes of an object-header block are digests, not names.
const DIGEST_BYTES: usize = 32;
/// A metadata rank equal to this value announces a metadata string written inline afterwards.
pub(super) const META_INLINE: usize = 0xff;
/// Maximum hierarchy depth: beyond it, the file loops or lies about its structure.
pub(super) const MAX_DEPTH: usize = 64;

/// An open archive: the file, and what its root declares once and for all.
pub(super) struct Archive {
    pub(super) file: Ogawa,
    /// Indexed metadata, cited by rank in every header of the file.
    metas: Vec<String>,
}

/// A hierarchy object: its name, its metadata — which carries its schema — and its group.
pub(super) struct Object {
    pub(super) name: String,
    pub(super) meta: String,
    pub(super) group: Vec<u64>,
}

/// A bounded cursor on a header block: it yields `None` instead of walking off the block.
pub(super) struct Cursor<'a> {
    bytes: &'a [u8],
    at: usize,
}

impl<'a> Cursor<'a> {
    pub(super) fn new(bytes: &'a [u8]) -> Self {
        Cursor { bytes, at: 0 }
    }
    pub(super) fn done(&self) -> bool {
        self.at >= self.bytes.len()
    }
    pub(super) fn u8(&mut self) -> Option<u8> {
        let value = *self.bytes.get(self.at)?;
        self.at += 1;
        Some(value)
    }
    pub(super) fn u16(&mut self) -> Option<u32> {
        let slice = self.bytes.get(self.at..self.at + 2)?;
        self.at += 2;
        Some(u32::from(u16::from_le_bytes(slice.try_into().ok()?)))
    }
    pub(super) fn u32(&mut self) -> Option<u32> {
        let slice = self.bytes.get(self.at..self.at + 4)?;
        self.at += 4;
        Some(u32::from_le_bytes(slice.try_into().ok()?))
    }
    /// The next `length` bytes, read as text. An unreadable byte becomes the replacement
    /// character: a badly encoded name does not fail a whole scene.
    pub(super) fn text(&mut self, length: u32) -> Option<String> {
        let length = usize::try_from(length).ok()?;
        let slice = self.bytes.get(self.at..self.at.checked_add(length)?)?;
        self.at += length;
        Some(String::from_utf8_lossy(slice).into_owned())
    }
}

impl Archive {
    /// Opens the archive and reads its metadata table.
    pub(super) fn open(path: &Path) -> Result<Archive> {
        let file = Ogawa::open(path)?;
        if file.root.len() < 6 {
            return Err(invalid(format!(
                "{}: the Ogawa root group carries {} blocks, an Alembic archive carries six",
                path.display(),
                file.root.len()
            )));
        }
        let metas = indexed_metas(file.data(file.root[5])?);
        Ok(Archive { file, metas })
    }

    /// The metadata this rank designates in the indexed table.
    pub(super) fn meta(&self, index: usize) -> String {
        self.metas.get(index).cloned().unwrap_or_default()
    }

    /// The root object: the top of the hierarchy, with no name and no schema.
    pub(super) fn root_object(&self) -> Result<Object> {
        Ok(Object {
            name: String::new(),
            meta: String::from_utf8_lossy(self.file.data(self.file.root[3])?).into_owned(),
            group: self.file.group(self.file.root[2])?,
        })
    }

    /// The child objects of this one, in the order the file declares them.
    pub(super) fn children(&self, object: &Object) -> Result<Vec<Object>> {
        let Some(last) = object.group.last().copied() else {
            return Ok(Vec::new());
        };
        if !is_data(last) {
            return Ok(Vec::new());
        }
        let block = self.file.data(last)?;
        let names = self.object_headers(block)?;
        names
            .into_iter()
            .enumerate()
            .map(|(rank, (name, meta))| {
                let child = object
                    .group
                    .get(rank + 1)
                    .copied()
                    .ok_or_else(|| invalid(format!("object {name:?} has no group")))?;
                Ok(Object {
                    name,
                    meta,
                    group: self.file.group(child)?,
                })
            })
            .collect()
    }

    /// Names and metadata of an object-header block, whose trailing digests are left aside: this
    /// driver reads a scene, it does not replay the writer's checksums.
    fn object_headers(&self, block: &[u8]) -> Result<Vec<(String, String)>> {
        let Some(body) = block
            .len()
            .checked_sub(DIGEST_BYTES)
            .map(|end| &block[..end])
        else {
            return Ok(Vec::new());
        };
        let mut cursor = Cursor::new(body);
        let mut out = Vec::new();
        while !cursor.done() {
            let header = (|| {
                let size = cursor.u32()?;
                let name = cursor.text(size)?;
                let rank = usize::from(cursor.u8()?);
                let meta = if rank == META_INLINE {
                    let size = cursor.u32()?;
                    cursor.text(size)?
                } else {
                    self.meta(rank)
                };
                Some((name, meta))
            })();
            out.push(header.ok_or_else(|| invalid("an object header block is truncated"))?);
        }
        Ok(out)
    }
}

/// The indexed metadata table: a one-byte length, then its text. Rank zero is the empty
/// metadata, which the format does not write.
fn indexed_metas(block: &[u8]) -> Vec<String> {
    let mut out = vec![String::new()];
    let mut cursor = Cursor::new(block);
    while !cursor.done() {
        let Some(size) = cursor.u8() else { break };
        let Some(text) = cursor.text(u32::from(size)) else {
            break;
        };
        out.push(text);
    }
    out
}

/// The value of a key in an Alembic metadata string, written as `key=value;key=value`.
pub(super) fn meta_value<'a>(meta: &'a str, key: &str) -> Option<&'a str> {
    meta.split(';').find_map(|pair| {
        let (name, value) = pair.split_once('=')?;
        (name == key).then_some(value)
    })
}
