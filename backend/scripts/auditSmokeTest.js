const assert = require("assert");
const { buildChangeSet, reasonCategories, requireDeleteReason } = require("../utils/auditLogger");

function req(body) {
  return { body, query: {}, headers: {}, socket: {} };
}

assert(reasonCategories.has("duplicate"), "duplicate reason category should exist");

const missingReason = requireDeleteReason(req({ reasonCategory: "duplicate", reason: "" }));
assert.strictEqual(missingReason.ok, false, "delete without reason should fail");

const missingCategory = requireDeleteReason(req({ reason: "Wrong record" }));
assert.strictEqual(missingCategory.ok, false, "delete without category should fail");

const valid = requireDeleteReason(req({ reasonCategory: "wrong_assignment", reason: "Assigned to wrong vehicle" }));
assert.strictEqual(valid.ok, true, "delete with category and reason should pass");

const changes = buildChangeSet({ amount: 10, status: "draft" }, { amount: 12, status: "draft" }, ["amount", "status"]);
assert.deepStrictEqual(Object.keys(changes), ["amount"], "change set should only include changed fields");

console.log("audit smoke tests passed");
