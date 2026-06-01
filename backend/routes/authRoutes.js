const { Router } = require("express");
const { getMyProfile, login, logout, registerEmployee, updateMyProfile } = require("../controllers/authController");

const router = Router();
router.post("/login", login);
router.post("/logout", logout);
router.get("/me", getMyProfile);
router.patch("/me", updateMyProfile);
router.post("/employees/register", registerEmployee);

module.exports = router;
