const express = require("express");
const router = express.Router();
const maintenance = require("../controllers/maintenanceController");
const compliance = require("../controllers/maintenanceComplianceController");
const { requireModuleAccess } = require("../middleware/accessControl");

router.use(maintenance.ensureMaintenanceSchema);
router.use(compliance.ensureComplianceSchema);
router.use(requireModuleAccess("maintenance"));

router.get("/", maintenance.getMaintenancePortal);
router.post("/reconcile", maintenance.reconcileFleetMaintenance);
router.post("/automation/plan", maintenance.autoPlanDueWork);
router.post("/jobs/bulk", maintenance.createBulkJobs);
router.post("/jobs", maintenance.createJob);
router.put("/jobs/:id", maintenance.updateJob);
router.patch("/jobs/:id/bill", maintenance.updateBillStatus);
router.get("/jobs/:id/document", maintenance.getJobDocument);
router.delete("/jobs/:id/document", maintenance.removeJobDocument);
router.patch("/jobs/:id/complete", maintenance.completeJob);
router.get("/jobs/:id/notes", maintenance.getJobNotes);
router.post("/jobs/:id/notes", maintenance.addJobNote);
router.post("/defects/:defectId/job", maintenance.createJobFromDefect);
router.patch("/defects/:defectId/workflow", maintenance.updateDefectWorkflow);
router.post("/breakdown", maintenance.reportBreakdown);
router.post("/vor", maintenance.setVorStatus);
router.post("/events/done", maintenance.completeEventFromSchedule);
router.patch("/events/:jobId/undo", maintenance.undoCompletedEvent);

router.get("/compliance", compliance.getCompliancePortal);
router.get("/compliance/documents/:source/:id", compliance.getComplianceDocument);
router.post("/compliance/inspections", compliance.createInspection);
router.patch("/compliance/inspection-items/:itemId/repair", compliance.repairInspectionItem);
router.patch("/compliance/inspections/:id/review", compliance.reviewInspection);
router.post("/compliance/mot-tests", compliance.createMotTest);
router.post("/compliance/frequencies", compliance.updateInspectionFrequency);
router.post("/compliance/providers", compliance.createProvider);
router.post("/compliance/recalls", compliance.createRecall);
router.patch("/compliance/recalls/:id/verify", compliance.verifyRecall);
router.post("/compliance/daily-checks", compliance.createDailyCheck);
router.post("/compliance/missed-inspections", compliance.recordMissedInspection);
router.get("/compliance/backup", compliance.getComplianceBackup);
router.get("/compliance/assets/:assetType/:assetId/audit-pack", compliance.getAuditPack);

module.exports = router;
