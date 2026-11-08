import { readFile, stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createPublicKey } from "node:crypto";
import { verifySnapshot } from "../netlify/lib/retained-master.mjs";
import { hashMasterBytes } from "../netlify/lib/master-provenance.mjs";

const args = process.argv.slice(2);
const value = flag => {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : "";
};
try {
  const manifestPath = value("--manifest"), keyPath = value("--key"), audioPath = value("--audio");
  if (!manifestPath || !keyPath) throw new Error("Usage: node scripts/verify-master-snapshot.mjs --manifest record.json --key trusted-public.pem [--audio master.wav]");
  if ((await stat(manifestPath)).size > 64 * 1024 || (await stat(keyPath)).size > 16 * 1024) throw new Error("Manifest or key file exceeds its size limit");
  const envelope = JSON.parse(await readFile(manifestPath, "utf8"));
  const key = createPublicKey(await readFile(keyPath, "utf8"));
  if (key.asymmetricKeyType !== "ed25519") throw new Error("A trusted Ed25519 public key is required");
  if (!verifySnapshot(envelope, { publicKeys: new Map([[envelope.record?.keyId, key]]) })) throw new Error("Snapshot signature is invalid");
  const record = envelope.record;
  if (audioPath) {
    if ((await stat(audioPath)).size !== record.byteSize) throw new Error("File length differs from the signed snapshot");
    const digest = await hashMasterBytes(createReadStream(audioPath), { expectedBytes: record.byteSize, maxBytes: 200 * 1024 * 1024 });
    if (digest.sha256 !== record.sha256) throw new Error("File bytes differ from the signed snapshot");
  }
  console.log(JSON.stringify({ signature: "valid", recordId: record.recordId, file: audioPath ? "exact_bytes_match" : "not_checked",
    retention: Date.parse(record.retainUntil) > Date.now() ? "recorded_not_rechecked" : "recorded_retention_expired",
    ownership: "not_established", timestamp: "server_claim_not_independent" }));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
