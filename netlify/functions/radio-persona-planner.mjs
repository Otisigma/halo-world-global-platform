import { getDatabase } from "@netlify/database";
import { evaluatePersonas, planPersonaSet, upcomingPersonaSlots } from "../lib/radio-personas.mjs";

const PLAN_HORIZON_HOURS = 36;
const MAX_PLANS_PER_RUN = 6;

/**
 * Builds sets ahead of air for persona-hosted shows, and recomputes levels once a day.
 *
 * Nothing this function writes reaches a listener. Every set it creates is stored as `planned` and
 * needs an owner to approve it before it can be aired.
 */
export default async function radioPersonaPlannerHandler() {
  const db = await getDatabase();
  const slots = await upcomingPersonaSlots(db, PLAN_HORIZON_HOURS);
  const planned = [];
  const skipped = [];

  for (const slot of slots) {
    if (planned.length >= MAX_PLANS_PER_RUN) {
      skipped.push({ showId: slot.showId, reason: "run_limit" });
      continue;
    }

    const existing = await db.sql`
      SELECT id, status FROM halo_radio_persona_sets
      WHERE persona_id = ${slot.personaId} AND planned_for = ${slot.plannedFor}::timestamptz
      LIMIT 1
    `;
    if (existing.length) {
      skipped.push({ showId: slot.showId, reason: `already_${existing[0].status}` });
      continue;
    }

    try {
      const result = await planPersonaSet(db, {
        personaId: slot.personaId,
        plannedFor: slot.plannedFor,
        durationMinutes: slot.durationMinutes,
        showId: slot.showId,
        room: slot.room
      });
      if (result?.stored) {
        planned.push({
          personaId: slot.personaId,
          showId: slot.showId,
          plannedFor: slot.plannedFor,
          tracks: result.stored.tracks.length,
          talkLinesKept: result.stored.talkLinesKept,
          talkLinesDropped: result.stored.talkLinesDropped,
          usedFallback: result.stored.usedFallback
        });
      } else {
        skipped.push({ showId: slot.showId, reason: result?.reason || "not_planned" });
      }
    } catch (error) {
      // One resident's bad hour must not stop the rest of the grid being planned.
      skipped.push({ showId: slot.showId, reason: "error" });
      console.error(
        "HALO persona set planning failed",
        slot.showId,
        error instanceof Error ? error.message : "unknown error"
      );
    }
  }

  // Levels are recomputed once a day rather than on every planning pass.
  let evaluation = null;
  if (new Date().getUTCHours() === 6) {
    evaluation = await evaluatePersonas(db, { windowDays: 30 });
  }

  console.log("HALO radio persona planner finished", {
    slotsConsidered: slots.length,
    planned: planned.length,
    skipped: skipped.length,
    levelsRecomputed: evaluation ? evaluation.results.length : 0,
    levelChanges: evaluation
      ? evaluation.results.filter(result => result.levelAfter !== result.levelBefore).length
      : 0
  });
}

export const config = {
  schedule: "40 */6 * * *"
};
