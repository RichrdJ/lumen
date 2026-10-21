import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { checkPassword, config } from './config.js';

// Cookie sessions: "<payload>.<hmac>". The HMAC key mixes a per-install secret with the
// current password hash, so changing the password signs every other device out.

const COOKIE = 'lumen_session';
const LONG = 30 * 86400e3;
const SHORT = 12 * 3600e3;

const secretFile = path.join(config.dataDir, 'secret.key');
let secret;
try {
  secret = fs.readFileSync(secretFile);
} catch {
  secret = crypto.randomBytes(32);
  fs.writeFileSync(secretFile, secret, { mode: 0o600 });
}

const sign = (data) =>
  crypto
    .createHmac('sha256', secret)
    .update(String(config.auth?.hash || config.auth?.pass || ''))
    .update(data)
    .digest('base64url');

function cookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

const secure = (req) => req.socket.encrypted || /https/i.test(req.headers['x-forwarded-proto'] || '');

export function issueSession(req, res, user, remember) {
  const exp = Date.now() + (remember ? LONG : SHORT);
  const payload = Buffer.from(JSON.stringify({ u: user, e: exp, r: remember ? 1 : 0 })).toString('base64url');
  const attrs = ['Path=/', 'HttpOnly', 'SameSite=Lax'];
  if (remember) attrs.push(`Max-Age=${LONG / 1000}`);
  if (secure(req)) attrs.push('Secure');
  res.setHeader('set-cookie', `${COOKIE}=${payload}.${sign(payload)}; ${attrs.join('; ')}`);
}

export function clearSession(req, res) {
  res.setHeader('set-cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure(req) ? '; Secure' : ''}`);
}

export function sessionUser(req) {
  if (!config.auth) return null;
  const token = cookies(req)[COOKIE];
  if (!token) return null;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;
  const want = Buffer.from(sign(payload));
  const got = Buffer.from(sig);
  if (want.length !== got.length || !crypto.timingSafeEqual(want, got)) return null;
  try {
    const { u, e } = JSON.parse(Buffer.from(payload, 'base64url').toString());
    return e > Date.now() && u === config.auth.user ? u : null;
  } catch {
    return null;
  }
}

// Basic auth stays accepted for scripts and API clients; browsers get the login page
export function basicUser(req) {
  const [scheme, token] = (req.headers.authorization || '').split(' ');
  if (scheme !== 'Basic' || !token) return null;
  const [user, ...rest] = Buffer.from(token, 'base64').toString().split(':');
  return checkPassword(user, rest.join(':')) ? user : null;
}

// ---------- brute-force protection ----------

const attempts = new Map(); // ip -> { fails, until }
const MAX_FAILS = 8;
const LOCK_MS = 10 * 60e3;

export const clientIp = (req) =>
  String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || '';

export function lockedFor(ip) {
  const a = attempts.get(ip);
  return a && a.until > Date.now() ? a.until - Date.now() : 0;
}

export function recordAttempt(ip, ok) {
  if (ok) return attempts.delete(ip);
  const a = attempts.get(ip) || { fails: 0, until: 0 };
  a.fails++;
  if (a.fails >= MAX_FAILS) {
    a.until = Date.now() + LOCK_MS;
    a.fails = 0;
  }
  attempts.set(ip, a);
}
