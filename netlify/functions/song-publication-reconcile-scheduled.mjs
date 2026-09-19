import { runReconcile } from "./song-publication-reconcile.mjs";

export default async function songPublicationReconcileScheduledHandler() {
  try {
    const summary = await runReconcile();
    console.log("Scheduled song publication reconcile completed", {
      repaired: summary.repaired,
      failed: summary.failed,
      scanned: summary.scanned,
    });
  } catch (error) {
    console.error("Scheduled song publication reconcile failed", error instanceof Error ? error.message : "unknown error");
    throw error;
  }
}

export const config = {
  schedule: "*/15 * * * *"
};
