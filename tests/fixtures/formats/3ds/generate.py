"""CC0 authored 3DS fixture, public little-endian chunk grammar; no third-party model."""
from pathlib import Path
from struct import pack

def chunk(code, data=b''):
    return pack('<HI', code, len(data) + 6) + data

def material(name):
    return chunk(0xAFFF, chunk(0xA000, name.encode() + b'\0') + chunk(0xA020, chunk(0x0012, bytes([255, 0, 0]))))
vertices = chunk(0x4110, pack('<H12f', 4, 0,0,0, 1,0,0, 1,1,0, 0,1,0))
faces = chunk(0x4120, pack('<H8H',2, 0,1,2,0, 0,2,3,0) + chunk(0x4130,b'red-b\0'+pack('<HH',1,0)) + chunk(0x4130,b'red-a\0'+pack('<HH',1,1)) + chunk(0x4150,pack('<II',1,1)))
uv = chunk(0x4140, pack('<H8f',4,0,0,1,0,1,1,0,1))
frame = chunk(0x4160,pack('<12f',1,0,0,0,1,0,0,0,1,2,3,4))
mesh = chunk(0x4000,b'quad\0'+chunk(0x4100,vertices+faces+uv+frame))
editor = chunk(0x3D3D,chunk(0x0100,pack('<f',0.01))+material('red-a')+material('red-b')+mesh)
Path(__file__).with_name('scene.3ds').write_bytes(chunk(0x4D4D,chunk(2,pack('<I',3))+editor))
