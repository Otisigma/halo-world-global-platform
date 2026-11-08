export function provenanceFailure(error) {
  if (error?.code === "provenance_keys_missing") return {
    code: "provenance_keys_missing",
    message: "Master integrity signing keys are not configured. The site operator must set HALO_PROVENANCE_ACTIVE_KEY and HALO_PROVENANCE_KEYS, then redeploy. Your uploaded audio is unaffected.",
  };
  if (error?.code === "42P01" || error?.code === "42703") return {
    code: "provenance_schema_missing",
    message: "Master integrity database setup is incomplete. The site operator must apply the master_provenance_observations migration, then refresh this panel. Your uploaded audio is unaffected.",
  };
  return {
    code: "provenance_unavailable",
    message: "Master integrity could not complete this request. Refresh history and retry; if it persists, the site operator must check database and storage connectivity. Your uploaded audio is unaffected.",
  };
}
