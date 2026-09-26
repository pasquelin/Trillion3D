//! Images of a Blender file: those it designates, and those it carries.
//!
//! An `IM` block holds a path — `//` there designates the file's directory — and, when the author
//! packed the image, a `PackedFile`: the size and the bytes of the original file, as-is. These
//! bytes go into the intermediate-scene binary **untouched**, through a buffer view glTF provides
//! for that: no re-encoding, no second version on disk, and the compiler's image decoder rereads
//! exactly the file the author packed. An image only designated stays named by its path, relative
//! to the served root — the same root as for all drivers, `scene::image_root`.
//!
//! The scene binary the packed images join stays under the job's RAM budget: an image that would
//! take it past is refused by name, never dropped in silence — and so is a mesh.
use super::*;

/// Images already poured, by the address of the block that holds them.
pub(super) struct Images {
    by_block: HashMap<u64, Option<usize>>,
    /// The bytes the scene binary may reach: the job's RAM budget, less the unpacked file.
    pub(super) room: usize,
}

impl Images {
    /// No image poured yet, under this room.
    pub(super) fn within(room: usize) -> Images {
        Images {
            by_block: HashMap::new(),
            room,
        }
    }
    /// The glTF texture rank of this image, poured on first request; a packed image past the
    /// room refuses the scene.
    pub(super) fn texture(
        &mut self,
        image: &At<'_>,
        root: &Path,
        out: &mut Out,
    ) -> Result<Option<usize>> {
        if let Some(known) = self.by_block.get(&image.old) {
            return Ok(*known);
        }
        let found = resolve(image, root, out, self.room)?;
        self.by_block.insert(image.old, found);
        Ok(found)
    }
}

/// Refuses the scene when `adding` bytes more take its binary, `held` bytes so far, past `room`.
pub(super) fn fit(what: &str, adding: usize, held: usize, room: usize) -> Result<()> {
    if held.saturating_add(adding) > room {
        return Err(refused(
            "blend-too-large",
            format!("blend: {what} needs {adding} bytes, and the scene binary already holds {held} of the {room}-byte RAM budget of this job (ramBudgetMb)"),
        ));
    }
    Ok(())
}

fn resolve(image: &At<'_>, root: &Path, out: &mut Out, room: usize) -> Result<Option<usize>> {
    let declared = image.text("name").replace('\\', "/");
    let name = declared
        .rsplit('/')
        .next()
        .filter(|name| !name.is_empty())
        .unwrap_or("image")
        .to_string();
    let Some(mime) = crate::plugins::image::by_extension(Path::new(&name)).map(|d| d.mime()) else {
        out.report.add("blend-image-format");
        out.report
            .notes
            .push(format!("image outside the image register: {name}"));
        return Ok(None);
    };
    if let Some(bytes) = packed(image) {
        fit(
            &format!("packed image {name}"),
            bytes.len(),
            out.bin.bytes.len(),
            room,
        )?;
        let view = out.bin.view(bytes, None);
        return Ok(Some(out.image(
            json!({"name": name, "mimeType": mime, "bufferView": view}),
        )));
    }
    let Some(uri) = linked(&declared, root) else {
        out.report.add("blend-image-outside-source");
        out.report
            .notes
            .push(format!("image outside the served root: {declared}"));
        return Ok(None);
    };
    Ok(Some(out.image(
        json!({"name": name, "mimeType": mime, "uri": uri}),
    )))
}

/// The packed bytes of an image, when it holds some.
fn packed<'a>(image: &At<'a>) -> Option<&'a [u8]> {
    let file = image.follow_as("packedfile", "PackedFile")?;
    let size = usize::try_from(file.int("size", 0)).ok()?;
    if size == 0 {
        return None;
    }
    file.block("data").and_then(|bytes| bytes.get(..size))
}

/// The URI of an image only designated, relative to the served root and escaped like any
/// relative URI reference. An image that lives outside that root has no URI: it is counted, and
/// the scene continues without it.
pub(super) fn linked(declared: &str, root: &Path) -> Option<String> {
    let relative = declared.strip_prefix("//").unwrap_or(declared);
    let path = Path::new(relative);
    let absolute = if path.is_absolute() {
        path.to_path_buf()
    } else {
        root.join(path)
    };
    let under = normalise(&absolute);
    let inside = under.strip_prefix(normalise(root)).ok()?;
    // A glTF URI, not a path: `%`, `#`, space and everything that is not an unreserved character
    // is escaped, or the consumer rereads another name, or nothing.
    Some(crate::uri::encode_relative(inside))
}
