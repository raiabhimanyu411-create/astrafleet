import test from "node:test";
import assert from "node:assert/strict";
import { documentSubmission, filterMaintenanceDocuments } from "./maintenanceDocuments.js";

test("submission week uses UK midnight and ISO week year", () => {
  assert.equal(documentSubmission("2026-06-28T22:59:00Z").weekLabel, "26th week · 2026");
  assert.equal(documentSubmission("2026-06-28T23:00:00Z").weekLabel, "27th week · 2026");
  assert.equal(documentSubmission("2021-01-01T12:00:00Z").weekLabel, "53rd week · 2020");
  assert.equal(documentSubmission("2025-12-29T12:00:00Z").weekLabel, "1st week · 2026");
  assert.match(documentSubmission("2026-06-28T23:00:00Z").dateTime, /00:00/);
  assert.equal(documentSubmission(null), null);
  assert.equal(documentSubmission("bad date"), null);
});

test("MOT filter includes all vehicles and trailers beyond twelve records", () => {
  const documents = Array.from({ length: 30 }, (_, id) => ({
    id, serviceType: id === 29 ? "Insurance" : "MOT",
    assetType: id % 2 ? "trailer" : "vehicle", vehicle: `REG${id}`, fleetCode: `Fleet${id}`
  }));
  assert.equal(filterMaintenanceDocuments(documents, "MOT", "", "").length, 29);
  assert.equal(filterMaintenanceDocuments(documents, "MOT", "trailer", "").length, 14);
  assert.deepEqual(filterMaintenanceDocuments(documents, "MOT", "", " fleet28 ").map((d) => d.id), [28]);
  assert.equal(filterMaintenanceDocuments(documents, "MOT", "", "missing").length, 0);
});
