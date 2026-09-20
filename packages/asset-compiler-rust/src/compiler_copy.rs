use super::*;
use compiler_source_extend::{append_to_source_bin, CoarseVertices, ExtensionViews};

/// The cache folder of this compilation, and the object store beside it, created.
pub(super) fn cache_directory(o: &Options, key: &str) -> Result<PathBuf> {
    let directory = o.cache.join("native").join(&o.scope).join(key);
    fs::create_dir_all(directory.join("pages"))?;
    fs::create_dir_all(o.cache.join("native").join("objects"))?;
    Ok(directory)
}

/// Writes `source.bin`: the buffer views the compiled scene keeps, in their order, then the
/// vertex buffer of every primitive the DAG rewrote. Returns the buffer length, the output
/// views, and the accessors the rewritten primitives read.
pub(super) fn copy_source_bin(
    o: &Options,
    bin: &[u8],
    view_values: &[Value],
    views: &BTreeSet<usize>,
    directory: &Path,
    coarse: &[CoarseVertices],
) -> Result<(usize, Vec<Value>, Vec<ExtensionViews>)> {
    let temp = directory.join("source.bin.tmp");
    let mut writer = BufWriter::new(File::create(&temp)?);
    let mut offset = 0;
    let mut output_views = Vec::new();
    for id in views {
        check(o)?;
        let mut v = item(view_values, *id, "bufferView")?.clone();
        if optional_index(v.get("buffer"), "bufferView.buffer", 0)? != 0 {
            return Err(CompilerError::new(
                "UNSUPPORTED_ACCESSOR",
                "Multiple buffers are unsupported",
            ));
        }
        let padding = crate::shared_math::pad_to_4(offset);
        writer.write_all(&[0u8; 3][..padding])?;
        offset += padding;
        let start = optional_index(v.get("byteOffset"), "bufferView.byteOffset", 0)?;
        let len = required_index(v.get("byteLength"), "bufferView.byteLength")?;
        let end = start
            .checked_add(len)
            .ok_or_else(|| invalid("bufferView range overflow"))?;
        writer.write_all(bin.get(start..end).ok_or_else(|| {
            CompilerError::new("BUFFER_OUT_OF_BOUNDS", "bufferView exceeds binary buffer")
        })?)?;
        v["byteOffset"] = json!(offset);
        offset += len;
        output_views.push(v);
    }
    let extension = append_to_source_bin(&mut writer, &mut offset, &mut output_views, coarse)?;
    writer.flush()?;
    drop(writer);
    fs::rename(temp, directory.join("source.bin"))?;
    Ok((offset, output_views, extension))
}
