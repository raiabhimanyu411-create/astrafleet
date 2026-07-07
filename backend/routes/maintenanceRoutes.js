const express = require("express");
const router = express.Router();
const maintenance = require("../controllers/maintenanceController");
const { requireModuleAccess } = require("../middleware/accessControl");

router.use(maintenance.ensureMaintenanceSchema);
router.use(requireModuleAccess("maintenance"));

router.get("/", maintenance.getMaintenancePortal);
router.post("/automation/plan", maintenance.autoPlanDueWork);
router.post("/jobs/bulk", maintenance.createBulkJobs);
router.post("/jobs", maintenance.createJob);
router.put("/jobs/:id", maintenance.updateJob);
router.patch("/jobs/:id/bill", maintenance.updateBillStatus);
router.patch("/jobs/:id/complete", maintenance.completeJob);
router.get("/jobs/:id/notes", maintenance.getJobNotes);
router.post("/jobs/:id/notes", maintenance.addJobNote);
router.post("/defects/:defectId/job", maintenance.createJobFromDefect);
router.patch("/defects/:defectId/workflow", maintenance.updateDefectWorkflow);
router.post("/vehicles/:vehicleId/inspection-done", maintenance.markVehicleInspectionDone);
router.post("/trailers/:trailerId/inspection-done", maintenance.markTrailerInspectionDone);
router.post("/breakdown", maintenance.reportBreakdown);
router.post("/vor", maintenance.setVorStatus);
router.post("/events/done", maintenance.completeEventFromSchedule);

module.exports = router;
