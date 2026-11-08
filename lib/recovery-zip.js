// Uncompressed ZIP32 keeps original bytes intact and needs no external service.
const table = Uint32Array.from({ length: 256 }, (_, n) => {
  let value = n;
  for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  return value >>> 0;
});

async function crc32(blob) {
  let crc = 0xffffffff;
  for (let offset = 0; offset < blob.size; offset += 1024 * 1024) {
    const bytes = new Uint8Array(await blob.slice(offset, offset + 1024 * 1024).arrayBuffer());
    for (const byte of bytes) crc = table[(crc ^ byte) & 255] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function header(length, values) {
  const bytes = new Uint8Array(length), view = new DataView(bytes.buffer);
  for (const [offset, size, value] of values) {
    if (size === 4) view.setUint32(offset, value, true);
    else view.setUint16(offset, value, true);
  }
  return bytes;
}

export async function recoveryZip(entries) {
  if (!entries.length || entries.length > 10000) throw new Error("Invalid recovery archive entry count.");
  const names = new Set(), parts = [], directory = [];
  let offset = 0, centralSize = 0;
  for (const entry of entries) {
    if (!/^[A-Za-z0-9._/-]+$/.test(entry.name) || entry.name.startsWith("/")
      || entry.name.split("/").some(part => !part || part === "." || part === "..")
      || names.has(entry.name)) throw new Error("Invalid or duplicate recovery archive path.");
    names.add(entry.name);
    if (!(entry.blob instanceof Blob) || entry.blob.size > 0xffffffff) throw new Error("Invalid recovery archive file.");
    const name = new TextEncoder().encode(entry.name);
    if (name.length > 65535 || offset + entry.blob.size + 30 + name.length > 2 * 1024 * 1024 * 1024) {
      throw new Error("Recovery ZIPs are limited to 2 GiB. Export smaller selections.");
    }
    const crc = await crc32(entry.blob);
    const local = header(30, [[0,4,0x04034b50],[4,2,20],[6,2,0x800],[12,2,33],
      [14,4,crc],[18,4,entry.blob.size],[22,4,entry.blob.size],[26,2,name.length]]);
    const central = header(46, [[0,4,0x02014b50],[4,2,20],[6,2,20],[8,2,0x800],[14,2,33],
      [16,4,crc],[20,4,entry.blob.size],[24,4,entry.blob.size],[28,2,name.length],[42,4,offset]]);
    parts.push(local, name, entry.blob);
    directory.push(central, name);
    offset += local.length + name.length + entry.blob.size;
    centralSize += central.length + name.length;
  }
  if (offset + centralSize + 22 > 2 * 1024 * 1024 * 1024) throw new Error("Recovery ZIP exceeds 2 GiB.");
  const end = header(22, [[0,4,0x06054b50],[8,2,entries.length],[10,2,entries.length],
    [12,4,centralSize],[16,4,offset]]);
  return new Blob([...parts, ...directory, end], { type: "application/zip" });
}
