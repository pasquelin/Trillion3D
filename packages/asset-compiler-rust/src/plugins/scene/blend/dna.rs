//! The SDNA: the description each Blender file carries of its own structures.
//!
//! The `DNA1` block is the format's public self-description. It chains four sections tagged by a
//! four-byte label and aligned on four: `NAME` the field names, `TYPE` the type names, `TLEN` the
//! size of each type, `STRC` the structures — for each, its type then its fields, given by a type
//! index and a name index.
//!
//! This is where this driver takes all its offsets from: **no offset is hardcoded**. A field is
//! asked for by its name, and a structure that loses, gains or moves a field from one Blender
//! version to another stays readable as long as the names used here exist.
use super::*;

mod read;

use read::{count, layout, strings, tag, word};

/// Pointer size, that of the only files this reader opens.
pub(super) const POINTER: usize = 8;

/// A field of a structure: where it starts, what it carries, how many times.
pub(super) struct Field {
    pub(super) offset: usize,
    pub(super) kind: String,
    pub(super) unit: usize,
    pub(super) count: usize,
    pub(super) pointer: bool,
}

/// A structure of the file: its type name, its size and its fields by name.
pub(super) struct Layout {
    pub(super) name: String,
    pub(super) size: usize,
    pub(super) fields: HashMap<String, Field>,
}

/// All the structures the file describes, and enough to look them up by name.
pub(super) struct Dna {
    pub(super) structs: Vec<Layout>,
    by_name: HashMap<String, usize>,
}

impl Dna {
    pub(super) fn read(bytes: &[u8]) -> Result<Dna> {
        let mut at = 0;
        tag(bytes, &mut at, b"SDNA")?;
        let names = strings(bytes, &mut at, b"NAME")?;
        let types = strings(bytes, &mut at, b"TYPE")?;
        tag(bytes, &mut at, b"TLEN")?;
        let mut lengths = Vec::with_capacity(types.len());
        for _ in 0..types.len() {
            lengths.push(u16::from_le_bytes(word(bytes, &mut at)?) as usize);
        }
        at = (at + 3) & !3;
        tag(bytes, &mut at, b"STRC")?;
        // A structure weighs at least its type and its field count: the count is bounded by what
        // the block still carries, and nothing is reserved before that is trusted.
        let total = count(bytes, &mut at, 4)?;
        let mut structs = Vec::with_capacity(total);
        for _ in 0..total {
            structs.push(layout(bytes, &mut at, &names, &types, &lengths)?);
        }
        let by_name = structs
            .iter()
            .enumerate()
            .map(|(rank, entry)| (entry.name.clone(), rank))
            .collect();
        Ok(Dna { structs, by_name })
    }
    /// The rank of a named structure, when this file describes it.
    pub(super) fn index(&self, name: &str) -> Option<usize> {
        self.by_name.get(name).copied()
    }
    pub(super) fn layout(&self, kind: usize) -> Option<&Layout> {
        self.structs.get(kind)
    }
}

impl Layout {
    pub(super) fn field(&self, name: &str) -> Option<&Field> {
        self.fields.get(name)
    }
}
