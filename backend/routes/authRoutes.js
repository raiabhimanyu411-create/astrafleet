const { Router } = require("express");
const { login, registerEmployee } = require("../controllers/authController");

const router = Router();
router.post("/login", login);
router.post("/employees/register", registerEmployee);

module.exports = router;
