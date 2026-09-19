//! Reading a field by its name, in the bytes of a block.
//!
//! A view is an SDNA structure laid on an offset of the file. Everything goes through it:
//! numbers, pointers, in-place strings, nested structures and pointed-to structures. A field
//! absent from this version of the format never panics — it yields the default the caller gave,
//! and it is the caller's job to say what it does with it.
//!
//! A view is bounded **to the block** it reads, never to the file: a block shorter than the
//! structure its header names would otherwise yield the next block's bytes as if they were its
//! own. A field that overruns the block is therefore treated as an absent field.
use super::*;

/// A structure read at an offset of the file.
#[derive(Clone, Copy)]
pub(super) struct At<'a> {
    pub(super) file: &'a BlendFile,
    pub(super) layout: &'a Layout,
    pub(super) base: usize,
    /// The end of the reached block's bytes: no field is read beyond it.
    limit: usize,
    /// The original address of the reached block: it is by this that the file's pointers compare
    /// with each other. Zero for a nested structure, which has none.
    pub(super) old: u64,
}

impl BlendFile {
    /// The view of a block, typed by the structure its header names.
    pub(super) fn view<'a>(&'a self, block: &Block) -> Option<At<'a>> {
        Some(At {
            file: self,
            layout: self.dna.layout(block.sdna)?,
            base: block.start,
            limit: block.start.saturating_add(block.len),
            old: block.old,
        })
    }
    /// The view of a block, forced to a named structure: that is how one reads what a `void *`
    /// designates, the pointed-to block then not carrying the useful type in its header.
    pub(super) fn view_as<'a>(&'a self, block: &Block, kind: &str) -> Option<At<'a>> {
        Some(At {
            file: self,
            layout: self.dna.layout(self.dna.index(kind)?)?,
            base: block.start,
            limit: block.start.saturating_add(block.len),
            old: block.old,
        })
    }
    /// The bytes of a block designated by an original address.
    pub(super) fn bytes_at(&self, pointer: u64) -> Option<&[u8]> {
        let block = self.at(pointer)?;
        self.bytes.get(block.start..block.start + block.len)
    }
    /// The string a block designated by a `char *` carries, without its terminating zero.
    pub(super) fn text_at(&self, pointer: u64) -> Option<String> {
        let bytes = self.bytes_at(pointer)?;
        let end = bytes
            .iter()
            .position(|byte| *byte == 0)
            .unwrap_or(bytes.len());
        Some(String::from_utf8_lossy(&bytes[..end]).into_owned())
    }
}

impl<'a> At<'a> {
    pub(super) fn has(&self, name: &str) -> bool {
        self.layout.field(name).is_some()
    }
    /// The bytes of a field, bounded by the block. A field whose end overruns the block — or
    /// whose size-by-count product overruns — is treated as absent.
    fn raw(&self, name: &str) -> Option<(&'a Field, &'a [u8])> {
        let field = self.layout.field(name)?;
        let from = self.base.checked_add(field.offset)?;
        let end = field
            .unit
            .checked_mul(field.count)
            .and_then(|span| from.checked_add(span))
            .filter(|end| *end <= self.limit)?;
        let bytes = self.file.bytes.get(from..end)?;
        Some((field, bytes))
    }
    /// An integer, whatever its declared width and signedness.
    pub(super) fn int(&self, name: &str, default: i64) -> i64 {
        let Some((field, bytes)) = self.raw(name) else {
            return default;
        };
        bytes::scalar(field, bytes).unwrap_or(default)
    }
    pub(super) fn float(&self, name: &str, default: f32) -> f32 {
        self.floats(name).first().copied().unwrap_or(default)
    }
    /// All the floats of a field, one for a simple field, more for an array.
    pub(super) fn floats(&self, name: &str) -> Vec<f32> {
        let Some((field, bytes)) = self.raw(name) else {
            return Vec::new();
        };
        if field.pointer || field.unit != 4 || field.kind != "float" {
            return Vec::new();
        }
        bytes::floats(bytes, field.count)
    }
    /// The original address a pointer field carries. Zero when it carries none.
    pub(super) fn pointer(&self, name: &str) -> u64 {
        let Some((field, bytes)) = self.raw(name) else {
            return 0;
        };
        if !field.pointer || bytes.len() < POINTER {
            return 0;
        }
        u64::from_le_bytes(bytes[..POINTER].try_into().unwrap_or_default())
    }
    /// A string written in place in a character array, without its terminating zero.
    pub(super) fn text(&self, name: &str) -> String {
        let Some((field, bytes)) = self.raw(name) else {
            return String::new();
        };
        if field.pointer {
            return self.file.text_at(self.pointer(name)).unwrap_or_default();
        }
        let end = bytes
            .iter()
            .position(|byte| *byte == 0)
            .unwrap_or(bytes.len());
        String::from_utf8_lossy(&bytes[..end]).into_owned()
    }
    /// A nested structure, typed by the type the SDNA gives the field.
    pub(super) fn inner(&self, name: &str) -> Option<At<'a>> {
        let field = self.layout.field(name)?;
        let kind = self.file.dna.index(&field.kind)?;
        Some(At {
            file: self.file,
            layout: self.file.dna.layout(kind)?,
            base: self.base.checked_add(field.offset)?,
            limit: self.limit,
            old: 0,
        })
    }
    /// The structure a pointer field designates, typed by the header of the reached block.
    pub(super) fn follow(&self, name: &str) -> Option<At<'a>> {
        let block = self.file.at(self.pointer(name))?;
        self.file.view(block)
    }
    /// The structure a pointer field designates, forced to a named type — the case of a `void *`.
    pub(super) fn follow_as(&self, name: &str, kind: &str) -> Option<At<'a>> {
        let block = self.file.at(self.pointer(name))?;
        self.file.view_as(block, kind)
    }
    /// The bytes of the block a pointer field designates.
    pub(super) fn block(&self, name: &str) -> Option<&'a [u8]> {
        self.file.bytes_at(self.pointer(name))
    }
    /// The view of an element of a structure array: the pointed-to block holds `count` structures
    /// in a row, and it is the size the SDNA declares that gives the stride.
    pub(super) fn item(&self, rank: usize) -> Option<At<'a>> {
        Some(At {
            file: self.file,
            layout: self.layout,
            base: self.base.checked_add(rank.checked_mul(self.layout.size)?)?,
            limit: self.limit,
            old: self.old,
        })
    }
    /// The name of an identified data block: Blender stores it in its `id` sub-structure, with
    /// two prefix letters that name its genre.
    pub(super) fn id_name(&self) -> String {
        self.inner("id")
            .map(|id| id.text("name"))
            .unwrap_or_default()
    }
    /// The links of a `ListBase`: the linked list Blender writes block by block, each link
    /// starting with its `next`. Bounded so a damaged file does not loop.
    pub(super) fn list(&self, name: &str) -> Vec<At<'a>> {
        let mut out = Vec::new();
        let Some(head) = self.inner(name) else {
            return out;
        };
        let mut pointer = head.pointer("first");
        while let Some(block) = self.file.at(pointer) {
            let Some(item) = self.file.view(block) else {
                break;
            };
            pointer = item.pointer("next");
            out.push(item);
            if out.len() >= MAX_LIST {
                break;
            }
        }
        out
    }
}
