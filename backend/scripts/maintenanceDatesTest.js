const { test } = require("node:test");
const assert = require("node:assert/strict");
const { dateFieldError, isDateKey, optionalMoney, ukDateKey } = require("../utils/maintenanceDates");

test("UK date uses Europe/London calendar boundaries", () => {
  assert.equal(ukDateKey(new Date("2026-06-28T22:59:59Z")), "2026-06-28");
  assert.equal(ukDateKey(new Date("2026-06-28T23:00:00Z")), "2026-06-29");
  assert.equal(ukDateKey(new Date("2026-12-31T23:59:59Z")), "2026-12-31");
});

test("maintenance dates reject impossible and future actual dates", () => {
  assert.equal(isDateKey("2026-02-29"), false);
  assert.equal(isDateKey("2024-02-29"), true);
  assert.equal(dateFieldError("2026-09-16", "Date done", { future: false, today: "2026-09-15" }), "Date done cannot be after today in the UK.");
  assert.equal(dateFieldError("2026-09-15", "Date done", { future: false, today: "2026-09-15" }), "");
  assert.equal(dateFieldError("", "Date done", { required: true }), "Date done is required.");
});

test("optional money preserves a real zero and leaves missing values empty", () => {
  assert.equal(optionalMoney(0), 0);
  assert.equal(optionalMoney("0.00"), 0);
  assert.equal(optionalMoney("12.50"), 12.5);
  assert.equal(optionalMoney(""), null);
  assert.equal(optionalMoney(undefined), null);
  assert.equal(optionalMoney("bad"), null);
  assert.equal(optionalMoney(-1), null);
});
