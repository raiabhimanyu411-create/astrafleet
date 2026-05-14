const express = require("express");
const router  = express.Router();
const v       = require("../controllers/vehicleController");

router.use(v.ensureVehicleSchema);

router.get("/",    v.listVehicles);
router.get("/:id", v.getVehicleById);
router.post("/",   v.createVehicle);
router.put("/:id", v.updateVehicle);
router.patch("/:id/status", v.updateVehicleStatus);

router.post("/:id/documents",              v.addDocument);
router.put("/:id/documents/:docId",        v.updateDocument);
router.delete("/:id/documents/:docId",     v.deleteDocument);

router.post("/:id/maintenance",            v.addMaintenance);
router.delete("/:id/maintenance/:recId",   v.deleteMaintenance);

router.post("/:id/inspections",            v.addInspection);

router.post("/:id/defects",                v.addDefect);
router.patch("/:id/defects/:defId",        v.updateDefectStatus);

module.exports = router;
