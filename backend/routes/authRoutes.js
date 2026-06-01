const { Router } = require("express");
const { login, logout, registerEmployee } = require("../controllers/authController");

const router = Router();
router.post("/login", login);
router.post("/logout", logout);
router.post("/employees/register", registerEmployee);

module.exports = router;
