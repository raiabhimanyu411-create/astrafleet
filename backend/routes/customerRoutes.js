const express = require("express");
const router = express.Router();
const c = require("../controllers/customerController");
const { requireModuleAccess } = require("../middleware/accessControl");

router.use(requireModuleAccess("customers"));

router.get("/", c.listCustomers);
router.get("/:id", c.getCustomerById);
router.post("/", c.createCustomer);
router.put("/:id", c.updateCustomer);
router.patch("/:id/status", c.updateCustomerStatus);
router.delete("/:id", c.deleteCustomer);

module.exports = router;
