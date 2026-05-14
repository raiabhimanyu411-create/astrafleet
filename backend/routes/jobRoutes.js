const express = require("express");
const router = express.Router();
const j = require("../controllers/jobController");

router.get("/form-data",  j.getFormData);
router.get("/",           j.listJobs);
router.get("/:id",        j.getJobById);
router.post("/",          j.createJob);
router.put("/:id",        j.updateJob);
router.patch("/:id/status", j.updateJobStatus);
router.delete("/:id",     j.cancelJob);

module.exports = router;
