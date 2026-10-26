//! `distanceFields.bin` and the manifest's `distanceFields` section.
//!
//! Little-endian: a head (`DISTANCE_FIELD_HEAD_BYTES`) — the magic, the version, the mesh count and
//! a reserved word —, a record per field (`DISTANCE_FIELD_MESH_BYTES`): its compiled mesh — or, a
//! field of an HLOD cell's actors, the cell —, its flags (`DISTANCE_FIELD_FLAG_TWO_SIDED`: mostly
//! two-sided, `DISTANCE_FIELD_FLAG_HLOD_CELL`: an HLOD cell's), its box's low and high corners in
//! metres (six `f32`; the world's space for an HLOD cell's), then one
//! record per mip, finest first (`DISTANCE_FIELD_MIP_BYTES`): the bricks along each axis (three
//! `u32`), the distance scale and bias, the volume-to-virtual-UV scale and add (three `f32` each),
//! the bricks stored, and where the mip's data starts in the file and how long it is (`u32`).
//! After the records, each mesh's mips' data, coarsest first so that the mip always loaded leads:
//! the indirection table (a `u32` per cell, `0xffffffff` where no brick is stored) and the stored
//! bricks, 512 bytes each.
use super::abi::{
    DISTANCE_FIELD_FILE, DISTANCE_FIELD_FLAG_HLOD_CELL, DISTANCE_FIELD_FLAG_TWO_SIDED,
    DISTANCE_FIELD_HEAD_BYTES, DISTANCE_FIELD_MAGIC, DISTANCE_FIELD_MESH_BYTES,
    DISTANCE_FIELD_MIPS, DISTANCE_FIELD_MIP_BYTES, DISTANCE_FIELD_UNITS_PER_METRE,
    DISTANCE_FIELD_VERSION,
};
use super::build::{Field, Mip};
use serde_json::{json, Value};

/// What a field stands for: a compiled mesh, placed wherever the scene places it, or an HLOD cell's
/// actors, placed where the world DAG is.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Owner {
    Mesh(u32),
    HlodCell(u32),
}

impl Owner {
    /// The record's first word and its flag bit.
    fn word_and_flag(self) -> (u32, u32) {
        match self {
            Self::Mesh(mesh) => (mesh, 0),
            Self::HlodCell(cell) => (cell, DISTANCE_FIELD_FLAG_HLOD_CELL),
        }
    }
}

/// A field and what it stands for.
pub(crate) struct Placed {
    pub owner: Owner,
    pub(super) field: Field,
}

impl Placed {
    /// The box the field is built around, in the reference's unit: low and high corner.
    pub(crate) fn bounds(&self) -> ([f64; 3], [f64; 3]) {
        (self.field.low, self.field.high)
    }

    /// The bytes the field holds in memory: each mip's indirection table and stored bricks.
    pub(crate) fn held_bytes(&self) -> usize {
        (self.field.mips.iter())
            .map(|mip| mip.indirection.len() * size_of::<u32>() + mip.voxels.len())
            .sum()
    }
}

fn words(out: &mut Vec<u8>, values: impl IntoIterator<Item = u32>) {
    values
        .into_iter()
        .for_each(|v| out.extend_from_slice(&v.to_le_bytes()));
}

fn floats(out: &mut Vec<u8>, values: impl IntoIterator<Item = f64>) {
    values
        .into_iter()
        .for_each(|v| out.extend_from_slice(&(v as f32).to_le_bytes()));
}

/// The bytes of a mip's data: its indirection table, then its bricks.
fn mip_data(mip: &Mip) -> Vec<u8> {
    let mut data = Vec::with_capacity(mip.indirection.len() * 4 + mip.voxels.len());
    words(&mut data, mip.indirection.iter().copied());
    data.extend_from_slice(&mip.voxels);
    data
}

