//! A `UsdUVTexture` into a glTF texture.
//!
//! The driver decodes nothing itself: it names the image by its URI, relative to the root where
//! the compiler will reread those same bytes, and leaves the image registry to say whether this
//! format reads. A texture of a format outside the registry, missing, or that leaves the source
//! directory is counted in the report and the scene continues without it — never a compilation
//! failure.
use super::*;
use trillion3d_page_codec::MAX_UV_SETS;

/// Identifier of the texture node this driver reads.
const UV_TEXTURE: &str = "UsdUVTexture";
/// The primvar of the first coordinate set; the sets past it are `st1` to `st7`
/// (`UsdPreviewSurface`'s convention), the glTF `TEXCOORD_1` to `TEXCOORD_7`.
pub(super) const UV_SET: &str = "st";

/// The glTF rank of the coordinate set the primvar `name` is: `st` the first, `st` and a number
/// from 1 to 7 the others; `None` for any other name.
pub(super) fn set_rank(name: &str) -> Option<usize> {
    let rank = match name.strip_prefix(UV_SET)? {
        "" => 0,
        digits if digits.bytes().all(|b| b.is_ascii_digit()) && !digits.starts_with('0') => {
            digits.parse().ok()?
        }
        _ => return None,
    };
    (rank < MAX_UV_SETS).then_some(rank)
}
/// Pattern of a per-tile texture set, which names several files not one.
const UDIM: &str = "<UDIM>";

/// What a hung texture yields to the input that reads it: its glTF slot, and the factor glTF
/// carries in place of the texture node's `scale` — one for a missing `scale`.
pub(super) struct Bound {
    pub(super) value: Value,
    /// Unique factor that `scale` and `bias` fold into, `None` when they do not fit.
    scale: Option<f64>,
}

impl Bound {
    /// Factor to write where glTF has one; a `scale` that does not fold into it is counted.
    pub(super) fn factor(&self, world: &mut World<'_>) -> f64 {
        self.scale.unwrap_or_else(|| {
            world.scene.report.add(world::TEXTURE_SCALE);
            1.0
        })
    }
    /// Slot alone, where glTF has no factor: a `scale` that is not one is counted.
    pub(super) fn plain(self, world: &mut World<'_>) -> Value {
        if self.scale != Some(1.0) {
            world.scene.report.add(world::TEXTURE_SCALE);
        }
        self.value
    }
}

/// glTF texture this connection names. `colour` says the role of the input that reads it — a
/// colour or a datum — on which depends the colour space the file must carry.
pub(super) fn resolve(world: &mut World<'_>, target: &sdf::Path, colour: bool) -> Option<Bound> {
    let shader = world.stage.prim(target.prim_path()).ok()?;
    let id = read::text_attribute(&shader, "info:id");
    if id.as_deref() != Some(UV_TEXTURE) {
        world
            .scene
            .report
            .add(crate::plugins::scene::codes::TEXTURE_UNSUPPORTED);
        return None;
    }
    let (value, _) = read::first(&shader.attribute("inputs:file"))?;
    let file = read::asset(&value)?;
    if file.as_str().contains(UDIM) {
        world
            .scene
            .report
            .add(crate::plugins::scene::codes::TEXTURE_UNSUPPORTED);
        return None;
    }
    let set = uv_set(world, &shader).map_or(Some(0), |name| set_rank(&name));
    if set.is_none() {
        world
            .scene
            .report
            .add(crate::plugins::scene::codes::TEXTURE_UNSUPPORTED);
    }
    let index = image(world, file)?;
    sampling::colour_space(world, &shader, colour);
    let sampler = sampling::sampler(world, &shader);
    let mut value = json!({ "index": world.scene.texture(index, sampler) });
    if let Some(set) = set.filter(|&set| set != 0) {
        value["texCoord"] = json!(set);
    }
    Some(Bound {
        value,
        scale: sampling::scale(&shader),
    })
}

/// Rank of the image, poured on first request, or `None` when the file does not read.
fn image(world: &mut World<'_>, file: &sdf::AssetPath) -> Option<usize> {
    let relative = under_root(world, file);
    world
        .scene
        .image_found(world.images, relative, file.as_str())
}

/// Path of the image under the root where the compiler will reread its bytes. An asset path
/// anchors on the layer that writes it — reference, sublayer or payload — and it is that
/// resolved path that comes back under the root: a layer stored in a subdirectory finds its
/// images there. Failing resolution, the written path is anchored on the root, as a lone layer
/// asks.
fn under_root(world: &World<'_>, asset: &sdf::AssetPath) -> Option<String> {
    let under = asset
        .resolved_path()
        .map(Path::new)
        .and_then(|path| path.strip_prefix(&world.root).ok())
        .map(|path| path.to_string_lossy().replace('\\', "/"));
    // A USD layer separates segments of an asset path by a slash, and only one: a backslash
    // belongs to the name there, it cuts nothing.
    crate::safe_relative(under.as_deref().unwrap_or(asset.as_str()), &['/'])
}

/// Coordinate set the primvar reader wired onto `inputs:st` names.
fn uv_set(world: &World<'_>, shader: &usd::Prim) -> Option<String> {
    let target = material::connection(shader, "inputs:st")?;
    let reader = world.stage.prim(target.prim_path()).ok()?;
    read::text_attribute(&reader, "inputs:varname")
}
