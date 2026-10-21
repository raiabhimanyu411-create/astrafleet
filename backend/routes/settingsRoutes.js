const express = require("express");
const router = express.Router();
const ctrl = require("../controllers/settingsController");
const { requireAdmin, requireAnyModule, requireModuleAccess } = require("../middleware/accessControl");

// Admin Settings page: every setting with its label, help text, default and limits.
router.get("/schema", requireAdmin, ctrl.getSettingsSchema);
// Invoice / vehicle / maintenance screens: their defaults only, no costing figures.
router.get("/defaults", requireAnyModule(["billing", "vehicles", "maintenance"]), ctrl.getFormDefaults);
// The job form reads the costing rates to price a job; only an admin may change settings.
router.get("/", requireModuleAccess("jobs"), ctrl.getSettings);
router.put("/", requireAdmin, ctrl.updateSettings);

module.exports = router;
