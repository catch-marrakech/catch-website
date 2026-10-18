// POST /api/reserve — create a reservation request from the website.
// Saves into Catch's Supabase through the create_reservation() function, which also links the booking
// to the guest's profile (matched by phone number).
const { redis, serviceToday, addDays, slotMinutes, json, clean, newRef, notify } = require('./_lib');
const cfg = require('../gestion/config.json');

async function supabaseReserve(args) {
  const url = (process.env.SUPABASE_URL || cfg.supabaseUrl).replace(/\/$/, '');
  const key = process.env.SUPABASE_ANON_KEY || cfg.supabaseKey;
  const r = await fetch(url + '/rest/v1/rpc/create_reservation', {
    method: 'POST',
    headers: { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
  const body = await r.json().catch(() => null);
  if (!r.ok) throw new Error('SUPABASE ' + r.status + ' ' + JSON.stringify(body));
  return body; // the reference, e.g. "C-AB12CD"
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });

  const b = typeof req.body === 'object' && req.body ? req.body : {};

  // Honeypot: bots fill the hidden "website" field. Pretend success.
  if (b.website) return json(res, 200, { ok: true, ref: newRef() });

  const fr = b.lang === 'fr';
  const t = (en, frText) => (fr ? frText : en);
  const date = clean(b.date, 10);
  const time = clean(b.time, 5);
  const guests = Number(b.guests);
  const name = clean(b.name, 80);
  const phone = clean(b.phone, 30);
  const email = clean(b.email, 120);
  const notes = clean(b.notes, 500);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return json(res, 400, { error: t('Please choose a valid date.', 'Veuillez choisir une date valide.') });
  const mins = slotMinutes(time);
  if (mins == null) return json(res, 400, { error: t('Please choose a valid time.', 'Veuillez choisir une heure valide.') });
  if (!Number.isInteger(guests) || guests < 1 || guests > 12) return json(res, 400, { error: t('Please choose 1 to 12 guests.', 'Veuillez choisir de 1 à 12 personnes.') });
  if (!name) return json(res, 400, { error: t('Please enter your name.', 'Veuillez indiquer votre nom.') });
  if (phone.replace(/\D/g, '').length < 8) return json(res, 400, { error: t('Please enter a valid phone number.', 'Veuillez indiquer un numéro de téléphone valide.') });
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json(res, 400, { error: t('Please check your email address.', 'Veuillez vérifier votre adresse e-mail.') });

  const today = serviceToday();
  if (date < today.date || date > addDays(today.date, 90)) return json(res, 400, { error: t('Please choose a date within the next 90 days.', 'Veuillez choisir une date dans les 90 prochains jours.') });
  if (date === today.date && mins < today.minutes + 30) return json(res, 400, { error: t('That time has passed. Please choose a later time.', 'Cet horaire est passé. Veuillez choisir une heure plus tardive.') });

  // Simple rate limit: 8 bookings per IP per hour (skipped if the rate-limit store is unavailable).
  try {
    const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
    const [count] = await redis([['INCR', 'rl:' + ip], ['EXPIRE', 'rl:' + ip, 3600]]);
    if (count > 8) return json(res, 429, { error: t('Too many requests. Please try again later or message us on Instagram.', 'Trop de demandes. Réessayez plus tard ou écrivez-nous sur Instagram.') });
  } catch (e) {
    console.error('rate limit unavailable', e.message);
  }

  try {
    const ref = await supabaseReserve({ p_date: date, p_time: time, p_guests: guests, p_name: name, p_phone: phone, p_email: email || null, p_notes: notes || null });

    await notify(
      `New booking ${ref}: ${guests} guests, ${date} ${time}${fr ? ' (FR)' : ''}`,
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
        `Manage bookings: https://www.catchmarrakech.com/bookings`,
      ].join('\n')
    );

    return json(res, 200, { ok: true, ref });
  } catch (e) {
    console.error(e);
    return json(res, 500, { error: t('Could not save your booking. Please try again or message us on Instagram.', 'Impossible d’enregistrer votre réservation. Réessayez ou écrivez-nous sur Instagram.') });
  }
};
