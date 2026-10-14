//! A primitive's triangles as the compiler reads them: its float `POSITION` accessor, and its
//! index list — an unsigned `SCALAR` accessor of whole triangles, or the positions in order when
//! the primitive has none.
use super::*;
use crate::gltf_codes::{FLOAT, INDEX_COMPONENTS};

/// The positions accessor of primitive `p`, its index list and its triangle count.
pub(super) fn read<'a>(
    g: &'a Value,
    bin: &'a [u8],
    p: &Value,
    validated: &BTreeSet<usize>,
) -> Result<(Accessor<'a>, Vec<u32>, usize)> {
    let positions = accessor(
        g,
        bin,
        required_index(
            p.get("attributes")
                .and_then(Value::as_object)
                .and_then(|a| a.get("POSITION")),
            "primitive.attributes.POSITION",
        )?,
        Some(validated),
    )?;
    if positions.width != 3 || positions.component != FLOAT {
        return Err(invalid("POSITION must be float VEC3"));
    }
    let (index_values, triangle_count) = if p.get("indices").is_some() {
        let ids = accessor(
            g,
            bin,
            required_index(p.get("indices"), "primitive.indices")?,
            Some(validated),
        )?;
        if ids.width != 1 || ids.normalized || !INDEX_COMPONENTS.contains(&ids.component) {
            return Err(invalid("indices component must be unsigned SCALAR"));
        }
        if ids.count == 0 || ids.count % 3 != 0 {
            return Err(CompilerError::new(
                "INVALID_TRIANGLES",
                "Index count must be a positive multiple of three",
            ));
        }
        (ids.collect_u32()?, ids.count / 3)
    } else {
        if positions.count == 0 || positions.count % 3 != 0 {
            return Err(invalid(
                "Unindexed POSITION count must be a positive multiple of three",
            ));
        }
        ((0..positions.count as u32).collect(), positions.count / 3)
    };
    Ok((positions, index_values, triangle_count))
}
