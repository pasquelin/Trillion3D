//! VOX's transform/group/shape hierarchy, including shared model references.
use super::*;
mod emit;
pub(super) use emit::emit;
pub(super) enum Kind {
    Transform { child: i32, layer: i32, frame: Dict },
    Group(Vec<i32>),
    Shape(usize),
}
pub(super) struct Node {
    pub attrs: Dict,
    pub kind: Kind,
}
impl Node {
    pub(super) fn children(&self) -> &[i32] {
        match &self.kind {
            Kind::Transform { child, .. } => std::slice::from_ref(child),
            Kind::Group(children) => children,
            Kind::Shape(_) => &[],
        }
    }
}
pub(super) fn read_node(tag: &[u8], r: &mut Reader<'_>, doc: &mut Document) -> Result<()> {
    doc.budget.charge(2048)?;
    let id = r.i32()?;
    let attrs = r.dict(&mut doc.budget)?;
    let kind = match tag {
        b"nTRN" => {
            let child = r.i32()?;
            if r.i32()? != -1 {
                return Err(source::invalid("vox", "transform reserved field"));
            }
            let layer = r.i32()?;
            if r.u32()? != 1 {
                return Err(source::unsupported("vox", "animated transforms"));
            }
            Kind::Transform {
                child,
                layer,
                frame: r.dict(&mut doc.budget)?,
            }
        }
        b"nGRP" => {
            let count = r.u32()? as usize;
            if count > r.remaining() / 4 {
                return Err(source::invalid("vox", "group count exceeds chunk"));
            }
            doc.budget.charge(count.saturating_mul(64))?;
            let mut children = Vec::with_capacity(count);
            for _ in 0..count {
                children.push(r.i32()?);
            }
            Kind::Group(children)
        }
        _ => {
            if r.u32()? != 1 {
                return Err(source::unsupported("vox", "animated shapes"));
            }
            let model = r.u32()? as usize;
            let properties = r.dict(&mut doc.budget)?;
            if properties.get("_f").is_some_and(|v| v != "0") {
                return Err(source::unsupported("vox", "nonzero shape frame"));
            }
            Kind::Shape(model)
        }
    };
    if id < 0 || doc.nodes.insert(id, Node { attrs, kind }).is_some() {
        return Err(source::invalid("vox", "invalid or duplicate node ID"));
    }
    Ok(())
}
pub(super) fn matrix(frame: &Dict) -> Result<[f64; 16]> {
    if frame.get("_f").is_some_and(|v| v != "0") {
        return Err(source::unsupported("vox", "nonzero transform frame"));
    }
    let code = frame
        .get("_r")
        .map(|v| v.parse::<u8>())
        .transpose()
        .map_err(|_| source::invalid("vox", "rotation byte"))?
        .unwrap_or(4);
    let (a, b) = ((code & 3) as usize, ((code >> 2) & 3) as usize);
    if code & 128 != 0 || a >= 3 || b >= 3 || a == b {
        return Err(source::invalid("vox", "rotation axes"));
    }
    let axes = [a, b, 3 - a - b];
    let mut matrix = [0.0; 16];
    for row in 0..3 {
        matrix[axes[row] * 4 + row] = if code & (16 << row) == 0 { 1.0 } else { -1.0 };
    }
    matrix[15] = 1.0;
    if let Some(text) = frame.get("_t") {
        let mut coords = text.split_whitespace();
        for index in 0..3 {
            let value = coords
                .next()
                .ok_or_else(|| source::invalid("vox", "translation triple"))?;
            matrix[12 + index] = value
                .parse::<i32>()
                .map_err(|_| source::invalid("vox", "translation integer"))?
                as f64;
        }
        if coords.next().is_some() {
            return Err(source::invalid("vox", "translation triple"));
        }
    }
    Ok(matrix)
}
