// Only call after the catalog write has completed. Jobs must not ingest or finalize uploads.
export async function runConfirmedUploadJobs(jobs) {
  const names = new Set();
  for (const job of jobs) {
    if (!job.name || names.has(job.name) || typeof job.run !== "function") {
      throw new TypeError("Post-confirmation jobs need unique names and lazy functions");
    }
    names.add(job.name);
  }
  const settled = await Promise.allSettled(jobs.map(job => Promise.resolve().then(() => job.run())));
  const results = settled.map((result, index) => ({ name: jobs[index].name, ...result }));
  const failures = results.filter((result, index) => result.status === "rejected" && jobs[index].required !== false);
  for (const result of results) {
    if (result.status === "rejected" && !failures.includes(result)) {
      console.warn("Optional post-confirmation job failed:", result.name);
    }
  }
  if (failures.length) {
    throw new AggregateError(failures.map(result => result.reason),
      `Post-confirmation jobs failed: ${failures.map(result => result.name).join(", ")}`);
  }
  return results;
}
