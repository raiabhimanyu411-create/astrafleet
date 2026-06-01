const express = require("express");
const { getDriverPanel } = require("../controllers/panelController");
const { getOverview: getAdminOverview } = require("../controllers/adminController");
const { requireAdmin } = require("../middleware/accessControl");

const router = express.Router();

router.get("/admin", requireAdmin, getAdminOverview);
router.get("/driver", getDriverPanel);

module.exports = router;
