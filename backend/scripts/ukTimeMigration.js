// Preview (default) or apply the one-time conversion of old maintenance times to UK time.
//   node scripts/ukTimeMigration.js            → dry run: shows what would change, writes nothing
//   node scripts/ukTimeMigration.js --apply    → converts now (normally the server does this on start)
// Set LEGACY_DB_TIME_ZONE=Asia/Kolkata (or UTC, …) if the old MySQL timezone cannot be detected.
const { runLegacyUkTimeMigration } = require("../utils/legacyUkTimeMigration");

(async () => {
  const apply = process.argv.includes("--apply");
  const result = await runLegacyUkTimeMigration({ dryRun: !apply });
  console.log(`Status: ${result.status}${result.from ? ` · old MySQL timezone ${result.from} → ${result.zone}` : ""}${result.reason ? ` · ${result.reason}` : ""}`);
  for (const item of result.summary || []) {
    console.log(`${item.column.padEnd(44)} ${String(item.changed).padStart(5)} of ${String(item.rows).padEnd(5)}${item.sample ? ` e.g. #${item.sample.id}: ${item.sample.before} → ${item.sample.after}` : ""}`);
  }
  process.exit(result.status === "failed" ? 1 : 0);
})().catch(error => {
  console.error(error.message);
  process.exit(1);
});
