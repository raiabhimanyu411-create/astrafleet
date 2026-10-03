const { getDriverFromSession } = require("./driverController");
const { isExpoPushToken, registerToken, removeToken } = require("../utils/driverPush");

// POST /api/drivers/me/push-token
exports.registerMyPushToken = async (req, res) => {
  try {
    const driver = await getDriverFromSession(req);
    if (!driver) return res.status(404).json({ message: "Driver profile not linked to this login." });
    const { token, platform, appVersion } = req.body || {};
    if (!isExpoPushToken(token)) return res.status(400).json({ message: "A valid Expo push token is required." });
    await registerToken(driver.id, { token, platform, appVersion });
    res.json({ message: "Push notifications enabled on this device." });
  } catch (err) {
    res.status(500).json({ message: "Push token registration error", error: err.message });
  }
};

// DELETE /api/drivers/me/push-token
exports.removeMyPushToken = async (req, res) => {
  try {
    const driver = await getDriverFromSession(req);
    if (!driver) return res.status(404).json({ message: "Driver profile not linked to this login." });
    const token = req.body?.token;
    if (!isExpoPushToken(token)) return res.status(400).json({ message: "A valid Expo push token is required." });
    await removeToken(driver.id, token);
    res.json({ message: "Push notifications disabled on this device." });
  } catch (err) {
    res.status(500).json({ message: "Push token removal error", error: err.message });
  }
};
