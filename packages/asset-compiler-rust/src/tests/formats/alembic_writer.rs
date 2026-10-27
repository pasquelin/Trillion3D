//! A writer of Ogawa archives for the tests, in memory: the blocks a reader of this compiler finds in
//! a real archive — the six blocks of the root, objects with their headers, properties with theirs,
//! arrays whose samples open on their sixteen key bytes —, laid out as its reader (`alembic/ogawa.rs`,
//! `archive.rs`, `property.rs`) reads them, and nothing more: one sample for each property, the
//! metadata of every name written inline, no digest worth the name.
//!
//! A block is designated by its position in the file; a data block by a position with the high bit
//! set, an empty group by position zero. An instance is an object header whose group is the source's.

/// The bit that distinguishes a data block from a group in a pointer.
const DATA_BIT: u64 = 1 << 63;
/// The metadata rank that announces the metadata written inline after the name.
const INLINE: u8 = 0xff;
/// The sixteen key bytes before the values of a sample, and the digest after an object's headers.
const KEY_BYTES: usize = 16;
const DIGEST_BYTES: usize = 32;
/// The kinds of property, as the two low bits of a header say them, and the data types it names.
const COMPOUND: u32 = 0;
const ARRAY: u32 = 2;
pub(super) const POD_I32: u32 = 6;
pub(super) const POD_F32: u32 = 10;
pub(super) const POD_U8: u32 = 1;
pub(super) const POD_F64: u32 = 11;

/// A property to write: an array of one sample, or a compound of properties.
pub(super) enum Prop<'a> {
    Array {
        name: &'a str,
        pod: u32,
        extent: u32,
        meta: &'a str,
        values: Vec<u8>,
    },
    Compound {
        name: &'a str,
        children: Vec<Prop<'a>>,
    },
}

/// A child object of an object: its name, its metadata, and the group that holds it.
pub(super) struct Child<'a> {
    pub(super) name: &'a str,
    pub(super) meta: &'a str,
    pub(super) group: u64,
}

/// The archive being written.
pub(super) struct Ogawa {
    bytes: Vec<u8>,
}

/// The header of a property: its kind, data type, extent, sample count, name and metadata.
fn header(kind: u32, (pod, extent): (u32, u32), name: &str, meta: &str) -> Vec<u8> {
    let rank = if meta.is_empty() {
        0
    } else {
        u32::from(INLINE)
    };
    let info = kind | pod << 4 | extent << 12 | rank << 20;
    let mut out = info.to_le_bytes().to_vec();
    if kind != COMPOUND {
        out.push(1);
    }
    out.push(name.len() as u8);
    out.extend(name.as_bytes());
    if rank != 0 {
        out.push(meta.len() as u8);
        out.extend(meta.as_bytes());
    }
    out
}

impl Ogawa {
    /// An archive that holds only its header: the frozen flag, the version, the root's position.
    pub(super) fn new() -> Self {
        let mut bytes = b"Ogawa\xff\x00\x01".to_vec();
        bytes.extend(0u64.to_le_bytes());
        Self { bytes }
    }

    /// Writes a data block and returns its pointer.
    fn data(&mut self, payload: &[u8]) -> u64 {
        let at = self.bytes.len() as u64;
        self.bytes.extend((payload.len() as u64).to_le_bytes());
        self.bytes.extend(payload);
        at | DATA_BIT
    }

    /// Writes a group and returns its pointer; an empty group is position zero.
    fn group(&mut self, children: &[u64]) -> u64 {
        if children.is_empty() {
            return 0;
        }
        let at = self.bytes.len() as u64;
        self.bytes.extend((children.len() as u64).to_le_bytes());
        for child in children {
            self.bytes.extend(child.to_le_bytes());
        }
        at
    }

    /// Writes the group of `list`: one group for each property, and the block of their headers last.
    pub(super) fn properties(&mut self, list: &[Prop<'_>]) -> u64 {
        let mut headers = Vec::new();
        let mut children = Vec::new();
        for prop in list {
            match prop {
                Prop::Array {
                    name,
                    pod,
                    extent,
                    meta,
                    values,
                } => {
                    headers.extend(header(ARRAY, (*pod, *extent), name, meta));
                    let mut sample = vec![0u8; KEY_BYTES];
                    sample.extend(values);
                    let (sample, dimensions) = (self.data(&sample), self.data(&[]));
                    children.push(self.group(&[sample, dimensions]));
                }
                Prop::Compound {
                    name,
                    children: inner,
                } => {
                    headers.extend(header(COMPOUND, (0, 0), name, ""));
                    children.push(self.properties(inner));
                }
            }
        }
        children.push(self.data(&headers));
        self.group(&children)
    }

    /// Writes an object: its properties, its children's groups and the block of their headers last.
    pub(super) fn object(&mut self, properties: u64, children: &[Child<'_>]) -> u64 {
        let mut group = vec![properties];
        group.extend(children.iter().map(|child| child.group));
        if !children.is_empty() {
            let mut headers = Vec::new();
            for child in children {
                headers.extend((child.name.len() as u32).to_le_bytes());
                headers.extend(child.name.as_bytes());
                headers.push(INLINE);
                headers.extend((child.meta.len() as u32).to_le_bytes());
                headers.extend(child.meta.as_bytes());
            }
            headers.extend([0u8; DIGEST_BYTES]);
            group.push(self.data(&headers));
        }
        self.group(&group)
    }

    /// The archive whose root object has the children `top`.
    pub(super) fn archive(mut self, top: &[Child<'_>]) -> Vec<u8> {
        let properties = self.properties(&[]);
        let root_object = self.object(properties, top);
        let blocks = [
            self.data(&[]),
            self.data(&[]),
            root_object,
            self.data(&[]),
            self.data(&[]),
            self.data(&[]),
        ];
        let root = self.group(&blocks);
        self.bytes[8..16].copy_from_slice(&root.to_le_bytes());
        self.bytes
    }
}
