//! The writer of a volumetric lightmap's file (`format.rs`): the layers a solver produced, checked
//! against the sizes the head promises, laid out in the order the readers expect.
use super::format::*;
use std::{fs, io, path::Path};

/// A volumetric lightmap's layers, texels in x, then y, then z order.
pub struct VolumetricLightmapLayers {
    /// The world box the indirection volume covers: lower corner, upper corner.
    pub bounds: ([f32; 3], [f32; 3]),
    /// Texels along a brick's unique side; a padded brick is one wider.
    pub brick_size: u32,
    /// The indirection volume's size in texels, one texel a brick of the finest level.
    pub indirection_dimensions: [u32; 3],
    /// The brick atlas's size in texels: a whole number of padded bricks along each side.
    pub brick_dimensions: [u32; 3],
    /// Per texel: the brick's position in the atlas layout (three bytes) and its span in finest bricks.
    pub indirection: Vec<u8>,
    /// Per atlas texel: the ambient colour, packed 11, 11, 10 bits.
    pub ambient: Vec<u8>,
    /// Per atlas texel: the six layers of coefficients, in `LayerKind` order from `Coefficients0Red`.
    pub coefficients: [Vec<u8>; 6],
    /// Per atlas texel: the sky's bent normal, mapped to [0, 1]; empty where the sky is not shadowed.
    pub sky_bent_normal: Vec<u8>,
    /// Per atlas texel: the stationary sun's unshadowed fraction.
    pub directional_shadowing: Vec<u8>,
}

fn texels(dimensions: [u32; 3]) -> usize {
    dimensions.iter().map(|&side| side as usize).product()
}

impl VolumetricLightmapLayers {
    /// The bytes of the layer `kind`.
    fn layer(&self, kind: LayerKind) -> &[u8] {
        match kind {
            LayerKind::Indirection => &self.indirection,
            LayerKind::Ambient => &self.ambient,
            LayerKind::SkyBentNormal => &self.sky_bent_normal,
            LayerKind::DirectionalShadowing => &self.directional_shadowing,
            coefficients => {
                &self.coefficients[coefficients as usize - LayerKind::Coefficients0Red as usize]
            }
        }
    }

    /// Refuses layers whose sizes disagree with the volumes they claim.
    fn check(&self) -> Result<(), String> {
        let padded = self.brick_size + 1;
        if self.brick_size == 0
            || self
                .brick_dimensions
                .iter()
                .any(|&side| side == 0 || side % padded != 0)
        {
            return Err("the atlas must be whole padded bricks".into());
        }
        if self
            .brick_dimensions
            .iter()
            .any(|&side| side / padded > VOLUMETRIC_LIGHTMAP_MAX_LAYOUT)
            || self.indirection_dimensions.contains(&0)
        {
            return Err("a volume is empty or the atlas layout exceeds a byte".into());
        }
        if self
            .bounds
            .0
            .iter()
            .zip(&self.bounds.1)
            .any(|(low, high)| low.partial_cmp(high) != Some(std::cmp::Ordering::Less))
        {
            return Err("the bounds must be a box".into());
        }
        for kind in LayerKind::ALL {
            let volume = if kind == LayerKind::Indirection {
                self.indirection_dimensions
            } else {
                self.brick_dimensions
            };
            let wanted = texels(volume) * kind.format().bytes();
            let given = self.layer(kind).len();
            let optional = kind == LayerKind::SkyBentNormal && given == 0;
            if given != wanted && !optional {
                return Err(format!(
                    "{kind:?} holds {given} bytes, its volume needs {wanted}"
                ));
            }
        }
        Ok(())
    }
}

/// The file's bytes for `layers`; an error names the layer that disagrees with its volume.
pub fn encode(layers: &VolumetricLightmapLayers) -> Result<Vec<u8>, String> {
    layers.check()?;
    let mut words = vec![
        VOLUMETRIC_LIGHTMAP_MAGIC,
        VOLUMETRIC_LIGHTMAP_VERSION,
        layers.brick_size,
    ];
    words.extend(
        layers
            .bounds
            .0
            .iter()
            .chain(&layers.bounds.1)
            .map(|corner| corner.to_bits()),
    );
    words.extend(layers.indirection_dimensions);
    words.extend(layers.brick_dimensions);
    for kind in LayerKind::ALL {
        words.push(kind.format() as u32);
        words.push(layers.layer(kind).len() as u32);
    }
    let mut bytes: Vec<u8> = words.iter().flat_map(|word| word.to_le_bytes()).collect();
    for kind in LayerKind::ALL {
        bytes.extend_from_slice(layers.layer(kind));
        bytes.resize(bytes.len().next_multiple_of(4), 0);
    }
    Ok(bytes)
}

/// Writes the file `layers` make at `path`, whole or not at all.
pub fn write(path: &Path, layers: &VolumetricLightmapLayers) -> io::Result<()> {
    let bytes =
        encode(layers).map_err(|message| io::Error::new(io::ErrorKind::InvalidInput, message))?;
    let partial = path.with_extension("tmp");
    fs::write(&partial, bytes)?;
    fs::rename(partial, path)
}
