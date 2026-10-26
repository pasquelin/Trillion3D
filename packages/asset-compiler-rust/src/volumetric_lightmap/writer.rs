//! The writer of a volumetric lightmap's file (`format.rs`): the layers a solver produced, checked
//! against the sizes the head promises, laid out in the order the readers expect.
use super::format::*;
use std::{fs, io, path::Path};

/// A cell of the finest bricks that stream together: where it lies in the grid of cells, the
/// indirection texel of each of its bricks, and their padded texels, brick after brick.
pub struct LightmapCell {
    pub coordinates: [u32; 3],
    pub bricks: Vec<[u32; 3]>,
    pub ambient: Vec<u8>,
    pub coefficients: [Vec<u8>; 6],
    /// Empty where the file has no bent normal.
    pub sky_bent_normal: Vec<u8>,
    pub directional_shadowing: Vec<u8>,
}

impl LightmapCell {
    /// The cell's bytes: the bricks' coordinates, then each layer's texels.
    fn bytes(&self) -> Vec<u8> {
        let mut bytes: Vec<u8> = self
            .bricks
            .iter()
            .flatten()
            .flat_map(|c| c.to_le_bytes())
            .collect();
        for part in [&self.ambient]
            .into_iter()
            .chain(&self.coefficients)
            .chain([&self.sky_bent_normal, &self.directional_shadowing])
        {
            bytes.extend_from_slice(part);
        }
        bytes.resize(bytes.len().next_multiple_of(4), 0);
        bytes
    }
}

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
    /// The side of a streaming cell in finest bricks; 0 where the file has no cells.
    pub cell_texels: u32,
    /// The finest bricks, cell by cell, in the order of their coordinates.
    pub cells: Vec<LightmapCell>,
}

/// The bytes of a file, and how many of them (the head, the layers, the cells' table) are the
/// part always read: the cells' bytes follow.
pub struct Encoded {
    pub bytes: Vec<u8>,
    pub base_bytes: usize,
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
        if self.cell_texels == 0 && !self.cells.is_empty() {
            return Err("cells need the side of a cell".into());
        }
        for cell in &self.cells {
            let count = cell.bricks.len();
            let texels = count * VOLUMETRIC_LIGHTMAP_CELL_TEXELS;
            let sky = if self.sky_bent_normal.is_empty() {
                0
            } else {
                texels * 4
            };
            if cell.ambient.len() != texels * 4
                || cell.coefficients.iter().any(|c| c.len() != texels * 4)
                || cell.sky_bent_normal.len() != sky
                || cell.directional_shadowing.len() != texels
            {
                return Err("a cell's layers disagree with its bricks".into());
            }
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
pub fn encode(layers: &VolumetricLightmapLayers) -> Result<Encoded, String> {
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
    words.push(layers.cell_texels);
    words.push(layers.cells.len() as u32);
    let mut bytes: Vec<u8> = words.iter().flat_map(|word| word.to_le_bytes()).collect();
    for kind in LayerKind::ALL {
        bytes.extend_from_slice(layers.layer(kind));
        bytes.resize(bytes.len().next_multiple_of(4), 0);
    }
    let cells: Vec<Vec<u8>> = layers.cells.iter().map(LightmapCell::bytes).collect();
    let base_bytes = bytes.len() + layers.cells.len() * VOLUMETRIC_LIGHTMAP_CELL_RECORD_WORDS * 4;
    let mut offset = base_bytes;
    for (cell, body) in layers.cells.iter().zip(&cells) {
        let mut record = cell.coordinates.to_vec();
        record.extend([cell.bricks.len() as u32, offset as u32, body.len() as u32]);
        let digest = crate::compiler::cache::digest::digest_bytes(body);
        record.extend(
            digest
                .chunks_exact(4)
                .map(|w| u32::from_le_bytes([w[0], w[1], w[2], w[3]])),
        );
        bytes.extend(record.iter().flat_map(|word| word.to_le_bytes()));
        offset += body.len();
    }
    for body in &cells {
        bytes.extend_from_slice(body);
    }
    Ok(Encoded { bytes, base_bytes })
}

/// Writes the file `layers` make at `path`, whole or not at all.
pub fn write(path: &Path, layers: &VolumetricLightmapLayers) -> io::Result<()> {
    let encoded =
        encode(layers).map_err(|message| io::Error::new(io::ErrorKind::InvalidInput, message))?;
    let partial = path.with_extension("tmp");
    fs::write(&partial, encoded.bytes)?;
    fs::rename(partial, path)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn layers(cells: Vec<LightmapCell>) -> VolumetricLightmapLayers {
        VolumetricLightmapLayers {
            bounds: ([0.0; 3], [8.0; 3]),
            brick_size: 4,
            indirection_dimensions: [1, 1, 1],
            brick_dimensions: [5, 5, 5],
            indirection: vec![0; 4],
            ambient: vec![0; 500],
            coefficients: std::array::from_fn(|_| vec![0; 500]),
            sky_bent_normal: Vec::new(),
            directional_shadowing: vec![0; 125],
            cell_texels: 1,
            cells,
        }
    }

    fn cell() -> LightmapCell {
        LightmapCell {
            coordinates: [1, 2, 3],
            bricks: vec![[0, 0, 0]],
            ambient: vec![1; 500],
            coefficients: std::array::from_fn(|_| vec![2; 500]),
            sky_bent_normal: Vec::new(),
            directional_shadowing: vec![3; 125],
        }
    }

    #[test]
    fn the_cells_follow_the_part_always_read_and_are_told_by_their_records() {
        let encoded = encode(&layers(vec![cell()])).expect("a file");
        let words = |at: usize| u32::from_le_bytes(encoded.bytes[at..at + 4].try_into().unwrap());
        assert_eq!(words(4), VOLUMETRIC_LIGHTMAP_VERSION);
        assert_eq!(words(35 * 4), 1, "the cells' side");
        assert_eq!(words(36 * 4), 1, "the cells' count");
        let record = encoded.base_bytes - VOLUMETRIC_LIGHTMAP_CELL_RECORD_WORDS * 4;
        assert_eq!(
            [words(record), words(record + 4), words(record + 8)],
            [1, 2, 3]
        );
        assert_eq!(
            words(record + 16) as usize,
            encoded.base_bytes,
            "its offset"
        );
        assert_eq!(
            encoded.bytes.len(),
            encoded.base_bytes + words(record + 20) as usize
        );
    }

    #[test]
    fn a_cell_whose_layers_disagree_with_its_bricks_is_refused() {
        let mut broken = cell();
        broken.ambient.pop();
        assert!(encode(&layers(vec![broken])).is_err());
    }
}
