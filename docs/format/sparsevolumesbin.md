# `sparseVolumes.bin`

The sparse volume textures a scene's heterogeneous volumes read (`rust/sparse_volume`, read by
`sdk-browser/src/lighting/heterogeneousVolumes/sparseVolumeFile.ts`). A node of the source scene
cites a `.vdb` file by the extension `TRILLION3D_sparse_volume` (`uri`, under the source folder);
a name ending with a number makes the first frame of a sequence of the files that follow it. The
manifest's `sparseVolumes` section holds `version` (1), `file`, `bytes`, and for each volume its
`node`, `uri`, `resolution`, `mipLevels`, `formats` and `frames` (`offset`, `bytes`, `matrix`: the
frame's transform, sixteen numbers, the translation in the last four). Words are little-endian
`u32`; a frame starts on a four-byte boundary.

A frame is, in order: a head of 36 words, the magic `SVTF`, the version (1), the rank of the first
tile that is not of the coarsest level, the mip levels, the pages and the tiles, the volume's
resolution, lowest voxel and highest voxel (excluded), the page table's resolution, lowest page and
highest page (excluded) (`i32` × 3 each), the two attribute formats (1 `R8`, 2 `R8G8`, 3 `R8G8B8A8`,
4 `R16F`, 5 `G16R16F`, 6 `FloatRGBA`, 0 none), the two
fallback values (`f32` × 4 each), the bytes of tile data and a word kept zero; the first page and
the page count of each mip level; three tables with a word a page, the page's coordinates in its
level's page table (11, 11 and 10 bits), its tile and its parent page in the next coarser level
(`0xFFFFFFFF` for none); the offsets of the tiles in the tile data, one more than the tiles; the
voxels each tile stores of its first texture (`u16`, padded to a word); the tile data. A tile is a
cube of 18 voxels a side, 16 and a border of one, and is shared by all the pages whose voxels are
alike. It is stored as the occupancy bits of its textures (183 words each, a bit a voxel, set where
the voxel is not the fallback value), then the voxels of its first texture that are set, then those
of its second. The page table has one level per mip, each half the size of the one before down to
one page.
