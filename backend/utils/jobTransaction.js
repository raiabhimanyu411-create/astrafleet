// Buffer HTTP responses and realtime events until the complete driver mutation commits.
function transactionalJobAction(pool, ensureSchema, emit, handler) {
  return async (req, res) => {
    let conn;
    try {
      await ensureSchema();
      conn = await pool.getConnection();
      await conn.beginTransaction();
      await conn.query('SELECT id FROM trips WHERE id=? FOR UPDATE', [req.params.jobId]);
      req.jobConnection = conn;
      req.jobEvents = [];
      let code = 200, body;
      const buffered = { status(value) { code = value; return this; }, json(value) { body = value; return this; } };
      await handler(req, buffered);
      if (code >= 400 || body === undefined) await conn.rollback();
      else { await conn.commit(); for (const event of req.jobEvents) emit(event); }
      res.status(body === undefined ? 500 : code).json(body || { message: 'Job update could not be completed.' });
    } catch (error) {
      if (conn) await conn.rollback();
      res.status(500).json({ message: 'Job update failed. Please retry.' });
    } finally {
      conn?.release(); delete req.jobConnection; delete req.jobEvents;
    }
  };
}
module.exports = { transactionalJobAction };
