const express = require("express");
const router = express.Router();
const maintenance = require("../controllers/maintenanceController");
const { requireModuleAccess } = require("../middleware/accessControl");

router.use(maintenance.ensureMaintenanceSchema);
router.use(requireModuleAccess("maintenance"));

router.get("/", maintenance.getMaintenancePortal);
router.post("/jobs", maintenance.createJob);
router.put("/jobs/:id", maintenance.updateJob);
router.patch("/jobs/:id/bill", maintenance.updateBillStatus);
router.patch("/jobs/:id/complete", maintenance.completeJob);
router.post("/defects/:defectId/job", maintenance.createJobFromDefect);
router.patch("/defects/:defectId/workflow", maintenance.updateDefectWorkflow);
router.post("/vehicles/:vehicleId/inspection-done", maintenance.markVehicleInspectionDone);

module.exports = router;
