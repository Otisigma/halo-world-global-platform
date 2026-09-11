import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { runStageMonitor } from "./upload-experience-stage-monitor.mjs";

const root = resolve(import.meta.dirname, "..");
const read = path => readFile(resolve(root, path), "utf8");

const [page, client, styles, api, netlifyConfig] = await Promise.all([
  read("upload-pipeline/index.html"),
  read("upload-pipeline/upload-pipeline.js"),
  read("upload-pipeline/upload-pipeline.css"),
  read("netlify/functions/upload-pipeline.mjs"),
  read("netlify.toml"),
]);

const sources = { page, client, styles, api, netlifyConfig };

const checks = [
  {
    stage: "auth hydration / access control",
    source: "client",
    description: "client keeps explicit pending, authenticated, and unauthenticated auth states",
    signals: [
      'authState: "pending"',
      'state.authState = "pending"',
      'state.authState = "unauthenticated"',
      'state.authState = state.authenticated ? "authenticated"',
      "setPendingAuthState",
      "setSignedOutState",
      "identityResolved",
      "onAuthChange",
      "halo-identity-ready",
    ],
    diagnose: "False sign-in risk: auth hydration state transitions are incomplete in upload-pipeline runtime.",
  },
  {
    stage: "auth hydration / access control",
    source: "api",
    description: "pipeline API returns hydration-safe unauthenticated GET response instead of hard 401",
    signals: [
      "await getUser(request)",
      "request.method === \"GET\"",
      "authenticated: false",
      "Sign in to access the upload pipeline",
      "ensureMembership",
    ],
    diagnose: "False sign-in risk: API auth handling cannot distinguish auth pending/unauthenticated states.",
  },
  {
    stage: "page bootstrap / runtime load",
    source: "page",
    description: "page mounts pipeline shell and required runtime assets",
    signals: [
      'id="pipelineShell"',
      'id="pipelineBoard"',
      'id="pipelineLoading"',
      'id="pipelineEmpty"',
      'id="pipelineTimeline"',
      'id="pipelineGuidanceCopy"',
      '/upload-pipeline/upload-pipeline.js',
      '/identity.js',
    ],
    diagnose: "Bootstrap stage failed: upload-pipeline shell or runtime scripts are missing.",
  },
  {
    stage: "page bootstrap / runtime load",
    source: "client",
    description: "client drives live fetch cycle and stage updates",
    signals: [
      "async function loadPipeline()",
      "fetch(`/api/upload-pipeline?department=",
      "elements.shell.setAttribute(\"aria-busy\", \"true\")",
      "elements.shell.setAttribute(\"aria-busy\", \"false\")",
      "action: \"set_stage\"",
      "renderInsights()",
    ],
    diagnose: "Bootstrap stage failed: runtime load and refresh loop is incomplete in upload-pipeline.js.",
  },
  {
    stage: "post-upload guidance / pipeline insights",
    source: "page",
    description: "page provides dedicated pipeline guidance/insight regions",
    signals: [
      "pipeline-insights",
      'id="pipelineStoryCopy"',
      'id="pipelineTrackTitle"',
      'id="pipelineTrackMeta"',
      'id="pipelineTrustSignal"',
      'id="pipelineCounts"',
    ],
    diagnose: "Guidance stage failed: upload-pipeline insight panel is missing required storytelling regions.",
  },
  {
    stage: "post-upload guidance / pipeline insights",
    source: "client",
    description: "runtime guidance and trust messaging updates by stage",
    signals: [
      "STAGE_GUIDANCE",
      "Trust signal:",
      "Next recommended stage:",
      "renderTimeline(stage)",
      "renderCounts(state.items)",
      "latestByUpdatedAt",
    ],
    diagnose: "Guidance stage failed: upload-pipeline runtime cannot report stage-specific guidance diagnostics.",
  },
  {
    stage: "deployment/runtime cache freshness",
    source: "netlifyConfig",
    description: "deploy config serves canonical /upload-pipeline/ route",
    signals: [
      'from = "/upload-pipeline/"',
      'to = "/upload-pipeline/index.html"',
    ],
    diagnose: "Deploy stage failed: /upload-pipeline/ routing contract is missing.",
  },
  {
    stage: "deployment/runtime cache freshness",
    source: "netlifyConfig",
    description: "deploy config disables stale cache for upload-pipeline bundle",
    signals: [
      'for = "/upload-pipeline/*"',
      'Cache-Control = "no-cache, no-store, must-revalidate"',
    ],
    diagnose: "Deploy stage failed: cache headers for /upload-pipeline/* are missing, stale bundles may mask runtime fixes.",
  },
  {
    stage: "pipeline status transitions",
    source: "api",
    description: "API enforces known pipeline stage values and persistence timestamps",
    signals: [
      "PIPELINE_STAGES",
      "pipeline_status",
      "pipeline_updated_at",
      "set_stage",
      "Song moved to",
    ],
    diagnose: "Pipeline stage contract failed: API stage transition persistence signals are missing.",
  },
  {
    stage: "pipeline status transitions",
    source: "styles",
    description: "styles keep stage chips and insight shell readable",
    signals: [
      "stage-uploaded",
      "stage-dreamweaver_in_progress",
      "stage-ready_for_radio",
      "stage-published",
      "pipeline-insights",
      "story-signal",
    ],
    diagnose: "Pipeline stage contract failed: visual stage signals are missing in upload-pipeline.css.",
  },
];

runStageMonitor({
  monitorName: "Upload pipeline watchdog",
  checks,
  sources,
});
