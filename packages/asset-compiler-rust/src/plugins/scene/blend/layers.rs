//! Mesh attributes stored before the attribute store: the `CustomData` layers.
//!
//! Until Blender 5, a mesh keeps its arrays as layers of four `CustomData` blocks — one per
//! domain: vertex, edge, face, corner. Since 3.5 a layer is a **named attribute** typed by a
//! property code, its block the bare values: `position`, `.corner_vert`, `material_index`,
//! `sharp_face`, the UV maps. Before, from 2.8 to 3.4, the geometry lives in **structures** —
//! `MVert`, `MEdge`, `MPoly`, `MLoop` — and each UV map in a layer of `MLoopUV`; the reader
//! recognises them by the structure the SDNA gives their block, and repacks the fields it reads
//! into the attributes of the later layouts. Both feed the one mesh path: no second mesh builder.
use super::attrs::{
    Attr, BOOLEAN, CORNER, EDGE, FACE, FLOAT2, FLOAT3, INT32, MAX_ATTRIBUTES, POINT,
};
use super::*;
use std::borrow::Cow;

/// The `CustomData` block of each domain, and the mesh field that counts its elements.
const DOMAINS: [(&str, i64, &str); 4] = [
    ("vdata", POINT, "totvert"),
    ("edata", EDGE, "totedge"),
    ("pdata", FACE, "totpoly"),
    ("ldata", CORNER, "totloop"),
];
/// `MPoly.flag`: the face is smooth.
const SMOOTH: i64 = 1;
/// `MEdge.flag`: the edge is marked sharp.
const SHARP: i64 = 1 << 9;

/// The attribute type a property code names, for the types this driver reads.
fn property(code: i64) -> Option<i64> {
    match code {
        11 => Some(INT32),
        48 => Some(FLOAT3),
        49 => Some(FLOAT2),
        50 => Some(BOOLEAN),
        _ => None,
    }
}

/// Adds the attributes the `CustomData` layers of a mesh carry, in the order they declare them.
pub(super) fn attributes<'a>(mesh: &At<'a>, out: &mut Vec<(String, Attr<'a>)>) {
    for (field, domain, total) in DOMAINS {
        let count = mesh.int(total, 0).max(0) as usize;
        let Some(data) = mesh.inner(field) else {
            continue;
        };
        for layer in items(&data, "totlayer", "layers") {
            let name = layer.text("name");
            if let Some(kind) = property(layer.int("type", -1)) {
                let span = Attr::width(kind).and_then(|width| width.checked_mul(count));
                let Some(values) = layer
                    .block("data")
                    .filter(|bytes| span.is_some_and(|span| bytes.len() >= span))
                else {
                    continue;
                };
                out.push((name, attr(domain, kind, Cow::Borrowed(values), count)));
            } else if let Some((view, held)) = layer.array("data") {
                structures(&view, count.min(held), name, out);
            }
        }
    }
}

/// The entries of a counted array — the layers of a `CustomData` block, the attributes of the
/// store —: as many as `total` announces and the array's block holds, at most `MAX_ATTRIBUTES`.
pub(super) fn items<'a>(data: &At<'a>, total: &str, array: &str) -> impl Iterator<Item = At<'a>> {
    let announced = data.int(total, 0).max(0) as usize;
    let (head, held) = data.array(array).unzip();
    let total = announced.min(held.unwrap_or(0)).min(MAX_ATTRIBUTES);
    (0..total).map_while(move |rank| head?.item(rank))
}

fn attr(domain: i64, kind: i64, values: Cow<'_, [u8]>, count: usize) -> Attr<'_> {
    Attr {
        domain,
        kind,
        values,
        count,
        single: false,
    }
}

/// The bytes of one field in each of the first `count` structures of an array, the field looked
/// up once: a legacy array holds one structure per vertex, edge, face or corner. `count` is at most
/// what the array's block holds.
fn column<'a>(
    view: &At<'a>,
    count: usize,
    name: &str,
) -> Option<(&'a Field, impl Iterator<Item = &'a [u8]>)> {
    let field = view.layout.field(name)?;
    let (size, from) = (view.layout.size, view.base + field.offset);
    let width = field.unit.checked_mul(field.count)?;
    if size == 0 || field.offset.checked_add(width)? > size {
        return None;
    }
    let end = count.checked_mul(size)?.checked_add(view.base)?;
    let bytes = view.file.bytes.get(from..end.max(from))?;
    Some((
        field,
        bytes
            .chunks(size)
            .take(count)
            .map(move |cell| &cell[..width]),
    ))
}

/// The attributes a legacy structure array carries, repacked under the names of the later layouts:
/// a float field copied, an integer widened to `i32`, a flag `bit` kept as whether it equals `set`.
/// `.face_start` is the first corner of each face, which the later layouts store as face offsets.
fn structures<'a>(view: &At<'a>, count: usize, name: String, out: &mut Vec<(String, Attr<'a>)>) {
    let mut add = |name: &str, domain: i64, kind: i64, field: &str, bit: Option<(i64, bool)>| {
        let Some((field, cells)) = column(view, count, field) else {
            return;
        };
        let (float, int) = (field.kind == "float", |cell| {
            bytes::scalar(field, cell).unwrap_or(0)
        });
        let mut values = Vec::with_capacity(count * Attr::width(kind).unwrap_or(0));
        for cell in cells {
            match bit {
                _ if float => values.extend_from_slice(cell),
                Some((bit, set)) => values.push(u8::from((int(cell) & bit != 0) == set)),
                None => values.extend((int(cell) as i32).to_le_bytes()),
            }
        }
        let values = Cow::Owned(values);
        out.push((name.to_string(), attr(domain, kind, values, count)));
    };
    match view.layout.name.as_str() {
        "MVert" => add("position", POINT, FLOAT3, "co", None),
        "MEdge" => add("sharp_edge", EDGE, BOOLEAN, "flag", Some((SHARP, true))),
        "MPoly" => {
            add("material_index", FACE, INT32, "mat_nr", None);
            add("sharp_face", FACE, BOOLEAN, "flag", Some((SMOOTH, false)));
            add(".face_start", FACE, INT32, "loopstart", None);
        }
        "MLoop" => {
            add(".corner_vert", CORNER, INT32, "v", None);
            add(".corner_edge", CORNER, INT32, "e", None);
        }
        "MLoopUV" => add(&name, CORNER, FLOAT2, "uv", None),
        _ => {}
    }
}
