//! Faces of a mesh, as `.fc` and component lists write them.
//!
//! A Maya face does not cite its vertices: it cites its **edges**, signed. A positive index `i`
//! walks edge `i` from its first to its second vertex; the writing `-(i + 1)` walks it backwards.
//! The corner of rank `k` of a face is therefore the start vertex of its `k`-th edge, and it is
//! `.ed` that names them. A `mu` record gives, in the same order, the UV ranks of those corners;
//! `h` opens a hole, `mf` and `mc` carry per-corner normals and colours that this driver does not
//! read. Any record outside this list is counted by name.
use super::*;

/// A polygonal face: its signed edges, and the UV ranks of its corners.
#[derive(Clone, Default)]
pub(super) struct Face {
    pub(super) edges: Vec<i64>,
    pub(super) uvs: Vec<i64>,
    /// UV set that `mu` names. Only the first is carried by the intermediate scene.
    pub(super) uv_set: i64,
    /// The face declares a hole: a fan from its first corner would fill it.
    pub(super) hole: bool,
}

/// Faces a `setAttr -type "polyFaces"` writes, and what the report must count of them.
pub(super) fn polygons(operands: &[Token]) -> (Vec<Face>, Vec<&'static str>) {
    let mut out: Vec<Face> = Vec::new();
    let mut counted = Vec::new();
    let mut words = operands.iter().map(Token::text).peekable();
    while let Some(record) = words.next() {
        match record {
            "f" => out.push(Face {
                edges: indices(&mut words),
                ..Face::default()
            }),
            "mu" => {
                let set = words.next().and_then(|word| word.parse::<i64>().ok());
                let uvs = indices(&mut words);
                match (out.last_mut(), set) {
                    (Some(face), Some(set)) => {
                        face.uv_set = set;
                        face.uvs = uvs;
                    }
                    _ => counted.push(report::UV_DROPPED),
                }
            }
            "h" => {
                let _ = indices(&mut words);
                match out.last_mut() {
                    Some(face) => face.hole = true,
                    None => counted.push(report::FACE_INVALID),
                }
            }
            "mf" | "mc" | "fc" => {
                let _ = indices(&mut words);
            }
            _ => counted.push(report::FACE_RECORD_IGNORED),
        }
    }
    (out, counted)
}

/// Indices of a record: a count, then that many integers. A missing or absurd count consumes
/// nothing, which stops reading the record instead of letting it drift.
fn indices<'a>(words: &mut std::iter::Peekable<impl Iterator<Item = &'a str>>) -> Vec<i64> {
    let Some(count) = words.peek().and_then(|word| word.parse::<usize>().ok()) else {
        return Vec::new();
    };
    words.next();
    let mut out = Vec::with_capacity(count.min(MAX_ELEMENTS));
    for _ in 0..count.min(MAX_ELEMENTS) {
        match words.peek().and_then(|word| word.parse::<i64>().ok()) {
            Some(value) => {
                words.next();
                out.push(value);
            }
            None => break,
        }
    }
    out
}

/// Faces a component list names, and the number of entries that name none. Maya writes `f[3]`
/// for a face and `f[0:2]` for a range; a vertex or an edge — `vtx`, `e`, `map` — says nothing
/// of a face and is counted rather than guessed.
pub(super) fn components(list: &[String]) -> (Vec<usize>, usize) {
    let mut out = Vec::new();
    let mut refused = 0;
    for entry in list {
        let Some(range) = entry
            .strip_prefix("f[")
            .and_then(|rest| rest.strip_suffix(']'))
        else {
            refused += 1;
            continue;
        };
        match span(range) {
            Some((first, count)) => out.extend(first..first.saturating_add(count)),
            None => refused += 1,
        }
    }
    (out, refused)
}

/// First element of a range `a:b` or of a lone index `a`, and the number of elements.
pub(super) fn span(range: &str) -> Option<(usize, usize)> {
    let (first, last) = match range.split_once(':') {
        Some((first, last)) => (
            first.trim().parse::<usize>().ok()?,
            last.trim().parse::<usize>().ok()?,
        ),
        None => {
            let only = range.trim().parse::<usize>().ok()?;
            (only, only)
        }
    };
    (last >= first && last < MAX_ELEMENTS).then(|| (first, last - first + 1))
}
