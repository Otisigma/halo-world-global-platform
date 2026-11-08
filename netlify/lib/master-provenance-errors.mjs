export function provenanceFailure(error) {
  if (error?.code === "provenance_keys_missing") return {
    code: "provenance_keys_missing",
    message: "Master verification is currently unavailable. No verified stamp has been issued. Your uploaded audio is unaffected; you do not need to upload it again.",
  };
  if (error?.code === "42P01" || error?.code === "42703") return {
    code: "provenance_schema_missing",
    message: "Master verification is currently unavailable. No verified stamp has been issued. Your uploaded audio is unaffected; you do not need to upload it again.",
  };
  return {
    code: "provenance_unavailable",
    message: "We could not complete master verification. No verification result was confirmed. Your uploaded audio is unaffected; you do not need to upload it again.",
  };
}
