use super::*;
use crate::gltf_codes::FLOAT;

/// The reader of accessor `id`, from its one parse (`accessor_validation::layout`). `validated`
/// holds the identifiers an upstream pass already validated — the deduplicated set from
/// `plan_buffers` — whose checks are not run twice; `None` requests them.
pub(super) fn accessor<'a>(
    g: &'a Value,
    bin: &'a [u8],
    id: usize,
    validated: Option<&BTreeSet<usize>>,
) -> Result<Accessor<'a>> {
    let check = !validated.is_some_and(|ids| ids.contains(&id));
    let layout = accessor_validation::layout(g, bin, id, check)?;
    if layout.normalized && layout.component == FLOAT {
        return Err(invalid("FLOAT accessor cannot be normalized"));
    }
    let width = match layout.shape {
        (1, rows) => rows,
        // A skin's inverse bind matrices: sixteen floats, no column padding.
        (4, 4) if layout.component == FLOAT => 16,
        _ => {
            return Err(CompilerError::new(
                "UNSUPPORTED_ACCESSOR_TYPE",
                "Unsupported or missing accessor type",
            ))
        }
    };
    let sparse = layout.sparse.map(|sparse| SparseAccessor {
        count: sparse.count,
        indices_bin: bin,
        indices_offset: sparse.indices_offset,
        indices_component: sparse.indices_component,
        values_bin: bin,
        values_offset: sparse.values_offset,
    });
    Ok(Accessor {
        bin,
        base: layout.base.unwrap_or(0),
        stride: layout.stride,
        count: layout.count,
        component: layout.component,
        bytes: layout.bytes,
        width,
        normalized: layout.normalized,
        has_buffer_view: layout.base.is_some(),
        sparse,
    })
}
