const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

// Replace the MySQL pool with an in-memory fake so the push rules run without a database.
const tokens = new Map();
let job = null;
const fakeDb = {
  async query(sql, params = []) {
    if (/CREATE TABLE/.test(sql)) return [{}];
    if (/INSERT INTO driver_push_tokens/.test(sql)) { tokens.set(params[1], params[0]); return [{}]; }
    if (/DELETE FROM driver_push_tokens WHERE driver_id/.test(sql)) { if (tokens.get(params[1]) === params[0]) tokens.delete(params[1]); return [{}]; }
    if (/DELETE FROM driver_push_tokens WHERE token/.test(sql)) { tokens.delete(params[0]); return [{}]; }
    if (/SELECT token FROM driver_push_tokens/.test(sql)) return [[...tokens].filter(([, id]) => id === params[0]).map(([token]) => ({ token }))];
    if (/FROM trips t/.test(sql)) return [[job]];
    throw new Error(`Unexpected query: ${sql}`);
  }
};
require.cache[path.resolve(__dirname, "../db/connection.js")] = { exports: fakeDb };

const sent = [];
let expoResponse = () => ({ ok: true, json: async () => ({ data: sent.at(-1).map(() => ({ status: "ok" })) }) });
global.fetch = async (_url, options) => { sent.push(JSON.parse(options.body)); return expoResponse(); };

const push = require("../utils/driverPush");
const flush = () => new Promise(resolve => setTimeout(resolve, 20));

test.beforeEach(() => {
  tokens.clear();
  sent.length = 0;
  job = { id: 7, trip_code: "AF-2048", driver_id: 3, planned_departure: "2026-07-15 08:15:00", pickup_label: "Manchester", drop_label: "Liverpool", registration_number: "MX24 AST", trailer_code: "TR-118" };
  expoResponse = () => ({ ok: true, json: async () => ({ data: sent.at(-1).map(() => ({ status: "ok" })) }) });
});

test("only Expo push tokens are accepted", () => {
  assert.equal(push.isExpoPushToken("ExponentPushToken[abc123]"), true);
  assert.equal(push.isExpoPushToken("ExpoPushToken[abc123]"), true);
  assert.equal(push.isExpoPushToken("fcm-raw-token"), false);
  assert.equal(push.isExpoPushToken(undefined), false);
});

test("new job push reaches the assigned driver with route and vehicle", async () => {
  await push.registerToken(3, { token: "ExponentPushToken[d3]", platform: "ios" });
  push.notifyJobEvent({ jobId: 7, source: "admin-create" });
  await flush();
  assert.equal(sent.length, 1);
  const [message] = sent[0];
  assert.equal(message.to, "ExponentPushToken[d3]");
  assert.equal(message.title, "New job assigned · AF-2048");
  assert.match(message.body, /Manchester → Liverpool/);
  assert.match(message.body, /Vehicle MX24 AST · Trailer TR-118/);
  assert.equal(message.sound, "default");
  assert.equal(message.channelId, "jobs");
  assert.deepEqual(message.data, { type: "job-assigned", jobId: 7 });
});

test("reassignment tells the new driver and the previous driver", async () => {
  await push.registerToken(3, { token: "ExponentPushToken[d3]" });
  await push.registerToken(9, { token: "ExponentPushToken[d9]" });
  push.notifyJobEvent({ jobId: 7, source: "admin-planner", previousDriverId: 9 });
  await flush();
  const titles = sent.flat().map(m => `${m.to} ${m.title}`).sort();
  assert.deepEqual(titles, ["ExponentPushToken[d3] New job assigned · AF-2048", "ExponentPushToken[d9] Job removed · AF-2048"]);
});

test("saving a job without changing the driver sends nothing", async () => {
  await push.registerToken(3, { token: "ExponentPushToken[d3]" });
  push.notifyJobEvent({ jobId: 7, source: "admin-edit", driverId: "3", previousDriverId: 3 });
  push.notifyJobEvent({ jobId: 7, source: "driver-status", status: "loaded" });
  await flush();
  assert.equal(sent.length, 0);
});

test("dispatch messages push, driver's own messages and assignment duplicates do not", async () => {
  await push.registerToken(3, { token: "ExponentPushToken[d3]" });
  push.notifyChatMessage({ id: 1, driverId: 3, senderRole: "admin", senderName: "Maya", body: "Gate code is 4471", tripId: 7 });
  push.notifyChatMessage({ id: 2, driverId: 3, senderRole: "driver", body: "On my way" });
  push.notifyChatMessage({ id: 3, driverId: 3, senderRole: "dispatch", body: "New job assigned: AF-2048. ..." });
  await flush();
  assert.equal(sent.length, 1);
  assert.equal(sent[0][0].title, "Maya");
  assert.equal(sent[0][0].channelId, "messages");
  assert.deepEqual(sent[0][0].data, { type: "message", messageId: 1, jobId: 7 });
});

test("uninstalled devices are removed from the token list", async () => {
  await push.registerToken(3, { token: "ExponentPushToken[gone]" });
  expoResponse = () => ({ ok: true, json: async () => ({ data: [{ status: "error", details: { error: "DeviceNotRegistered" } }] }) });
  push.notifyChatMessage({ id: 1, driverId: 3, senderRole: "admin", body: "Hello" });
  await flush();
  assert.equal(tokens.size, 0);
});

test("Expo outages and network errors never throw to the caller", async () => {
  await push.registerToken(3, { token: "ExponentPushToken[d3]" });
  const logged = [];
  const originalError = console.error;
  console.error = (...args) => logged.push(args.join(" "));
  try {
    expoResponse = () => { throw new Error("network down"); };
    assert.doesNotThrow(() => push.notifyJobEvent({ jobId: 7, source: "admin-create" }));
    expoResponse = () => ({ ok: false, status: 503, json: async () => ({ errors: ["unavailable"] }) });
    assert.doesNotThrow(() => push.notifyChatMessage({ id: 1, driverId: 3, senderRole: "admin", body: "Hi" }));
    assert.doesNotThrow(() => push.notifyJobEvent(undefined));
    assert.doesNotThrow(() => push.notifyChatMessage(null));
    await flush();
  } finally {
    console.error = originalError;
  }
  assert.equal(logged.length, 2);
});

test("DRIVER_PUSH_ENABLED=false switches all push off", async () => {
  await push.registerToken(3, { token: "ExponentPushToken[d3]" });
  process.env.DRIVER_PUSH_ENABLED = "false";
  try {
    push.notifyJobEvent({ jobId: 7, source: "admin-create" });
    push.notifyChatMessage({ id: 1, driverId: 3, senderRole: "admin", body: "Hi" });
    await flush();
  } finally {
    delete process.env.DRIVER_PUSH_ENABLED;
  }
  assert.equal(sent.length, 0);
});
