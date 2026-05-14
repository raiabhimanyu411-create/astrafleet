const express = require("express");
const { getDriverPanel } = require("../controllers/panelController");
const { getOverview: getAdminOverview } = require("../controllers/adminController");

const router = express.Router();

router.get("/admin", getAdminOverview);
router.get("/driver", getDriverPanel);

module.exports = router;
