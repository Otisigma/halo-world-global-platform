import { getDatabase } from "@netlify/database";
import { timingSafeEqual } from "node:crypto";

export const allowedEvents = new Set([
  "add_finished_mix_to_playlist",
  "analyze_ai_set",
  "artist_booking_open",
  "artist_mix_open",
  "artist_pro_application_error",
  "artist_pro_application_submit",
  "artist_pro_application_success",
  "artist_pro_form_start",
  "artist_radio_preview_open",
  "artist_radio_room_open",
  "artist_radio_rotation_open",
  "artist_radio_submit_open",
  "artist_release_open",
  "artist_video_open",
  "artist_website_open",
  "audio_check_failed",
  "build_dj_takeover",
  "build_visual_mix_timeline",
  "community_boost_sent",
  "community_gift_sent",
  "community_light_sent",
  "community_profile_updated",
  "companion_message_sent",
  "companion_opened",
  "complete_dj_takeover_recording",
  "compare_mix_version",
  "copy_mix_room_link",
  "creator_mix_upload",
  "cue_world_room",
  "deck_cue_trigger",
  "deck_play_toggle",
  "delete_track",
  "dj_booth_video_play",
  "download_dj_takeover_recording",
  "dj_package_toggle",
  "dreamweaver_campaign_generated",
  "dreamweaver_chapter",
  "dreamweaver_mode",
  "dreamweaver_song_analysis_started",
  "dreamweaver_song_loaded",
  "dreamweaver_song_package_ready",
  "eject_track",
  "enter_console",
  "enter_halo_movement",
  "execute_adaptive_move",
  "explore_halo_worlds",
  "focus_mode_toggle",
  "halo_dj_audience_signal",
  "halo_dj_mode",
  "halo_x_auth",
  "import_local_audio",
  "import_track",
  "install_halo_app",
  "join_halo_movement",
  "load_dj_takeover",
  "load_local_audio",
  "load_track",
  "load_youtube",
  "marketplace_drop_saved",
  "marketplace_filter_changed",
  "marketplace_founding_creator_interest",
  "marketplace_product_opened",
  "music_external_open",
  "music_playback_complete",
  "music_playback_milestone",
  "music_playback_start",
  "music_player_close",
  "music_player_open",
  "music_preview_continue",
  "music_preview_reached",
  "open_affiliate_gear",
  "open_artist_pro",
  "open_bug_report",
  "open_catalog_release",
  "open_creator_world",
  "open_dj_deck",
  "open_dreamweaver_campaign_studio",
  "open_dreamweaver_song_lab",
  "open_dreamweaver_show",
  "open_fan_guide",
  "open_featured_release",
  "open_feedback_desk",
  "open_finish_house",
  "open_halo_live",
  "open_halo_radio",
  "open_halo_signal",
  "open_halo_x",
  "open_halo_x_long_play",
  "open_halo_x_mix_edition_checkout",
  "open_halo_x_mixes",
  "open_iam_social",
  "open_inside_the_mix_episode",
  "open_live_runway",
  "open_music_catalog",
  "open_new_release",
  "open_opportunity_exchange",
  "open_owner_control_room",
  "open_payment",
  "open_release_house",
  "open_release_kit",
  "open_release_room",
  "open_release_selector_room",
  "open_social_profile",
  "open_sovereign_ambassador_path",
  "open_track_picker",
  "open_vip_briefing",
  "open_vip_launchpad",
  "page_view",
  "payment_checkout_failed",
  "payment_checkout_started",
  "perform_ai_transition",
  "pick_track_from_qr",
  "play_halo_video",
  "play_halo_x_mix",
  "play_room_mix",
  "playback_toggle",
  "prepare_ai_transition",
  "prepare_visual_mix_render_brief",
  "publish_finished_mix",
  "publish_halo_video",
  "queue_track",
  "radio_heartbeat",
  "radio_skip",
  "radio_tune_in",
  "radio_tune_out",
  "release_campaign_saved",
  "release_context_opened",
  "release_next_action_opened",
  "release_pack_response",
  "release_project_created",
  "release_project_opened",
  "release_room_completed",
  "release_room_page_shared",
  "release_social_caption_copied",
  "release_social_link_copied",
  "release_social_platform_opened",
  "release_social_share_opened",
  "run_dj_set_preflight",
  "safe_space_message",
  "select_console_tab",
  "select_takeover_dj",
  "select_track",
  "select_world_room",
  "send_chat_message",
  "send_community_message",
  "signal_report_shared",
  "start_dj_takeover",
  "start_dj_takeover_recording",
  "stem_collector_kit_built",
  "stem_cut_toggle",
  "stem_vault_pack_saved",
  "submit_bug_report",
  "support_card_toggle",
  "swap_tracks",
  "sync_decks",
  "sync_telemetry",
  "take_cued_world_live",
  "toggle_adaptive_mode",
  "toggle_filter",
  "upload_drive_audio"
]);

const allowedMetadataKeys = new Set([
  "action",
  "deck",
  "method",
  "mode",
  "source_type",
  "state",
  "success",
  "tab",
  "target",
  "view",
  "room",
  "station",
  "track",
  "artist",
  "stage",
  "goal",
  "plan",
  "seconds",
  "position",
  "mix_id",
  "mix_title",
  "chapter",
  "campaign_id",
  "project_id",
  "file_type",
  "model",
  "report_id",
  "platform",
  "variant"
]);

const numericMetadataKeys = new Set(["seconds", "position"]);

export function getStatsDatabase() {
  return getDatabase();
}

export function cleanIdentifier(value) {
  if (typeof value !== "string") return "";
  const cleaned = value.trim();
  return /^[a-zA-Z0-9_-]{8,64}$/.test(cleaned) ? cleaned : "";
}

export function cleanPagePath(value) {
  if (typeof value !== "string") return "/";
  const path = value.split("?")[0].split("#")[0].trim();
  return path.startsWith("/") ? path.slice(0, 256) : "/";
}

export function cleanMetadata(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};

  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => allowedMetadataKeys.has(key))
      .slice(0, 10)
      .flatMap(([key, item]) => {
        if (numericMetadataKeys.has(key)) {
          if (typeof item !== "number" || !Number.isFinite(item)) return [];
          return [[key, Math.min(Math.max(Math.round(item), 0), 86_400)]];
        }
        if (typeof item === "boolean") return [[key, item]];
        if (typeof item === "number") {
          if (!Number.isFinite(item)) return [];
          return [[key, Math.min(Math.max(Math.round(item), 0), 86_400)]];
        }
        if (typeof item === "string") return [[key, item.trim().slice(0, 80)]];
        return [];
      })
  );
}

export function jsonResponse(body, status = 200, extraHeaders = {}) {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      ...extraHeaders
    }
  });
}

/**
 * Bearer-token check for operator-only analytics endpoints, using the same
 * STATS_ADMIN_TOKEN that guards the stats summary.
 */
export function authorizeStatsAdmin(request) {
  const expectedToken = process.env.STATS_ADMIN_TOKEN;
  if (!expectedToken) return false;

  const authorization = request.headers.get("authorization") || "";
  const suppliedToken = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  const expected = Buffer.from(expectedToken);
  const supplied = Buffer.from(suppliedToken);

  return expected.length === supplied.length && timingSafeEqual(expected, supplied);
}
