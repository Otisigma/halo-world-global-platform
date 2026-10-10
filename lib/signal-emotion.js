export function validSignalWord(word) {
  return typeof word === "string" && word === word.normalize("NFC") &&
    [...word].length >= 1 && [...word].length <= 20 && /^\p{L}+$/u.test(word);
}

export function validSignalTrack(id) {
  return typeof id === "string" && id.length >= 2 && id.length <= 96 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id);
}
