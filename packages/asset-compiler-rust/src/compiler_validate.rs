use super::*;

pub(super) fn invalid(message: impl Into<String>) -> CompilerError {
    CompilerError::new("INVALID_GLTF", message)
}
impl CompilerError {
    /// The same refusal, naming the source glTF mesh and primitive it was raised in: page ids
    /// restart at 0 in every primitive, so a page named alone is ambiguous in a cook of several.
    pub(super) fn within(mut self, mesh: &usize, primitive: &usize) -> Self {
        self.message = format!("glTF mesh {mesh} primitive {primitive}: {}", self.message);
        self
    }
}
pub(super) fn required_index(v: Option<&Value>, field: &str) -> Result<usize> {
    let raw = v
        .and_then(Value::as_u64)
        .ok_or_else(|| invalid(format!("{field} must be an unsigned integer")))?;
    usize::try_from(raw).map_err(|_| invalid(format!("{field} is too large")))
}
pub(super) fn optional_index(v: Option<&Value>, field: &str, default: usize) -> Result<usize> {
    match v {
        Some(value) => required_index(Some(value), field),
        None => Ok(default),
    }
}
pub(super) fn values<'a>(g: &'a Value, field: &str) -> Result<&'a Vec<Value>> {
    g.get(field)
        .and_then(Value::as_array)
        .ok_or_else(|| invalid(format!("{field} array is required")))
}
pub(super) fn item<'a>(items: &'a [Value], id: usize, field: &str) -> Result<&'a Value> {
    items
        .get(id)
        .ok_or_else(|| invalid(format!("{field} index {id} is out of bounds")))
}
pub(super) fn hash(b: &[u8]) -> String {
    format!("{:x}", Sha256::digest(b))
}
pub(super) fn hash_file(p: &Path) -> Result<String> {
    Ok(hash_file_read(p)?.0)
}
/// File fingerprint and last byte, from a single read pass: a caller wanting to
/// know how file ends does not have to re-open it afterwards. `None` for empty file.
pub(super) fn hash_file_tail(p: &Path) -> Result<(String, Option<u8>)> {
    let (sha256, last, _) = hash_file_read(p)?;
    Ok((sha256, last))
}
/// File fingerprint and size from the same pass: a proof of thousands of objects
/// does not stat each one after reading it.
pub(super) fn hash_file_sized(p: &Path) -> Result<(String, u64)> {
    let (sha256, _, bytes) = hash_file_read(p)?;
    Ok((sha256, bytes))
}
fn hash_file_read(p: &Path) -> Result<(String, Option<u8>, u64)> {
    hash_open(File::open(p)?)
}
/// Fingerprint, last byte and size of an open file: a caller that opened it
/// itself, to read its absence from the open, hashes it from here.
pub(super) fn hash_open(mut f: File) -> Result<(String, Option<u8>, u64)> {
    let mut h = Sha256::new();
    let mut block = [0u8; 65536];
    let mut last = None;
    let mut bytes = 0u64;
    loop {
        let n = f.read(&mut block)?;
        if n == 0 {
            break;
        }
        h.update(&block[..n]);
        last = Some(block[n - 1]);
        bytes += n as u64;
    }
    Ok((format!("{:x}", h.finalize()), last, bytes))
}
pub(super) fn is_safe_source_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() < 256
        && name != "."
        && name != ".."
        && !name.contains('/')
        && !name.contains('\\')
        && !name.contains("..")
        && !name.contains('\0')
}
/// Resource path under served root, sanitized. An absolute path, path naming
/// a volume, or with unsafe filename segment — climbing above
/// root — has none: resource counted missing rather than read out of source folder.
/// `separators` specifies segment separators in original format.
pub(super) fn safe_relative(file: &str, separators: &[char]) -> Option<String> {
    if file.starts_with('/') || file.contains(':') {
        return None;
    }
    let mut parts: Vec<&str> = Vec::new();
    for part in file
        .split(separators)
        .filter(|part| !part.is_empty() && *part != ".")
    {
        if !is_safe_source_name(part) {
            return None;
        }
        parts.push(part);
    }
    (!parts.is_empty()).then(|| parts.join("/"))
}

pub(super) fn triangle_fingerprint<'a>(triangles: impl Iterator<Item = &'a [u32]>) -> u64 {
    let mut total = 0u64;
    for tri in triangles {
        let mut corners = [tri[0], tri[1], tri[2]];
        corners.sort_unstable();
        let mut hash = 0x9e37_79b9_7f4a_7c15u64;
        for corner in corners {
            hash = (hash ^ corner as u64).wrapping_mul(0x100_0000_01b3);
            hash ^= hash >> 29;
        }
        total = total.wrapping_add(hash);
    }
    total
}

pub(super) fn validate_compile_options(o: &Options) -> Result<()> {
    if !["slice", "full"].contains(&o.scope.as_str())
        || o.triangle_budget == 0
        || o.threads == 0
        || o.threads > 64
        || o.ram_budget_mb < 64
        || o.resource_base.is_empty()
        || !["none", "qem-endpoints"].contains(&o.simplification.as_str())
    {
        return Err(CompilerError::new(
            "INVALID_OPTIONS",
            "scope, budgets, threads, resource_base and simplification must be valid",
        ));
    }
    Ok(())
}
