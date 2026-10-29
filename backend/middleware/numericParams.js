// Route ids such as :id or :jobId must be whole numbers. Anything else gets a clear 400 instead of
// reaching SQL (where "abc" or "undefined" used to cause a 500 error).
function numericParams(router, names) {
  for (const name of names) {
    router.param(name, (req, res, next, value) => {
      if (/^\d+$/.test(String(value))) return next();
      return res.status(400).json({ message: `Invalid ${name}.` });
    });
  }
  return router;
}

module.exports = { numericParams };
