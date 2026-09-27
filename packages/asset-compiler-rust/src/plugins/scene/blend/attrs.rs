//! Named attributes of a mesh, whatever layout the file stores them in.
//!
//! Since Blender 5, a mesh no longer holds its arrays in dedicated fields: it holds an attribute
//! store — a name, a domain (vertex, edge, face, corner), a type and values. `position`,
//! `.corner_vert`, `material_index`, `sharp_face` and the UV layers live there side by side. An
//! attribute can be **single** — one value for the whole domain — rather than an array; the
//! reader says so, and the caller repeats the value.
//!
//! Type and domain identifiers are those the format writes; this reader crosses them with the
//! actual stride of the values, and drops the attribute when the two do not agree.
use super::*;
use std::borrow::Cow;

/// Attribute types this driver keeps, with the number of bytes each occupies.
pub(super) const BOOLEAN: i64 = 0;
pub(super) const INT32: i64 = 3;
pub(super) const FLOAT2: i64 = 6;
pub(super) const FLOAT3: i64 = 7;
/// Domains: vertex, edge, face, face corner.
pub(super) const POINT: i64 = 0;
pub(super) const EDGE: i64 = 1;
pub(super) const FACE: i64 = 2;
pub(super) const CORNER: i64 = 3;
/// Ceiling of the number of attributes read in a mesh: beyond it, the store is not one.
pub(super) const MAX_ATTRIBUTES: usize = 4096;

/// An attribute of the mesh, as it is read.
pub(super) struct Attr<'a> {
    pub(super) domain: i64,
    pub(super) kind: i64,
    /// Borrowed from the file, or repacked from the structures of an older layout.
    pub(super) values: Cow<'a, [u8]>,
    /// The element count: one for a single attribute, which the caller repeats.
    pub(super) count: usize,
    pub(super) single: bool,
}

impl Attr<'_> {
    /// The number of bytes of an element of this type, or nothing if this driver does not read this type.
    pub(super) fn width(kind: i64) -> Option<usize> {
        match kind {
            BOOLEAN => Some(1),
            INT32 => Some(4),
            FLOAT2 => Some(8),
            FLOAT3 => Some(12),
            _ => None,
        }
    }
    /// The float values of the attribute, repeated when it is single.
    pub(super) fn floats(&self, repeat: usize, stride: usize) -> Vec<f32> {
        if self.single {
            return bytes::floats(&self.values, stride).repeat(repeat);
        }
        bytes::floats(&self.values, self.count * stride)
    }
    /// The integers of the attribute, repeated the same way.
    pub(super) fn ints(&self, repeat: usize) -> Vec<i32> {
        if !self.single {
            return bytes::ints(&self.values, self.count);
        }
        vec![bytes::ints(&self.values, 1).first().copied().unwrap_or(0); repeat]
    }
    /// The booleans of the attribute, one byte each.
    pub(super) fn bools(&self, repeat: usize) -> Vec<bool> {
        if self.single {
            return vec![self.values.first().is_some_and(|byte| *byte != 0); repeat];
        }
        self.values
            .iter()
            .take(self.count)
            .map(|byte| *byte != 0)
            .collect()
    }
}

/// The attributes of a mesh, by name: those of the attribute store in the order it declares them,
/// then those of the `CustomData` layers. Each decoder reads only what the file's SDNA describes,
/// so the layout is the file's own; a mesh that holds none yields an empty table, and it is the
/// caller that decides the mesh is then unreadable.
pub(super) fn attributes<'a>(mesh: &At<'a>) -> Vec<(String, Attr<'a>)> {
    let mut out = Vec::new();
    stored(mesh, &mut out);
    layers::attributes(mesh, &mut out);
    out
}

/// The attributes of the store Blender 5 writes.
fn stored<'a>(mesh: &At<'a>, out: &mut Vec<(String, Attr<'a>)>) {
    let Some(storage) = mesh.inner("attribute_storage") else {
        return;
    };
    let announced = storage.int("dna_attributes_num", 0).max(0) as usize;
    let Some((head, held)) = storage.array("dna_attributes") else {
        return;
    };
    for rank in 0..announced.min(held).min(MAX_ATTRIBUTES) {
        let Some(entry) = head.item(rank) else {
            break;
        };
        let name = entry.text("name");
        let kind = entry.int("data_type", -1);
        let Some(width) = Attr::width(kind) else {
            continue;
        };
        let Some(data) = entry.follow("data") else {
            continue;
        };
        let single = data.layout.name == "AttributeSingle";
        let count = if single {
            1
        } else {
            data.int("size", 0).max(0) as usize
        };
        let Some(values) = data.block("data").filter(|bytes| {
            count
                .checked_mul(width)
                .is_some_and(|span| bytes.len() >= span)
        }) else {
            continue;
        };
        out.push((
            name,
            Attr {
                domain: entry.int("domain", -1),
                kind,
                values: Cow::Borrowed(values),
                count,
                single,
            },
        ));
    }
}
