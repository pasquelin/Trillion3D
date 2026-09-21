use super::*;

/// What the scene declares, validated: the layout the compiled scene is written in
/// (`compiler_references.rs`), the primitives to compile and what compiling them will cost.
pub(super) struct BufferPlan {
    pub layout: SourceLayout,
    pub jobs: Vec<(usize, usize)>,
    pub estimated_working_bytes: usize,
}

/// Bytes an accessor will occupy once decoded into a dense array: `count` elements
/// of `components` four-byte values. An accessor without a `bufferView`, or whose
/// sparse carries only a few values, expands the same way: that expansion is what
/// an allocation will request, never the stored bytes, and it alone can overflow
/// an integer.
fn dense_bytes(acc: &Value) -> Result<usize> {
    let components = match acc.get("type").and_then(Value::as_str) {
        Some("SCALAR") => 1,
        Some("VEC2") => 2,
        Some("VEC3") => 3,
        Some("VEC4") | Some("MAT2") => 4,
        Some("MAT3") => 9,
        Some("MAT4") => 16,
        _ => return Err(invalid("Unsupported accessor type")),
    };
    required_index(acc.get("count"), "accessor.count")?
        .checked_mul(components)
        .and_then(|values| values.checked_mul(4))
        .ok_or_else(|| invalid("Working set overflow"))
}

pub(super) fn plan_buffers(
    o: &Options,
    g: &Value,
    bin: &[u8],
    g_bytes: &[u8],
    meshes: &BTreeSet<usize>,
) -> Result<BufferPlan> {
    let mesh_values = values(g, "meshes")?;
    let accessor_values = values(g, "accessors")?;
    let view_values = values(g, "bufferViews")?;
    let (accessors, jobs) = referenced_accessors(g, meshes)?;
    for id in &accessors {
        accessor_validation::validate(g, bin, *id)?;
    }
    let mut decoded_bytes = 0usize;
    for a in &accessors {
        decoded_bytes = decoded_bytes
            .checked_add(dense_bytes(item(accessor_values, *a, "accessor")?)?)
            .ok_or_else(|| invalid("Working set overflow"))?;
    }
    let layout = SourceLayout::of(g, accessors)?;
    let views = &layout.views;
    let mut estimated_working_bytes = g_bytes
        .len()
        .saturating_mul(2)
        .saturating_add(o.threads.saturating_mul(1024 * 1024));
    for id in views {
        estimated_working_bytes = estimated_working_bytes
            .checked_add(required_index(
                item(view_values, *id, "bufferView")?.get("byteLength"),
                "bufferView.byteLength",
            )?)
            .ok_or_else(|| invalid("Working set overflow"))?;
    }
    for (old, primitive) in &jobs {
        let p = item(
            values(item(mesh_values, *old, "mesh")?, "primitives")?,
            *primitive,
            "primitive",
        )?;
        let count = primitive_triangles(g, p)?
            .checked_mul(3)
            .ok_or_else(|| invalid("Working set overflow"))?;
        estimated_working_bytes = estimated_working_bytes
            .checked_add(
                count
                    .checked_mul(4)
                    .ok_or_else(|| invalid("Working set overflow"))?,
            )
            .ok_or_else(|| invalid("Working set overflow"))?;
    }
    estimated_working_bytes = estimated_working_bytes
        .checked_add(bin.len())
        .and_then(|total| total.checked_add(decoded_bytes))
        .ok_or_else(|| invalid("Working set overflow"))?;
    if estimated_working_bytes
        > o.ram_budget_mb
            .checked_mul(1024 * 1024)
            .ok_or_else(|| invalid("RAM budget overflow"))?
    {
        return Err(CompilerError::new(
            "RAM_ADMISSION_BUDGET_EXCEEDED",
            "Estimated working set exceeds configured budget",
        ));
    }
    Ok(BufferPlan {
        layout,
        jobs,
        estimated_working_bytes,
    })
}
