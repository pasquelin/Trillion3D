//! What a `setAttr` writes: which node, which attribute, at which rank, and in which form.
//!
//! The first operand names the attribute — `".t"` on the current node, `"Node.t"` on a named
//! node, `".uvst[0].uvsp[0:3]"` on a slice of a nested array. The last segment's range says
//! **where** to write, and `-type` under which form. Without a type, they are numbers or a
//! boolean. A type off this list is counted: the driver does not guess a form.
use super::*;

/// Path of an attribute as `setAttr` writes it.
pub(super) struct Path {
    /// Named node in front of the dot, when the command names one.
    pub(super) node: Option<String>,
    /// Attribute key: its segments joined by a dot, intermediate-segment indices kept, that
    /// of the last removed — it says where to write, not what.
    pub(super) key: String,
    /// First targeted element, and their count when the range gives one.
    pub(super) first: usize,
    pub(super) count: Option<usize>,
}

/// Splits an attribute path. A path without an attribute segment is not one.
pub(super) fn path(written: &str) -> Option<Path> {
    let mut segments = written.split('.');
    let head = segments.next()?;
    let node = (!head.is_empty()).then(|| head.to_string());
    let mut segments: Vec<&str> = segments.collect();
    let last = segments.pop()?;
    let (name, span) = match last.split_once('[') {
        Some((name, range)) => (name, faces::span(range.trim_end_matches(']'))),
        None => (last, None),
    };
    segments.push(name);
    Some(Path {
        node,
        key: segments.join("."),
        first: span.map_or(0, |(first, _)| first),
        count: span.map(|(_, count)| count),
    })
}

/// Number of numbers an element of this type carries, when the type fixes it.
fn stride(kind: &str) -> Option<usize> {
    Some(match kind {
        "float3" | "double3" | "short3" | "long3" | "int3" => 3,
        "float2" | "double2" | "short2" | "long2" | "int2" => 2,
        "matrix" => 16,
        _ => return None,
    })
}

/// Value a `setAttr` command writes, and the number of numbers per element. Nothing when the
/// requested type is outside those this driver reads.
pub(super) fn value(command: &Command, refused: &mut Vec<&'static str>) -> Option<(Attr, usize)> {
    let kind = command.text(&["typ", "type"]);
    let operands = command.operands.get(1..).unwrap_or_default();
    match kind {
        Some("string") => Some((
            Attr::Texts(
                operands
                    .iter()
                    .map(|token| token.text().to_string())
                    .collect(),
            ),
            1,
        )),
        Some("stringArray" | "componentList") => Some((
            Attr::Texts(
                operands
                    .iter()
                    .skip(1)
                    .map(|token| token.text().to_string())
                    .collect(),
            ),
            1,
        )),
        Some("polyFaces") => {
            let (polygons, counted) = faces::polygons(operands);
            refused.extend(counted);
            Some((Attr::Faces(polygons), 1))
        }
        Some("Int32Array" | "doubleArray" | "floatArray") => {
            Some((numbers(&operands[1.min(operands.len())..]), 1))
        }
        Some(named) => stride(named).map(|stride| (numbers(operands), stride)),
        None => plain(operands),
    }
}

/// A value with no declared type: a boolean written in words, otherwise numbers.
fn plain(operands: &[Token]) -> Option<(Attr, usize)> {
    if let [only] = operands {
        let word = only.text();
        if command::number(word).is_none() {
            return command::boolean(word).map(|flag| (Attr::Flag(flag), 1));
        }
    }
    Some((numbers(operands), 1))
}

/// Numbers of a run of operands. An operand that is not a number does not contribute: a
/// truncated array is shorter, it does not invent a value.
fn numbers(operands: &[Token]) -> Attr {
    Attr::Numbers(
        operands
            .iter()
            .filter_map(|token| command::number(token.text()))
            .collect(),
    )
}

/// Rank of the first targeted number, and the form to pour. The stride comes from the type
/// when it fixes it, otherwise from the number of values written per element of the range.
pub(super) fn slice(path: &Path, value: Attr, stride: usize) -> Option<(usize, Attr)> {
    let width = match (&value, path.count) {
        (Attr::Numbers(values), Some(count)) if stride == 1 && count > 0 => {
            (values.len() % count == 0).then_some(values.len() / count)?
        }
        _ => stride,
    };
    Some((path.first.checked_mul(width)?, value))
}
