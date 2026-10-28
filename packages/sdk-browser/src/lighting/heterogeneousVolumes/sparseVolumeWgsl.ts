import { wgslFn, wgslStruct } from '../../../../math/src/wgsl/decl.ts'

/**
 * THE READ OF A SPARSE VOLUME TEXTURE IN A SHADER: the page table of a level names a tile of the
 * physical atlas (its cell and the level the tile is of), the tile holds the page's voxels with a
 * border of one, and the voxel is found in it. The helpers take the textures as parameters, so a
 * program binds the page table and the two atlases of each volume it reads as it likes and wraps
 * these in the functions a material graph calls (`svtCalculateMip`, `svtSample`,
 * `../../materials/graph/nodesSparseVolume.ts`).
 */

/** The uniforms of a volume, unpacked: its size in pages, the lowest page of its page table, the
 *  atlas's texel and the coarsest level (`packedUniforms`, `sparseVolumeGpu.ts`). */
export const SVT_UNIFORMS = wgslStruct(
  'SvtUniforms',
  [],
  `struct SvtUniforms{pageResolution:vec3f,pageTableOffset:vec3f,texelSize:vec3f,frameIndex:i32,highestMip:i32,}`,
)

/** The uniforms in the two words of four that `packedUniforms` writes. */
export const SVT_UNPACK = wgslFn(
  'svtUnpack',
  [SVT_UNIFORMS],
  `fn svtUnpack(p0:vec4u,p1:vec4u)->SvtUniforms{
 var u:SvtUniforms;
 u.pageResolution=bitcast<vec3f>(p0.xyz);
 u.pageTableOffset=vec3f(f32(p0.w&0x7FFu),f32((p0.w>>11u)&0x7FFu),f32((p0.w>>22u)&0x3FFu));
 u.texelSize=bitcast<vec3f>(p1.xyz);
 u.frameIndex=i32(p1.w&0xFFFFu);
 u.highestMip=i32((p1.w>>16u)&0xFFFFu);
 return u;
}`,
)

/** A coordinate held to the volume by an address mode (0 clamp, 1 wrap, 2 mirror): a clamp stops
 *  just below one, so that the page it names stays in the page table. */
export const SVT_ADDRESS = wgslFn(
  'svtAddress',
  [],
  `fn svtAddress1(v:f32,mode:u32)->f32{
 if(mode==1u){return fract(v);}
 if(mode==2u){let t=fract(v*0.5)*2.0;return 1.0-abs(t-1.0);}
 return clamp(v,0.0,1.0-1.0/65536.0);
}
fn svtAddress(uvw:vec3f,mode:vec3u)->vec3f{
 return vec3f(svtAddress1(uvw.x,mode.x),svtAddress1(uvw.y,mode.y),svtAddress1(uvw.z,mode.z));
}`,
)

/** The level a footprint asks: half the base-2 logarithm of the longer derivative's length in
 *  voxels, plus the bias, held at zero or above. */
export const SVT_MIP = wgslFn(
  'svtCalculateMipLevel',
  [SVT_UNIFORMS],
  `fn svtCalculateMipLevel(u:SvtUniforms,ddx:vec3f,ddy:vec3f,bias:f32)->f32{
 let resolution=u.pageResolution*16.0;
 let dx=ddx*resolution;
 let dy=ddy*resolution;
 let longest=max(dot(dx,dx),dot(dy,dy));
 return max(0.0,0.5*log2(max(longest,1e-8))+bias);
}`,
)

/** The place of the voxel `pageTableCoord` names in the atlas, in voxels: the tile the page table
 *  holds, and where in it the coordinate falls; a page of a coarser level than asked is read at the
 *  scale of that level. */
export const SVT_VOXEL = wgslFn(
  'svtVoxelCoord',
  [],
  `fn svtVoxelCoord(pageTable:texture_3d<u32>,pageTableCoord:vec3f,mip:i32)->vec3f{
 let packed=textureLoad(pageTable,vec3i(floor(pageTableCoord)),mip).x;
 let tile=vec3f(f32(packed&0xFFu),f32((packed>>8u)&0xFFu),f32((packed>>16u)&0xFFu));
 let tileMip=packed>>24u;
 let factor=1.0/f32(1u<<(tileMip-u32(mip)));
 let inTile=fract(pageTableCoord*factor);
 return tile*18.0+inTile*16.0+1.0;
}`,
)

/** The atlas coordinate (0 to 1) of the point `uvw` of the volume at the level `mip`. */
export const SVT_PAGE_TABLE = wgslFn(
  'svtSamplePageTable',
  [SVT_UNIFORMS, SVT_ADDRESS, SVT_VOXEL],
  `fn svtSamplePageTable(pageTable:texture_3d<u32>,u:SvtUniforms,uvw:vec3f,mode:vec3u,level:i32)->vec3f{
 let held=svtAddress(uvw,mode);
 let mip=clamp(level,0,u.highestMip);
 let rcp=1.0/f32(1u<<u32(mip));
 let pageCoord=held*u.pageResolution;
 let mipOffset=floor(u.pageTableOffset*rcp);
 let voxel=svtVoxelCoord(pageTable,pageCoord*rcp-mipOffset,mip);
 return voxel*u.texelSize;
}`,
)