/// The file holding `fields`.
pub(super) fn encode(fields: &[Placed]) -> Vec<u8> {
    let records = DISTANCE_FIELD_HEAD_BYTES + fields.len() * DISTANCE_FIELD_MESH_BYTES;
    let mut head = Vec::with_capacity(records);
    let mut data: Vec<u8> = Vec::new();
    words(
        &mut head,
        [
            DISTANCE_FIELD_MAGIC,
            DISTANCE_FIELD_VERSION,
            fields.len() as u32,
            0,
        ],
    );
    for placed in fields {
        let field = &placed.field;
        let (word, owner_flag) = placed.owner.word_and_flag();
        let sided = u32::from(field.two_sided) * DISTANCE_FIELD_FLAG_TWO_SIDED;
        words(&mut head, [word, sided | owner_flag]);
        let metres = |v: [f64; 3]| v.map(|c| c / DISTANCE_FIELD_UNITS_PER_METRE);
        floats(
            &mut head,
            metres(field.low).into_iter().chain(metres(field.high)),
        );
        // Coarsest first in the data, finest first in the records.
        let mut at = vec![(0u32, 0u32); field.mips.len()];
        for (index, mip) in field.mips.iter().enumerate().rev() {
            let bytes = mip_data(mip);
            at[index] = ((records + data.len()) as u32, bytes.len() as u32);
            data.extend(bytes);
        }
        for (mip, (offset, length)) in field.mips.iter().zip(at) {
            words(&mut head, mip.bricks.map(|b| b as u32));
            floats(
                &mut head,
                mip.scale_bias
                    .into_iter()
                    .chain(mip.uv_scale)
                    .chain(mip.uv_add),
            );
            words(&mut head, [mip.stored() as u32, offset, length]);
        }
    }
    debug_assert_eq!(head.len(), records);
    head.extend(data);
    head
}

/// The manifest's `distanceFields` section: the file's layout and totals, and every mesh's mips.
pub(super) fn report(fields: &[Placed], bytes: usize) -> Value {
    let mesh = |placed: &Placed| {
        let mips: Vec<Value> = (placed.field.mips.iter())
            .map(|m| json!({"bricks": m.bricks, "stored": m.stored()}))
            .collect();
        let (word, _) = placed.owner.word_and_flag();
        let mut entry = json!({"mesh": word, "twoSided": placed.field.two_sided, "mips": mips});
        // An HLOD cell's field names its cell (`mesh`) and says so.
        if matches!(placed.owner, Owner::HlodCell(_)) {
            entry["hlodCell"] = json!(true);
        }
        entry
    };
    let stored: usize = (fields.iter())
        .flat_map(|f| &f.field.mips)
        .map(Mip::stored)
        .sum();
    json!({"version": DISTANCE_FIELD_VERSION, "file": DISTANCE_FIELD_FILE, "bytes": bytes,
        "headBytes": DISTANCE_FIELD_HEAD_BYTES, "meshBytes": DISTANCE_FIELD_MESH_BYTES,
        "mipBytes": DISTANCE_FIELD_MIP_BYTES, "bricks": stored,
        "meshes": fields.iter().map(mesh).collect::<Vec<_>>()})
}

/// Where a mesh's first mip record starts in its record: after its owner, flags and box.
const FIRST_MIP_AT: usize = 8 + 24;
/// Where a mip's data starts and how long it is, in the mip's record (two words).
const DATA_AT: usize = 12 * 4;

/// Adds to `section` the parts the file is read by: `baseBytes`, the head and the records, read
/// first and whole, `baseSha256` their SHA-256, and `mipSha256`, the SHA-256 of each mip's data —
/// its table and bricks, which are read alone by a Range — in record order, a mesh's mips finest
/// first. A file is read whole where its section lacks them.
pub(super) fn add_parts(section: &mut Value, file: &[u8]) {
    let word = |at: usize| u32::from_le_bytes([file[at], file[at + 1], file[at + 2], file[at + 3]]);
    let count = word(8) as usize;
    let base = DISTANCE_FIELD_HEAD_BYTES + count * DISTANCE_FIELD_MESH_BYTES;
    let mips: Vec<String> = (0..count * DISTANCE_FIELD_MIPS)
        .map(|rank| {
            let (mesh, mip) = (rank / DISTANCE_FIELD_MIPS, rank % DISTANCE_FIELD_MIPS);
            let record = DISTANCE_FIELD_HEAD_BYTES
                + mesh * DISTANCE_FIELD_MESH_BYTES
                + FIRST_MIP_AT
                + mip * DISTANCE_FIELD_MIP_BYTES;
            let (offset, length) = (word(record + DATA_AT), word(record + DATA_AT + 4));
            crate::hash(&file[offset as usize..(offset + length) as usize])
        })
        .collect();
    section["baseBytes"] = json!(base);
    section["baseSha256"] = json!(crate::hash(&file[..base]));
    section["mipSha256"] = json!(mips);
}
