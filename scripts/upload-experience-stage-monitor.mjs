export function hasSignal(text, signal) {
  if (typeof text !== "string") return false;
  if (signal instanceof RegExp) {
    const stateless = new RegExp(signal.source, signal.flags.replace(/[gy]/g, ""));
    return stateless.test(text);
  }
  return text.includes(signal);
}

export function signalLabel(signal) {
  return signal instanceof RegExp ? signal.toString() : signal;
}

export function collectMissingSignals(text, signals = []) {
  return signals.filter(signal => !hasSignal(text, signal));
}

export function runStageMonitor({ monitorName, checks, sources }) {
  const failures = [];

  for (const check of checks) {
    const text = sources[check.source];
    if (typeof text !== "string") {
      const missing = [`[missing source: ${check.source}]`];
      failures.push({ ...check, missing });
      console.log(`FAIL [${check.stage}] ${check.description}`);
      console.log(`  file: ${check.source}`);
      console.log(`  missing signals: ${missing.join(" | ")}`);
      console.log(`  diagnosis: ${check.diagnose}`);
      continue;
    }

    const missing = collectMissingSignals(text, check.signals);
    if (missing.length === 0) {
      console.log(`PASS [${check.stage}] ${check.description}`);
      continue;
    }

    failures.push({ ...check, missing });
    console.log(`FAIL [${check.stage}] ${check.description}`);
    console.log(`  file: ${check.source}`);
    console.log(`  missing signals: ${missing.map(signalLabel).join(" | ")}`);
    console.log(`  diagnosis: ${check.diagnose}`);
  }

  if (failures.length === 0) {
    console.log(`\n${monitorName}: ${checks.length}/${checks.length} checks passed.`);
  } else {
    console.log(`\n${monitorName}: ${checks.length - failures.length}/${checks.length} checks passed.`);
    console.log("\nFailing stages:");
    for (const failure of failures) {
      console.log(`- ${failure.stage} -> ${failure.diagnose}`);
    }
    process.exitCode = 1;
  }

  return failures;
}
