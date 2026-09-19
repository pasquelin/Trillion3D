//! A Maya `file` node into a glTF texture.
//!
//! The driver decodes nothing itself: it names the image by its URI, relative to the root where
//! the compiler will reread those same bytes, and leaves the image registry to say whether this
//! format reads. A missing image, outside the source directory or outside the registry is
//! counted in the report, and the scene continues without it — never a compilation failure.
//!
//! Maya often writes an absolute path of the machine that exported. That path does not exist
//! here, and following it would leave the served directory: only its file name is kept, looked
//! up at the image root then in `sourceimages`, the folder Maya gives a project's textures.
use super::*;

/// Directory a Maya project reserves for textures.
const IMAGES_DIRECTORY: &str = "sourceimages";
/// What separates segments of a path Maya writes: the machine that exported may be a Windows
/// machine, and the path it wrote then carries backslashes.
const SEPARATORS: &[char] = &['/', '\\'];
/// The two wrap modes of a glTF sampler: repeat, or clamp to the last texel.
const REPEAT: u32 = 10497;
const CLAMP: u32 = 33071;
/// Placement components of a `place2dTexture` that a glTF without `KHR_texture_transform` does
/// not carry, each with the value that moves nothing. Maya writes them as a block or component
/// by component, and both writings say the same thing.
const PLACEMENTS: &[(&[&str], f64)] = &[
    (&["re", "repeatUV"], 1.0),
    (&["reu", "repeatU"], 1.0),
    (&["rev", "repeatV"], 1.0),
    (&["of", "offset"], 0.0),
    (&["ofu", "offsetU"], 0.0),
    (&["ofv", "offsetV"], 0.0),
    (&["ro", "rotateUV"], 0.0),
];
/// The two mirrors of a `place2dTexture`: no glTF wrap mode does that folding.
const MIRRORS: &[&[&str]] = &[&["mu", "mirrorU"], &["mv", "mirrorV"]];

/// glTF texture wired onto one of these inputs of a node, in the form glTF expects of a texture
/// slot: `{"index": …}`.
pub(super) fn connected(world: &mut World<'_>, node: usize, names: &[&str]) -> Option<Value> {
    let source = world.graph.input(node, names).map(|(source, _)| source)?;
    of(world, source)
}

/// glTF texture of this node. An input wired onto something other than a `file` node — a
/// computation, a ramp, a noise — is not an image: it is counted rather than evaluated.
pub(super) fn of(world: &mut World<'_>, node: usize) -> Option<Value> {
    let document = world.document;
    if document.nodes[node].kind != "file" {
        world.refuse(report::TEXTURE_UNSUPPORTED);
        return None;
    }
    let written = document.nodes[node]
        .attr(&["ftn", "fileTextureName"])
        .and_then(|attr| attr.texts().first().cloned())?;
    let index = image(world, &written)?;
    let sampler = sampler(world, node);
    Some(json!({ "index": world.scene.texture(index, sampler) }))
}

/// Rank of the image, poured on first request, or nothing when the file does not read.
fn image(world: &mut World<'_>, written: &str) -> Option<usize> {
    let images = world.images;
    let Some((relative, mime)) = candidates(written)
        .into_iter()
        .find_map(|path| crate::import::readable(images, &path).map(|mime| (path, mime)))
    else {
        world.refuse(report::TEXTURE_MISSING);
        world.scene.image_unreadable(written);
        return None;
    };
    Some(world.scene.image(relative, mime))
}

/// Paths where to look up the image under the root, in order: the written path when it is
/// relative and safe, then its file name alone at the image root, then that name under
/// `sourceimages`.
fn candidates(written: &str) -> Vec<String> {
    let name = written
        .rsplit(SEPARATORS)
        .find(|part| !part.is_empty() && *part != ".")
        .filter(|name| crate::is_safe_source_name(name));
    let Some(name) = name else {
        return Vec::new();
    };
    let mut out: Vec<String> = crate::safe_relative(written, SEPARATORS)
        .into_iter()
        .collect();
    out.push(name.to_string());
    out.push(format!("{IMAGES_DIRECTORY}/{name}"));
    out
}

/// Sampler of this `file` node, read on the `place2dTexture` wired onto its coordinates. Maya
/// repeats by default, and `wrapU` as `wrapV` clamp separately the axis they name. That same
/// node carries the placement — repeat, offset, rotation, mirror — which the output does not
/// carry: what does not pass is counted by name rather than lost in silence.
fn sampler(world: &mut World<'_>, node: usize) -> usize {
    let document = world.document;
    let place = world
        .graph
        .input(node, &["uv", "uvCoord"])
        .map(|(source, _)| &document.nodes[source]);
    if let Some(place) = place {
        if MIRRORS
            .iter()
            .any(|names| place.attr(names).and_then(Attr::flag) == Some(true))
        {
            world.refuse(report::TEXTURE_MIRROR);
        }
        if PLACEMENTS
            .iter()
            .any(|(names, neutral)| moved(place, names, *neutral))
        {
            world.refuse(report::TEXTURE_TRANSFORM);
        }
    }
    let repeats = |names: &[&str]| match place
        .and_then(|place| place.attr(names))
        .and_then(Attr::flag)
        .unwrap_or(true)
    {
        true => REPEAT,
        false => CLAMP,
    };
    world
        .scene
        .sampler_uv(repeats(&["wu", "wrapU"]), repeats(&["wv", "wrapV"]))
}

/// Is this placement component written elsewhere than at its neutral value?
fn moved(place: &Node, names: &[&str], neutral: f64) -> bool {
    place
        .attr(names)
        .map(Attr::numbers)
        .is_some_and(|values| values.iter().any(|value| *value != neutral))
}
