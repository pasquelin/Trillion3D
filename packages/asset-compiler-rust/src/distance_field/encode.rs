//! `distanceFields.bin` and the manifest's `distanceFields` section.
//!
//! Little-endian: a head (`DISTANCE_FIELD_HEAD_BYTES`) — the magic, the version, the mesh count and
//! a reserved word —, a record per mesh (`DISTANCE_FIELD_MESH_BYTES`): its compiled mesh, its
//! flags (bit 0: mostly two-sided), its box's low and high corners in metres (six `f32`), then one
//! record per mip, finest first (`DISTANCE_FIELD_MIP_BYTES`): the bricks along each axis (three
//! `u32`), the distance scale and bias, the volume-to-virtual-UV scale and add (three `f32` each),
//! the bricks stored, and where the mip's data starts in the file and how long it is (`u32`).
//! After the records, each mesh's mips' data, coarsest first so that the mip always loaded leads:
//! the indirection table (a `u32` per cell, `0xffffffff` where no brick is stored) and the stored
//! bricks, 512 bytes each.
use super::abi::{
    DISTANCE_FIELD_FILE, DISTANCE_FIELD_HEAD_BYTES, DISTANCE_FIELD_MAGIC,
    DISTANCE_FIELD_MESH_BYTES, DISTANCE_FIELD_MIP_BYTES, DISTANCE_FIELD_UNITS_PER_METRE,
    DISTANCE_FIELD_VERSION,
};
use super::build::{Field, Mip};
use serde_json::{json, Value};

/// A mesh's field, by its compiled mesh.
pub(super) struct Placed {
    pub mesh: u32,
    pub field: Field,
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
        words(&mut head, [placed.mesh, u32::from(field.two_sided)]);
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
        json!({"mesh": placed.mesh, "twoSided": placed.field.two_sided, "mips": mips})
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
