//! Les DDS minuscules de la dorée, écrits ici octet par octet depuis la spécification publique de
//! Microsoft. Aucun encodeur n'est appelé : chaque champ de `DDS_HEADER`, de `DDS_PIXELFORMAT` et
//! de `DDS_HEADER_DXT10` est posé à la main, et chaque bloc porte des valeurs dont on connaît le
//! décodage exact. C'est la seule façon d'affirmer « sans perte » sans croire le décodeur sur parole.

/// Décalages, relatifs au début de `DDS_HEADER` — le nombre magique fait quatre octets de plus.
const SIZE: usize = 0;
const FLAGS: usize = 4;
const HEIGHT: usize = 8;
const WIDTH: usize = 12;
const MIPS: usize = 24;
const PIXEL_FORMAT: usize = 72;
const CAPS: usize = 104;
/// `DDSD_CAPS | DDSD_HEIGHT | DDSD_WIDTH | DDSD_PIXELFORMAT | DDSD_MIPMAPCOUNT`.
const HEADER_FLAGS: u32 = 0x0002_1007;
/// `DDSCAPS_TEXTURE`.
const CAPS_TEXTURE: u32 = 0x1000;

fn put(into: &mut [u8], at: usize, value: u32) {
    into[at..at + 4].copy_from_slice(&value.to_le_bytes());
}

/// Les trente-deux octets de `DDS_PIXELFORMAT` pour un codec nommé par son `dwFourCC`.
pub(super) fn fourcc_format(tag: &[u8; 4]) -> [u8; 32] {
    let mut format = [0u8; 32];
    put(&mut format, 0, 32);
    // DDPF_FOURCC
    put(&mut format, 4, 0x4);
    format[8..12].copy_from_slice(tag);
    format
}

/// Les trente-deux octets de `DDS_PIXELFORMAT` d'une surface non compressée, décrite par ses
/// masques de bits. `bit_count` est laissé libre : un profil hors liste doit pouvoir s'écrire.
pub(super) fn mask_format(bit_count: u32, masks: [u32; 4]) -> [u8; 32] {
    let mut format = [0u8; 32];
    put(&mut format, 0, 32);
    // DDPF_RGB | DDPF_ALPHAPIXELS quand un masque d'alpha est donné.
    put(&mut format, 4, if masks[3] == 0 { 0x40 } else { 0x41 });
    put(&mut format, 12, bit_count);
    for (channel, mask) in masks.iter().enumerate() {
        put(&mut format, 16 + channel * 4, *mask);
    }
    format
}

/// Le conteneur complet : nombre magique, `DDS_HEADER`, puis les octets qui suivent l'entête.
pub(super) fn container(
    format: [u8; 32],
    width: u32,
    height: u32,
    levels: u32,
    payload: &[u8],
) -> Vec<u8> {
    let mut header = [0u8; 124];
    put(&mut header, SIZE, 124);
    put(&mut header, FLAGS, HEADER_FLAGS);
    put(&mut header, HEIGHT, height);
    put(&mut header, WIDTH, width);
    put(&mut header, MIPS, levels);
    header[PIXEL_FORMAT..PIXEL_FORMAT + 32].copy_from_slice(&format);
    put(&mut header, CAPS, CAPS_TEXTURE);
    let mut out = Vec::with_capacity(4 + header.len() + payload.len());
    out.extend_from_slice(b"DDS ");
    out.extend_from_slice(&header);
    out.extend_from_slice(payload);
    out
}

/// Le même conteneur, codec nommé par le `dxgiFormat` de `DDS_HEADER_DXT10` : une texture 2D
/// simple, ni tableau, ni cube, alpha droit.
pub(super) fn dx10(dxgi: u32, width: u32, height: u32, payload: &[u8]) -> Vec<u8> {
    let mut extended = [0u8; 20];
    put(&mut extended, 0, dxgi);
    // D3D10_RESOURCE_DIMENSION_TEXTURE2D, miscFlag, arraySize, miscFlags2.
    put(&mut extended, 4, 3);
    put(&mut extended, 12, 1);
    let mut tail = extended.to_vec();
    tail.extend_from_slice(payload);
    container(fourcc_format(b"DX10"), width, height, 1, &tail)
}

/// Un écrivain de bits, du bit de poids faible du premier octet vers le haut : c'est l'ordre dans
/// lequel les blocs BCn se lisent, indices comme champs de BC7.
pub(super) struct Bits {
    block: [u8; 16],
    at: usize,
}

impl Bits {
    pub(super) fn new() -> Self {
        Bits {
            block: [0; 16],
            at: 0,
        }
    }
    pub(super) fn put(&mut self, value: u32, width: usize) -> &mut Self {
        for bit in 0..width {
            if value >> bit & 1 == 1 {
                self.block[self.at / 8] |= 1 << (self.at % 8);
            }
            self.at += 1;
        }
        self
    }
    /// Les seize octets écrits, complétés de zéros — la taille d'un bloc BC2, BC3, BC5 ou BC7.
    pub(super) fn block(&self) -> [u8; 16] {
        self.block
    }
}

/// Les indices d'un bloc, `width` bits chacun, du premier pixel au dernier.
pub(super) fn indices(values: [u8; 16], width: usize) -> Vec<u8> {
    let mut bits = Bits::new();
    for value in values {
        bits.put(u32::from(value), width);
    }
    bits.block()[..values.len() * width / 8].to_vec()
}

/// Le bloc de couleurs BC1 de la dorée : rouge pur et bleu pur en 565, donc `couleur0 > couleur1`
/// et les quatre couleurs interpolées, puis les indices donnés.
pub(super) fn color_block(order: [u8; 16]) -> Vec<u8> {
    let mut block = vec![0x00, 0xf8, 0x1f, 0x00];
    block.extend_from_slice(&indices(order, 2));
    block
}

/// Un bloc d'alpha à trois bits (BC3, BC4, BC5) : deux bornes puis seize indices.
pub(super) fn ramp_block(first: u8, second: u8, order: [u8; 16]) -> Vec<u8> {
    let mut block = vec![first, second];
    block.extend_from_slice(&indices(order, 3));
    block
}
