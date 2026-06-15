const express = require("express");
const router = express.Router();
const j = require("../controllers/jobController");
const { requireModuleAccess } = require("../middleware/accessControl");

router.use(requireModuleAccess("jobs"));

router.get("/form-data",  j.getFormData);
router.get("/",           j.listJobs);
router.get("/:id",        j.getJobById);
router.post("/",          j.createJob);
router.put("/:id",        j.updateJob);
router.patch("/:id/assignment", j.updateJobAssignment);
router.patch("/:id/status", j.updateJobStatus);
router.delete("/:id",     j.cancelJob);

module.exports = router;
