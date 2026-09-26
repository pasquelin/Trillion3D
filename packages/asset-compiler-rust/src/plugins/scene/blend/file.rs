//! Splitting a Blender file into blocks, and their index by address.
//!
//! Public layout of the format: after the header comes a sequence of blocks, until `ENDB`. Each
//! block carries a four-byte code, the index of the SDNA structure that describes its bytes, the
//! address it occupied in memory when the file was written — that is the key of every pointer in
//! the file —, the size of its data and the number of structures they carry. The old layout
//! writes these fields on thirty-two bits, the recent one on sixty-four; the header says which.
//!
//! No announced size is trusted without being bounded by the file: any overrun is a truncated
//! file, named as such.
//!
//! A bare file is read in place, through a memory map: its pages stay the system's to evict, so
//! the file's size costs no heap. Only a gzip or Zstandard wrapping is unpacked, under the job's
//! RAM budget.
use super::*;
use std::borrow::Cow;

/// The header length of a sixty-four-bit-field block.
const WIDE_HEADER: usize = 32;
/// The least a block costs in memory once indexed: its entry, and its address in the index.
pub(super) const INDEXED: usize = size_of::<Block>() + size_of::<(u64, usize)>();

/// A block of the file: its code, the structure that describes it, and where its bytes live.
pub(super) struct Block {
    pub(super) code: [u8; 4],
    pub(super) sdna: usize,
    pub(super) old: u64,
    pub(super) start: usize,
    pub(super) len: usize,
    /// The number of structures its bytes carry: the bound of a structure array.
    pub(super) count: usize,
}

/// An open Blender file: its bytes — borrowed when bare, unpacked when wrapped —, its SDNA, its
/// blocks and their index by address.
pub(super) struct BlendFile<'a> {
    pub(super) bytes: Cow<'a, [u8]>,
    pub(super) version: u32,
    pub(super) blocks: Vec<Block>,
    pub(super) dna: Dna,
    index: HashMap<u64, usize>,
    /// The bytes of the buffer a wrapped file unpacked into; none for a bare file.
    unpacked: usize,
}

impl<'a> BlendFile<'a> {
    /// Opens a Blender file: undoes the wrapping under `ceiling`, reads the header, walks the
    /// blocks, then the `DNA1` block that describes all the structures.
    pub(super) fn open(raw: &'a [u8], ceiling: usize) -> Result<BlendFile<'a>> {
        let bytes = envelope::unwrap(raw, ceiling)?;
        let shape = envelope::head(&bytes)?;
        // A wrapped file's buffer counts by its capacity, what the allocator actually holds.
        let unpacked = match &bytes {
            Cow::Borrowed(_) => 0,
            Cow::Owned(buffer) => buffer.capacity(),
        };
        let blocks = walk(&bytes, &shape, ceiling.saturating_sub(unpacked))?;
        let dna = blocks
            .iter()
            .find(|block| &block.code == b"DNA1")
            .ok_or_else(|| refused("blend-dna-invalid", "blend: no DNA1 block in this file"))
            .and_then(|block| Dna::read(&bytes[block.start..block.start + block.len]))?;
        let index = blocks
            .iter()
            .enumerate()
            .filter(|(_, block)| block.old != 0)
            .map(|(rank, block)| (block.old, rank))
            .collect();
        Ok(BlendFile {
            bytes,
            version: shape.version,
            blocks,
            dna,
            index,
            unpacked,
        })
    }
    /// The bytes this file holds in memory: the buffer it unpacked into, none when it is read in
    /// place, and its block index.
    pub(super) fn held(&self) -> usize {
        self.unpacked
            .saturating_add(self.blocks.len().saturating_mul(INDEXED))
    }
    /// The block this original address designates. A null pointer, or one to a missing block,
    /// designates none: it is the reader that decides what to say of it, never a panic.
    pub(super) fn at(&self, old: u64) -> Option<&Block> {
        self.index.get(&old).map(|rank| &self.blocks[*rank])
    }
    /// The blocks of a given code, in file order.
    pub(super) fn of(&self, code: [u8; 4]) -> impl Iterator<Item = &Block> {
        self.blocks.iter().filter(move |block| block.code == code)
    }
}

/// Walks the blocks from the end of the header until `ENDB`, their index under `room` bytes: a
/// file of many small blocks would otherwise cost more memory than its own size.
fn walk(bytes: &[u8], shape: &envelope::Shape, room: usize) -> Result<Vec<Block>> {
    let truncated = || refused("blend-truncated", "blend: the file ends inside a block");
    let header = if shape.wide {
        WIDE_HEADER
    } else {
        16 + shape.pointer
    };
    let mut blocks = Vec::new();
    let mut at = shape.header;
    loop {
        let fields = bytes.get(at..at + header).ok_or_else(truncated)?;
        let code: [u8; 4] = fields[..4].try_into().map_err(|_| truncated())?;
        let word = |from: usize| u32::from_le_bytes(fields[from..from + 4].try_into().unwrap());
        let wide = |from: usize| u64::from_le_bytes(fields[from..from + 8].try_into().unwrap());
        let (sdna, old, len, count) = if shape.wide {
            (word(4), wide(8), wide(16), wide(24))
        } else {
            (word(16), wide(8), u64::from(word(4)), u64::from(word(20)))
        };
        let start = at + header;
        let len = usize::try_from(len).map_err(|_| truncated())?;
        match start.checked_add(len) {
            Some(end) if end <= bytes.len() => {}
            _ => return Err(truncated()),
        }
        let done = &code == b"ENDB";
        let indexed = (blocks.len() + 1).saturating_mul(INDEXED);
        if indexed > room {
            return Err(refused(
                "blend-too-large",
                format!("blend: indexing this file's blocks needs at least {indexed} bytes, past the {room} bytes of this job's RAM budget (ramBudgetMb) left after unpacking"),
            ));
        }
        blocks.push(Block {
            code,
            sdna: sdna as usize,
            old,
            start,
            len,
            count: count as usize,
        });
        if done {
            return Ok(blocks);
        }
        at = start + len;
    }
}
