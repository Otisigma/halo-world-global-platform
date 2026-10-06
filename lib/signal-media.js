export const SIGNAL_MEDIA_MAX_BYTES = 4 * 1024 * 1024;
export const SIGNAL_MEDIA_TYPES = Object.freeze({
  "audio/mpeg": ["mp3"], "audio/wav": ["wav"], "audio/ogg": ["ogg", "oga"],
  "audio/mp4": ["m4a"], "audio/webm": ["webm"],
  "video/mp4": ["mp4"], "video/webm": ["webm"]
});

export function validateSignalMedia({ name, type, size }, bytes) {
  const extensions = SIGNAL_MEDIA_TYPES[type];
  if (!extensions || typeof name !== "string" || !extensions.includes(name.split(".").at(-1).toLowerCase())) {
    throw new Error("Use MP3, WAV, OGG, M4A, MP4 or WebM with a matching media type.");
  }
  if (!Number.isInteger(size) || size < 12 || size > SIGNAL_MEDIA_MAX_BYTES) {
    throw new Error("Attach a non-empty audio/video clip up to 4 MB.");
  }
  if (bytes) {
    const ascii = (start, end) => String.fromCharCode(...bytes.slice(start, end));
    const matches = type === "audio/mpeg" ? ascii(0, 3) === "ID3" || (bytes[0] === 255 && (bytes[1] & 224) === 224)
      : type === "audio/wav" ? ascii(0, 4) === "RIFF" && ascii(8, 12) === "WAVE"
      : type === "audio/ogg" ? ascii(0, 4) === "OggS"
      : type.endsWith("/mp4") ? ascii(4, 8) === "ftyp"
      : bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3;
    if (bytes.length !== size || !matches) throw new Error("The file content does not match its media type.");
  }
  return { name: name.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 160), type, size };
}

export function signalMediaKind(type) {
  return type.startsWith("video/") ? "VIDEO" : "AUDIO";
}

export function createObjectUrlAttachment(urls = URL) {
  let current = null;
  return {
    get current() { return current; },
    set(file) {
      const metadata = validateSignalMedia(file);
      const url = urls.createObjectURL(file);
      this.clear();
      current = { ...metadata, file, url };
      return current;
    },
    clear() {
      if (current) urls.revokeObjectURL(current.url);
      current = null;
    }
  };
}
