const express = require("express");
const router = express.Router();
const j = require("../controllers/jobController");
const { requireModuleAccess } = require("../middleware/accessControl");

router.use(requireModuleAccess("jobs"));

router.get("/form-data",  j.getFormData);
router.post("/estimate-route", j.estimateRouteFromAddresses);
router.get("/",           j.listJobs);
router.get("/:id",        j.getJobById);
router.post("/",          j.createJob);
router.put("/:id",        j.updateJob);
router.patch("/:id/assignment", j.updateJobAssignment);
router.patch("/:id/replace-vehicle", j.replaceJobVehicle);
router.patch("/:id/status", j.updateJobStatus);
router.get("/:id/notes",         j.getJobNotes);
router.post("/:id/notes",        j.addJobNote);
router.post("/:id/stops",        j.addJobStop);
router.delete("/:id/stops/:stopId", j.deleteJobStop);
router.delete("/:id",            j.cancelJob);

module.exports = router;
