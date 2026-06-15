const express = require("express");
const router  = express.Router();
const d       = require("../controllers/driverController");
const { requireModuleAccess } = require("../middleware/accessControl");

router.get("/me/panel",                    d.getMyDriverPanel);
router.get("/me/notifications",            d.getMyNotifications);
router.patch("/me/jobs/:jobId/status",     d.updateMyJobStatus);
router.patch("/me/jobs/:jobId/eta",        d.updateJobEta);
router.post("/me/jobs/:jobId/pod",         d.submitMyProofOfDelivery);
router.post("/me/jobs/:jobId/reschedule",  d.rescheduleJob);
router.post("/me/shift/start",             d.startMyShift);
router.post("/me/shift/end",               d.endMyShift);
router.post("/me/expenses",                d.createMyExpense);
router.post("/me/defects",                 d.createMyDefectReport);
router.post("/me/walkaround",              d.submitWalkaround);
router.post("/me/odometer",               d.logOdometer);
router.get("/me/messages",                 d.getMyMessages);
router.post("/me/messages",                d.sendMyMessage);
router.post("/me/location",                d.updateMyLocation);

router.get("/",                          requireModuleAccess("drivers"), d.listDrivers);
router.get("/:id",                       requireModuleAccess("drivers"), d.getDriverById);
router.post("/",                         requireModuleAccess("drivers"), d.createDriver);
router.patch("/:id/inline",              requireModuleAccess("drivers"), d.updateDriverInline);
router.put("/:id",                       requireModuleAccess("drivers"), d.updateDriver);
router.delete("/:id",                    requireModuleAccess("drivers"), d.deleteDriver);
router.post("/:id/documents",            requireModuleAccess("drivers"), d.addDocument);
router.put("/:id/documents/:docId",      requireModuleAccess("drivers"), d.updateDocument);
router.delete("/:id/documents/:docId",   requireModuleAccess("drivers"), d.deleteDocument);

module.exports = router;
