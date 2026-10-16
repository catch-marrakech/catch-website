// Shared helpers for the reservation API (files starting with "_" are not exposed as routes).
const crypto = require('crypto');

const TZ = 'Africa/Casablanca';

// ---- Redis (Upstash REST) ----
function redisConfig() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) throw new Error('DB_NOT_CONFIGURED');
  return { url: url.replace(/\/$/, ''), token };
}

// Run several Redis commands in one request. Returns an array of results.
async function redis(commands) {
  const { url, token } = redisConfig();
  const r = await fetch(url + '/pipeline', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify(commands),
  });
  if (!r.ok) throw new Error('DB_ERROR ' + r.status);
  const out = await r.json();
  return out.map((x) => {
    if (x.error) throw new Error('DB_ERROR ' + x.error);
    return x.result;
  });
}

// ---- time helpers (Marrakech) ----
function nowInMarrakech() {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(new Date()).map((x) => [x.type, x.value])
  );
  return { date: `${p.year}-${p.month}-${p.day}`, minutes: Number(p.hour) * 60 + Number(p.minute) };
}
function addDays(iso, n) {
  const d = new Date(iso + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
// Service day: before 02:00 it is still the previous evening's service.
function serviceToday() {
  const n = nowInMarrakech();
  return n.minutes < 120 ? { date: addDays(n.date, -1), minutes: n.minutes + 1440 } : n;
}

// Slots 18:00 → 01:00 every 30 min, as minutes from the service day's midnight (01:00 = 1500).
const SLOTS = [];
for (let m = 18 * 60; m <= 25 * 60; m += 30) SLOTS.push(m);
function slotMinutes(hhmm) {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm || '');
  if (!m) return null;
  let mins = Number(m[1]) * 60 + Number(m[2]);
  if (mins < 6 * 60) mins += 1440;
  return SLOTS.includes(mins) ? mins : null;
}
// Sortable number: YYYYMMDD * 10000 + minutes
function score(date, mins) {
  return Number(date.replace(/-/g, '')) * 10000 + mins;
}

// ---- misc ----
function json(res, status, body) {
  res.setHeader('Cache-Control', 'no-store');
  res.status(status).json(body);
}
function clean(s, max) {
  return String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);
}
function newRef() {
  const a = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (const b of crypto.randomBytes(6)) s += a[b % a.length];
  return 'C-' + s;
}

// Staff check: header "x-admin-key" must equal BOOKINGS_PASSWORD (ADMIN_PASSWORD still accepted as fallback).
function isAdmin(req) {
  const pass = process.env.BOOKINGS_PASSWORD || process.env.ADMIN_PASSWORD;
  if (!pass) return null; // not configured
  const given = String(req.headers['x-admin-key'] || '');
  const a = crypto.createHash('sha256').update(given).digest();
  const b = crypto.createHash('sha256').update(pass).digest();
  return crypto.timingSafeEqual(a, b);
}

// Optional email notification through Resend (only if RESEND_API_KEY is set).
async function notify(subject, text) {
  const key = process.env.RESEND_API_KEY;
  if (!key) return false;
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: process.env.RESEND_FROM || 'Catch Marrakech <reservations@catchmarrakech.com>',
        to: (process.env.NOTIFY_EMAIL || 'info@catchmarrakech.com').split(',').map((s) => s.trim()),
        subject,
        text,
      }),
    });
    return r.ok;
  } catch (e) {
    return false;
  }
}

module.exports = { redis, nowInMarrakech, addDays, serviceToday, slotMinutes, score, json, clean, newRef, isAdmin, notify };
