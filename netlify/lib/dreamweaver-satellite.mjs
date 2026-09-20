import { buildDreamweaverSongPage } from "./dreamweaver-page-manager.mjs";

export function dreamweaverSatellite(songId, options = {}) {
  return buildDreamweaverSongPage(songId, options);
}
