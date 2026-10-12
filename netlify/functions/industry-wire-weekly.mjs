import { getStore } from "@netlify/blobs";
import { queueWeeklyWireDraft } from "../lib/industry-wire.mjs";

// Queues one internal-community draft per ISO week for the artist's take.
// Drafts stay out of the member feed until an operator publishes them.
export default async function industryWireWeeklyHandler() {
  const store = getStore({ name: "halo-industry-wire", consistency: "strong" });
  const { queued, post } = await queueWeeklyWireDraft(store, new Date());
  console.log("HALO Industry Wire weekly draft", { id: post?.id, queued, visibility: post?.visibility, status: post?.status });
}

export const config = {
  schedule: "0 9 * * 1"
};
