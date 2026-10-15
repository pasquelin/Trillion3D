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
use crate::gltf_codes::REPEAT;
use crate::import::tables::media::relative_under;

/// Images already poured, by the address of the block that holds them.
#[derive(Default)]
pub(super) struct Images {
    by_block: HashMap<u64, Option<usize>>,
}

impl Images {
    /// The glTF texture rank of this image, poured on first request; a packed image past the
    /// scene binary's room refuses the scene.
    pub(super) fn texture(
        &mut self,
        image: &At<'_>,
        root: &Path,
        out: &mut Out,
    ) -> Result<Option<usize>> {
        if let Some(known) = self.by_block.get(&image.old) {
            return Ok(*known);
        }
        let found = resolve(image, root, out)?;
        self.by_block.insert(image.old, found);
        Ok(found)
    }
}

fn resolve(image: &At<'_>, root: &Path, out: &mut Out) -> Result<Option<usize>> {
    let declared = image.text("name").replace('\\', "/");
    let name = declared
        .rsplit('/')
        .next()
        .filter(|name| !name.is_empty())
        .unwrap_or("image")
        .to_string();
    let Some(mime) = crate::plugins::image::by_extension(Path::new(&name)).map(|d| d.mime()) else {
        out.scene.report.add("blend-image-format");
        out.scene
            .report
            .notes
            .push(format!("image outside the image register: {name}"));
        return Ok(None);
    };
    // Blender repeats its textures by default, and this driver does not read the coordinate
    // nodes that would say otherwise.
    if let Some(bytes) = packed(image) {
        out.fit(
            "packed image",
            &name,
            out.scene.bin.bytes.len(),
            bytes.len(),
        )?;
        let image = out.scene.image_embedded(&name, mime, bytes);
        let sampler = out.scene.sampler_uv(REPEAT, REPEAT);
        return Ok(Some(out.scene.texture(image, sampler)));
    }
    let Some(relative) = linked(&declared, root) else {
        out.scene.report.add("blend-image-outside-source");
        out.scene
            .report
            .notes
            .push(format!("image outside the served root: {declared}"));
        return Ok(None);
    };
    let image = out.scene.image(relative, mime);
    let sampler = out.scene.sampler_uv(REPEAT, REPEAT);
    Ok(Some(out.scene.texture(image, sampler)))
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

/// The path of an image only designated, relative to the served root (`relative_under`): `//`
/// there names the file's directory. An image that lives outside that root has no path: it is
/// counted, and the scene continues without it.
pub(super) fn linked(declared: &str, root: &Path) -> Option<String> {
    let relative = declared.strip_prefix("//").unwrap_or(declared);
    relative_under(root, &root.join(relative))
}
