//! `distanceFields.bin` and the manifest's `distanceFields` section.
//!
//! Little-endian: a head (`DISTANCE_FIELD_HEAD_BYTES`) — the magic, the version, the mesh count and
//! a reserved word —, a record per field (`DISTANCE_FIELD_MESH_BYTES`): its compiled mesh — or, a
//! field of an HLOD cell's actors, the cell —, its flags (`DISTANCE_FIELD_FLAG_TWO_SIDED`: mostly
//! two-sided, `DISTANCE_FIELD_FLAG_HLOD_CELL`: an HLOD cell's), its box's low and high corners in
//! metres (six `f32`; the world's space for an HLOD cell's), then one
//! record per mip, finest first (`DISTANCE_FIELD_MIP_BYTES`): the bricks along each axis (three
//! `u32`), the distance scale and bias, the volume-to-virtual-UV scale and add (three `f32` each),
//! the bricks stored, and where the mip's data starts in its object — its first byte, zero — and
//! how long it is (`u32`). The file ends with the records: each mip's data is an object of its own
//! (`write_distance_fields`), read whole when the atlas takes the mip in and sent compressed like
//! every object: the indirection table (a `u32` per cell, `0xffffffff` where no brick is stored)
//! and the stored bricks, 512 bytes each.
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

/// The file holding `fields` — its head and records — and each mip's data, in record order (a
/// mesh's mips finest first): each an object of its own, which its record names from its first
/// byte.
pub(super) fn encode(fields: &[Placed]) -> (Vec<u8>, Vec<Vec<u8>>) {
    let records = DISTANCE_FIELD_HEAD_BYTES + fields.len() * DISTANCE_FIELD_MESH_BYTES;
    let mut head = Vec::with_capacity(records);
    let mut data = Vec::with_capacity(fields.len() * DISTANCE_FIELD_MIPS);
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
        for mip in &field.mips {
            let bytes = mip_data(mip);
            let length = bytes.len() as u32;
            data.push(bytes);
            words(&mut head, mip.bricks.map(|b| b as u32));
            floats(
                &mut head,
                mip.scale_bias
                    .into_iter()
                    .chain(mip.uv_scale)
                    .chain(mip.uv_add),
            );
            words(&mut head, [mip.stored() as u32, 0, length]);
        }
    }
    debug_assert_eq!(head.len(), records);
    (head, data)
}

/// The manifest's `distanceFields` section: the file's layout and totals, every mesh's mips, and
/// the objects holding the mips' data in record order (`mips`, the descriptors `objects` lists).
pub(super) fn report(fields: &[Placed], bytes: usize, objects: Vec<Value>) -> Value {
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
        "meshes": fields.iter().map(mesh).collect::<Vec<_>>(), "mips": objects})
}
