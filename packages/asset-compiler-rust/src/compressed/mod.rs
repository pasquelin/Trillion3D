//! Decode glTF transport compression once, before the existing accessor pipeline.
use crate::*;
mod draco;
mod meshopt;
const MESHOPT: &str = "EXT_meshopt_compression";
const DRACO: &str = "KHR_draco_mesh_compression";

pub(crate) struct Budget<'a> {
    pub limit: usize,
    pub cancelled: &'a AtomicBool,
}
impl Budget<'_> {
    pub fn admit(&self, bytes: usize) -> Result<()> {
        if self.cancelled.load(Ordering::Relaxed) {
            return Err(CompilerError::new("CANCELLED", "Compilation cancelled"));
        }
        if bytes > self.limit {
            return Err(CompilerError::new(
                "RAM_ADMISSION_BUDGET_EXCEEDED",
                "Compressed glTF expansion exceeds the import budget",
            ));
        }
        Ok(())
    }
}
fn add(a: usize, b: usize) -> Result<usize> {
    a.checked_add(b)
        .ok_or_else(|| invalid("Compressed glTF size overflow"))
}
fn product(a: usize, b: usize) -> Result<usize> {
    a.checked_mul(b)
        .ok_or_else(|| invalid("Compressed glTF size overflow"))
}
/// A missing fallback buffer is legal only when every view using it is compressed.
pub(crate) fn placeholder(g: &Value, buffer: usize) -> bool {
    let Some(views) = g.get("bufferViews").and_then(Value::as_array) else {
        return false;
    };
    let mut used = false;
    for view in views {
        if view.get("buffer").and_then(Value::as_u64) == Some(buffer as u64) {
            used = true;
            if view
                .get("extensions")
                .and_then(|v| v.get(MESHOPT))
                .is_none()
            {
                return false;
            }
        }
    }
    used
}
fn source_range(
    g: &Value,
    offsets: &[usize],
    ext: &Value,
    bytes: usize,
) -> Result<std::ops::Range<usize>> {
    let id = required_index(ext.get("buffer"), "compression.buffer")?;
    let buffer = item(values(g, "buffers")?, id, "compression.buffer")?;
    let start = optional_index(ext.get("byteOffset"), "compression.byteOffset", 0)?;
    let length = required_index(ext.get("byteLength"), "compression.byteLength")?;
    let end = add(start, length)?;
    if end > required_index(buffer.get("byteLength"), "buffer.byteLength")? {
        return Err(invalid("Compressed source exceeds its buffer"));
    }
    let base = *offsets
        .get(id)
        .ok_or_else(|| invalid("Compressed buffer is out of bounds"))?;
    if base == usize::MAX {
        return Err(invalid(
            "Compressed source references an absent fallback buffer",
        ));
    }
    let range = add(base, start)?..add(base, end)?;
    if range.end > bytes {
        return Err(invalid("Compressed source exceeds binary bytes"));
    }
    Ok(range)
}
pub(crate) use meshopt::expand as meshopt_views;

pub(crate) fn draco_primitives(
    g: &mut Value,
    binary: Binary,
    budget: &Budget<'_>,
) -> Result<Binary> {
    let binary = draco::expand(g, binary, budget)?;
    for field in ["extensionsUsed", "extensionsRequired"] {
        if let Some(names) = g.get_mut(field).and_then(Value::as_array_mut) {
            names.retain(|name| !matches!(name.as_str(), Some(MESHOPT | DRACO)));
        }
    }
    Ok(binary)
}

#[cfg(test)]
mod container_tests;
#[cfg(test)]
mod filter_tests;
#[cfg(test)]
mod tests;
