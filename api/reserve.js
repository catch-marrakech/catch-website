// POST /api/reserve — create a reservation request.
const { redis, serviceToday, addDays, slotMinutes, score, json, clean, newRef, notify } = require('./_lib');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });

  const b = typeof req.body === 'object' && req.body ? req.body : {};

  // Honeypot: bots fill the hidden "website" field. Pretend success.
  if (b.website) return json(res, 200, { ok: true, ref: newRef() });

  const date = clean(b.date, 10);
  const time = clean(b.time, 5);
  const guests = Number(b.guests);
  const name = clean(b.name, 80);
  const phone = clean(b.phone, 30);
  const email = clean(b.email, 120);
  const notes = clean(b.notes, 500);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return json(res, 400, { error: 'Please choose a valid date.' });
  const mins = slotMinutes(time);
  if (mins == null) return json(res, 400, { error: 'Please choose a valid time.' });
  if (!Number.isInteger(guests) || guests < 1 || guests > 12) return json(res, 400, { error: 'Please choose 1 to 12 guests.' });
  if (!name) return json(res, 400, { error: 'Please enter your name.' });
  if (phone.replace(/\D/g, '').length < 8) return json(res, 400, { error: 'Please enter a valid phone number.' });
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json(res, 400, { error: 'Please check your email address.' });

  const today = serviceToday();
  if (date < today.date || date > addDays(today.date, 90)) return json(res, 400, { error: 'Please choose a date within the next 90 days.' });
  if (date === today.date && mins < today.minutes + 30) return json(res, 400, { error: 'That time has passed. Please choose a later time.' });

  try {
    // Simple rate limit: 8 bookings per IP per hour.
    const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
    const [count] = await redis([['INCR', 'rl:' + ip], ['EXPIRE', 'rl:' + ip, 3600]]);
    if (count > 8) return json(res, 429, { error: 'Too many requests. Please try again later or message us on Instagram.' });

    const ref = newRef();
    const item = {
      ref, date, time, guests, name, phone, email, notes,
      status: 'pending',
      createdAt: new Date().toISOString(),
    };
    await redis([
      ['SET', 'res:' + ref, JSON.stringify(item)],
      ['ZADD', 'res:index', score(date, mins), ref],
    ]);

    await notify(
      `New booking ${ref}: ${guests} guests, ${date} ${time}`,
      [
        `New reservation request (${ref})`,
        ``,
        `Date:   ${date}`,
        `Time:   ${time}`,
        `Guests: ${guests}`,
        `Name:   ${name}`,
        `Phone:  ${phone}`,
        `Email:  ${email || '-'}`,
        `Notes:  ${notes || '-'}`,
        ``,
        `Manage bookings: https://www.catchmarrakech.com/admin`,
      ].join('\n')
    );

    return json(res, 200, { ok: true, ref });
  } catch (e) {
    console.error(e);
    if (String(e.message).startsWith('DB_NOT_CONFIGURED')) {
      return json(res, 503, { error: 'Online booking is not available yet. Please message us on Instagram @catchmarrakech.' });
    }
    return json(res, 500, { error: 'Could not save your booking. Please try again or message us on Instagram.' });
  }
};
