import { cleanText } from "../lib/halo-x.mjs";
import { appendLedgerEntry } from "../lib/halo-ledger.mjs";
import { reconcilePublishedSong } from "../lib/song-publication.mjs";
import { buildDreamweaverSatellite } from "../../lib/route-registry.js";

function json(body, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export default async function handler(request) {
  return json({
    ok: true,
    dreamweaverSatellite: buildDreamweaverSatellite("00000000-0000-4000-8000-000000000000"),
  });
}
