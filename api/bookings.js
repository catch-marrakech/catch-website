// /api/bookings — staff endpoint (header x-admin-key = BOOKINGS_PASSWORD, or ADMIN_PASSWORD as fallback)
//   GET  /api/bookings?from=YYYY-MM-DD&to=YYYY-MM-DD   → list reservations in range
//   POST /api/bookings { ref, status }                 → set status: pending | confirmed | cancelled | seated | no-show
//   POST /api/bookings { ref, action: "delete" }       → remove a reservation
const { redis, serviceToday, addDays, score, json } = require('./_lib');

const STATUSES = ['pending', 'confirmed', 'cancelled', 'seated', 'no-show'];

module.exports = async (req, res) => {
  const { isAdmin } = require('./_lib');
  const ok = isAdmin(req);
  if (ok === null) return json(res, 503, { error: 'BOOKINGS_PASSWORD is not set in Vercel yet.' });
  if (!ok) return json(res, 401, { error: 'Wrong password.' });

  try {
    if (req.method === 'GET') {
      const today = serviceToday().date;
      const q = req.query || {};
      const from = /^\d{4}-\d{2}-\d{2}$/.test(q.from || '') ? q.from : today;
      const to = /^\d{4}-\d{2}-\d{2}$/.test(q.to || '') ? q.to : addDays(today, 30);
      const [refs] = await redis([['ZRANGEBYSCORE', 'res:index', score(from, 0), score(to, 9999)]]);
      let items = [];
      if (refs && refs.length) {
        const [vals] = await redis([['MGET', ...refs.map((r) => 'res:' + r)]]);
        items = vals.filter(Boolean).map((v) => JSON.parse(v));
      }
      return json(res, 200, { from, to, today, items });
    }

    if (req.method === 'POST') {
      const b = typeof req.body === 'object' && req.body ? req.body : {};
      const ref = String(b.ref || '');
      if (!/^C-[A-Z0-9]{6}$/.test(ref)) return json(res, 400, { error: 'Bad reference.' });
      const [raw] = await redis([['GET', 'res:' + ref]]);
      if (!raw) return json(res, 404, { error: 'Reservation not found.' });

      if (b.action === 'delete') {
        await redis([['DEL', 'res:' + ref], ['ZREM', 'res:index', ref]]);
        return json(res, 200, { ok: true, deleted: ref });
      }
      if (!STATUSES.includes(b.status)) return json(res, 400, { error: 'Bad status.' });
      const item = JSON.parse(raw);
      item.status = b.status;
      item.updatedAt = new Date().toISOString();
      await redis([['SET', 'res:' + ref, JSON.stringify(item)]]);
      return json(res, 200, { ok: true, item });
    }

    return json(res, 405, { error: 'Method not allowed' });
  } catch (e) {
    console.error(e);
    if (String(e.message).startsWith('DB_NOT_CONFIGURED')) return json(res, 503, { error: 'The database is not connected yet.' });
    return json(res, 500, { error: 'Server error.' });
  }
};
