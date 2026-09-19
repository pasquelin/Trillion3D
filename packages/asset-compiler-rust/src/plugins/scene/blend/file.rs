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
use super::*;

/// The header length of a sixty-four-bit-field block.
const WIDE_HEADER: usize = 32;

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

/// An open Blender file: its unpacked bytes, its SDNA, its blocks and their index by address.
pub(super) struct BlendFile {
    pub(super) bytes: Vec<u8>,
    pub(super) version: u32,
    pub(super) blocks: Vec<Block>,
    pub(super) dna: Dna,
    index: HashMap<u64, usize>,
}

impl BlendFile {
    /// Opens a Blender file: undoes the wrapping under `ceiling`, reads the header, walks the
    /// blocks, then the `DNA1` block that describes all the structures.
    pub(super) fn open(raw: &[u8], ceiling: usize) -> Result<BlendFile> {
        let bytes = envelope::unwrap(raw, ceiling)?;
        let shape = envelope::head(&bytes)?;
        let blocks = walk(&bytes, &shape)?;
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
        })
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

/// Walks the blocks from the end of the header until `ENDB`.
fn walk(bytes: &[u8], shape: &envelope::Shape) -> Result<Vec<Block>> {
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
