/**
 * POST /api/inquiry — the only server-side endpoint on this site.
 *
 * Cloudflare Pages Function. No database, no client-management system.
 * It validates an enquiry, does light spam screening, and emails it onward.
 * Nothing is stored.
 *
 * Required environment variables (Pages → Settings → Environment variables):
 *   RESEND_API_KEY   secret. From resend.com. Server-side only.
 *   INQUIRY_TO       where enquiries are delivered, e.g. hello@fareedq.com
 *
 * Optional:
 *   INQUIRY_FROM     verified sender, e.g. "FareedQ enquiries <enquiries@fareedq.com>"
 *                    Defaults to Resend's shared onboarding sender, which only
 *                    delivers to the address that owns the Resend account.
 *   TURNSTILE_SECRET_KEY  if set, a Turnstile token is required and verified.
 *   INQUIRY_RATE_KV       KV namespace binding for durable per-IP rate limiting.
 *                         Without it, rate limiting is best-effort per isolate.
 *
 * To replace this with a real scheduling or client-management platform later,
 * change the form's `action` in content/work-with-me.json (or delete
 * data-inquiry-form so the form posts natively). No page markup needs to change.
 */

const LIMITS = { name: 100, email: 254, message: 4000 };
const MIN_ELAPSED_MS = 2500;      // faster than this is almost always a bot
const RATE_WINDOW_S = 3600;
const RATE_MAX = 5;               // submissions per IP per window

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/* Strip control characters and newlines from header-bound values so nothing
   can be smuggled into an email header. */
const headerSafe = (s) => String(s).replace(/[\r\n\t\u0000-\u001f\u007f]+/g, ' ').trim();

const escapeHtml = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** Obvious link-spam heuristic. Deliberately crude; honeypot and timing do
 *  most of the work, and a false positive here costs one legitimate enquiry. */
function looksLikeSpam(message, name) {
  const haystack = `${name} ${message}`.toLowerCase();
  const urls = (haystack.match(/https?:\/\//g) || []).length;
  if (urls >= 3) return true;
  const phrases = [
    'seo services', 'crypto', 'bitcoin', 'casino', 'viagra', 'cialis',
    'loan approval', 'buy backlinks', 'guest post', 'work from home opportunity',
    'increase your traffic', 'rank higher on google',
  ];
  if (phrases.some((p) => haystack.includes(p))) return true;
  return false;
}

async function rateLimited(env, ip) {
  if (!env.INQUIRY_RATE_KV || !ip) return false;
  const key = `inquiry:${ip}`;
  try {
    const current = Number(await env.INQUIRY_RATE_KV.get(key)) || 0;
    if (current >= RATE_MAX) return true;
    await env.INQUIRY_RATE_KV.put(key, String(current + 1), { expirationTtl: RATE_WINDOW_S });
  } catch {
    /* Never let a rate-limit store failure block a real enquiry. */
    return false;
  }
  return false;
}

async function verifyTurnstile(env, token, ip) {
  const body = new FormData();
  body.append('secret', env.TURNSTILE_SECRET_KEY);
  body.append('response', token);
  if (ip) body.append('remoteip', ip);
  const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    body,
  });
  const data = await res.json().catch(() => ({}));
  return Boolean(data.success);
}

export async function onRequestPost({ request, env }) {
  let payload;
  try {
    payload = await request.json();
  } catch {
    return json({ ok: false, error: 'That request could not be read.' }, 400);
  }

  if (!payload || typeof payload !== 'object') {
    return json({ ok: false, error: 'That request could not be read.' }, 400);
  }

  const ip = request.headers.get('CF-Connecting-IP') || '';

  /* --- spam screening --------------------------------------------------- */

  if (String(payload.company || '').trim()) {
    /* Honeypot filled. Report success so the bot has nothing to learn. */
    return json({ ok: true });
  }

  const elapsed = Number(payload.elapsed);
  if (Number.isFinite(elapsed) && elapsed >= 0 && elapsed < MIN_ELAPSED_MS) {
    return json({ ok: false, error: 'That was submitted a little too quickly — please try once more.' }, 400);
  }

  if (env.TURNSTILE_SECRET_KEY) {
    const token = String(payload.turnstileToken || '');
    if (!token || !(await verifyTurnstile(env, token, ip))) {
      return json({ ok: false, error: 'The spam check did not pass. Please try again.' }, 400);
    }
  }

  if (await rateLimited(env, ip)) {
    return json({ ok: false, error: 'Too many messages from this connection. Please try again later, or email directly.' }, 429);
  }

  /* --- validation ------------------------------------------------------- */

  const name = String(payload.name || '').replace(/\s+/g, ' ').trim();
  const email = String(payload.email || '').trim();
  const message = String(payload.message || '').trim();

  if (!name) return json({ ok: false, error: 'Please include your name.' }, 400);
  if (name.length > LIMITS.name) return json({ ok: false, error: 'That name is too long.' }, 400);
  if (!email) return json({ ok: false, error: 'Please include an email address so I can reply.' }, 400);
  if (email.length > LIMITS.email || !EMAIL_RE.test(email)) {
    return json({ ok: false, error: 'That email address does not look valid.' }, 400);
  }
  if (message.length > LIMITS.message) {
    return json({ ok: false, error: 'Please keep your message under 4000 characters.' }, 400);
  }
  if (looksLikeSpam(message, name)) {
    return json({ ok: true });
  }

  /* --- configuration ---------------------------------------------------- */

  if (!env.RESEND_API_KEY) {
    console.error('inquiry: RESEND_API_KEY is not configured');
    return json({ ok: false, error: 'The message could not be sent right now.' }, 500);
  }

  const to = env.INQUIRY_TO;
  if (!to) {
    console.error('inquiry: INQUIRY_TO is not configured');
    return json({ ok: false, error: 'The message could not be sent right now.' }, 500);
  }

  const from = env.INQUIRY_FROM || 'FareedQ enquiries <onboarding@resend.dev>';

  /* --- compose ---------------------------------------------------------- */

  const subject = `Enquiry from ${headerSafe(name)}`;
  const text = [
    `Name:    ${name}`,
    `Email:   ${email}`,
    '',
    'Message:',
    message || '(no message provided)',
    '',
    '—',
    `Sent from ${new URL(request.url).origin}/work-with-me/`,
  ].join('\n');

  const html = `<div style="font-family:Georgia,serif;font-size:16px;line-height:1.6;color:#14161a">
  <p style="font-family:Helvetica,Arial,sans-serif;font-size:12px;letter-spacing:.13em;text-transform:uppercase;color:#6d7480;margin:0 0 4px">New enquiry</p>
  <p style="margin:0 0 16px"><strong style="font-family:Helvetica,Arial,sans-serif">${escapeHtml(name)}</strong><br>
  <a href="mailto:${escapeHtml(email)}" style="color:#8c4a2f">${escapeHtml(email)}</a></p>
  <hr style="border:0;border-top:1px solid #d8d3c6;margin:16px 0">
  <p style="white-space:pre-wrap;margin:0">${message ? escapeHtml(message) : '<em style="color:#6d7480">No message provided.</em>'}</p>
</div>`;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from, to: [to], reply_to: email, subject, text, html }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    console.error('inquiry: resend rejected the send', res.status, detail.slice(0, 500));
    return json({ ok: false, error: 'The message could not be sent right now.' }, 502);
  }

  return json({ ok: true });
}

/* Anything other than POST. */
export async function onRequest({ request }) {
  if (request.method === 'POST') return json({ ok: false, error: 'Unreachable.' }, 500);
  return json({ ok: false, error: 'Method not allowed.' }, 405);
}
