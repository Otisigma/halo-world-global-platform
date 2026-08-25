const textDecoder = new TextDecoder("utf-8", { fatal: false });
const latinDecoder = new TextDecoder("windows-1252", { fatal: false });

function synchsafe(bytes, offset) {
  return ((bytes[offset] & 0x7f) << 21) | ((bytes[offset + 1] & 0x7f) << 14) | ((bytes[offset + 2] & 0x7f) << 7) | (bytes[offset + 3] & 0x7f);
}

function uint32(bytes, offset) {
  return ((bytes[offset] << 24) >>> 0) + (bytes[offset + 1] << 16) + (bytes[offset + 2] << 8) + bytes[offset + 3];
}

function terminatorLength(encoding) {
  return encoding === 1 || encoding === 2 ? 2 : 1;
}

function findTerminator(bytes, start, encoding) {
  const width = terminatorLength(encoding);
  for (let index = start; index + width <= bytes.length; index += width) {
    if (bytes[index] === 0 && (width === 1 || bytes[index + 1] === 0)) return index;
  }
  return bytes.length;
}

function decodeUtf16(bytes, bigEndian = false) {
  let source = bytes;
  let encoding = bigEndian ? "utf-16be" : "utf-16le";
  if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    source = bytes.slice(2);
    encoding = "utf-16le";
  } else if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    source = bytes.slice(2);
    encoding = "utf-16be";
  }
  if (encoding === "utf-16be") {
    const swapped = new Uint8Array(source.length);
    for (let index = 0; index + 1 < source.length; index += 2) {
      swapped[index] = source[index + 1];
      swapped[index + 1] = source[index];
    }
    source = swapped;
  }
  return new TextDecoder("utf-16le", { fatal: false }).decode(source);
}

function decodeValue(bytes, encoding = 3) {
  if (!bytes?.length) return "";
  const value = encoding === 0
    ? latinDecoder.decode(bytes)
    : encoding === 1
      ? decodeUtf16(bytes)
      : encoding === 2
        ? decodeUtf16(bytes, true)
        : textDecoder.decode(bytes);
  return value.replace(/\0/g, "").trim();
}

function textFrame(frame) {
  return decodeValue(frame.slice(1), frame[0]);
}

function descriptiveFrame(frame, languageBytes = 0) {
  const encoding = frame[0];
  const descriptionStart = 1 + languageBytes;
  const descriptionEnd = findTerminator(frame, descriptionStart, encoding);
  const valueStart = Math.min(frame.length, descriptionEnd + terminatorLength(encoding));
  return decodeValue(frame.slice(valueStart), encoding);
}

function pictureData(frame) {
  const encoding = frame[0];
  const mimeEnd = findTerminator(frame, 1, 0);
  const reportedMime = decodeValue(frame.slice(1, mimeEnd), 0).toLowerCase();
  const mime = reportedMime === "image/jpg" ? "image/jpeg" : reportedMime;
  const descriptionStart = Math.min(frame.length, mimeEnd + 2);
  const descriptionEnd = findTerminator(frame, descriptionStart, encoding);
  const imageStart = Math.min(frame.length, descriptionEnd + terminatorLength(encoding));
  const data = frame.slice(imageStart);
  return { mime, byteSize: data.length, data };
}

function cleanYear(value) {
  const year = Number.parseInt(String(value || "").match(/\b(19|20|21)\d{2}\b/)?.[0], 10);
  return Number.isInteger(year) ? year : null;
}

export function titleFromFileName(fileName) {
  return String(fileName || "")
    .replace(/\.[a-z0-9]{2,5}$/i, "")
    .replace(/-\d+$/i, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 140);
}

export function parseId3Metadata(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input || 0);
  if (bytes.length < 10 || String.fromCharCode(...bytes.slice(0, 3)) !== "ID3") return {};
  const version = bytes[3];
  const tagEnd = Math.min(bytes.length, 10 + synchsafe(bytes, 6));
  const frames = {};
  let offset = 10;
  while (offset + 10 <= tagEnd) {
    const id = String.fromCharCode(...bytes.slice(offset, offset + 4));
    if (!/^[A-Z0-9]{4}$/.test(id)) break;
    const size = version === 4 ? synchsafe(bytes, offset + 4) : uint32(bytes, offset + 4);
    if (!size || offset + 10 + size > tagEnd) break;
    frames[id] = bytes.slice(offset + 10, offset + 10 + size);
    offset += 10 + size;
  }

  const artworkData = frames.APIC ? pictureData(frames.APIC) : null;
  const artwork = artworkData ? { mime: artworkData.mime, byteSize: artworkData.byteSize } : null;
  const metadata = {
    title: frames.TIT2 ? textFrame(frames.TIT2) : "",
    artist: frames.TPE1 ? textFrame(frames.TPE1) : "",
    album: frames.TALB ? textFrame(frames.TALB) : "",
    genre: frames.TCON ? textFrame(frames.TCON).replace(/[()]/g, "") : "",
    bpm: frames.TBPM ? Number.parseInt(textFrame(frames.TBPM), 10) || null : null,
    key: frames.TKEY ? textFrame(frames.TKEY) : "",
    year: cleanYear(frames.TDRC ? textFrame(frames.TDRC) : frames.TYER ? textFrame(frames.TYER) : ""),
    lyrics: frames.USLT ? descriptiveFrame(frames.USLT, 3) : "",
    comment: frames.COMM ? descriptiveFrame(frames.COMM, 3) : "",
    sourceUrl: frames.WOAS ? decodeValue(frames.WOAS, 0) : "",
    artwork
  };
  return metadata;
}

export function extractId3Artwork(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input || 0);
  if (bytes.length < 10 || String.fromCharCode(...bytes.slice(0, 3)) !== "ID3") return null;
  const version = bytes[3];
  const tagEnd = Math.min(bytes.length, 10 + synchsafe(bytes, 6));
  let offset = 10;
  while (offset + 10 <= tagEnd) {
    const id = String.fromCharCode(...bytes.slice(offset, offset + 4));
    if (!/^[A-Z0-9]{4}$/.test(id)) break;
    const size = version === 4 ? synchsafe(bytes, offset + 4) : uint32(bytes, offset + 4);
    if (!size || offset + 10 + size > tagEnd) break;
    if (id === "APIC") return pictureData(bytes.slice(offset + 10, offset + 10 + size));
    offset += 10 + size;
  }
  return null;
}
