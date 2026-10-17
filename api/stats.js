// GET /api/stats?from=YYYY-MM-DD&to=YYYY-MM-DD
// Booking figures for the Catch Gestion dashboard. Requires a valid Catch Gestion (Supabase) login:
// header "Authorization: Bearer <access token>". Returns no names or phone numbers.
const { redis, score, json } = require('./_lib');
const cfg = require('../gestion/config.json');

async function validUser(req) {
  const auth = String(req.headers.authorization || '');
  if (!/^Bearer\s+\S+/.test(auth)) return false;
  const url = process.env.SUPABASE_URL || cfg.supabaseUrl;
  const key = process.env.SUPABASE_ANON_KEY || cfg.supabaseKey;
  if (!url || !key || /PLACEHOLDER/.test(url + key)) return false;
  try {
    const r = await fetch(url.replace(/\/$/, '') + '/auth/v1/user', { headers: { apikey: key, Authorization: auth } });
    return r.ok;
  } catch (e) {
    return false;
  }
}

module.exports = async (req, res) => {
  if (req.method !== 'GET') return json(res, 405, { error: 'Method not allowed' });
  if (!(await validUser(req))) return json(res, 401, { error: 'Non autorisé' });

  const q = req.query || {};
  const re = /^\d{4}-\d{2}-\d{2}$/;
  if (!re.test(q.from || '') || !re.test(q.to || '') || q.from > q.to) return json(res, 400, { error: 'Dates invalides' });
  if ((new Date(q.to) - new Date(q.from)) / 864e5 > 400) return json(res, 400, { error: 'Période trop longue' });

  try {
    const [refs] = await redis([['ZRANGEBYSCORE', 'res:index', score(q.from, 0), score(q.to, 9999)]]);
    let items = [];
    if (refs && refs.length) {
      const out = [];
      for (let i = 0; i < refs.length; i += 500) {
        const [vals] = await redis([['MGET', ...refs.slice(i, i + 500).map((r) => 'res:' + r)]]);
        vals.forEach((v) => { if (v) out.push(JSON.parse(v)); });
      }
      items = out.map((b) => ({ date: b.date, time: b.time, guests: b.guests, status: b.status, createdAt: b.createdAt }));
    }
    return json(res, 200, { from: q.from, to: q.to, items });
  } catch (e) {
    console.error(e);
    return json(res, 500, { error: 'Erreur serveur' });
  }
};
