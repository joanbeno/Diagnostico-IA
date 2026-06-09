const { createHmac } = require('crypto');

function makeToken(role) {
  const secret = process.env.SESSION_SECRET || 'dev-secret-change-me';
  const payload = `${role}:${Date.now()}`;
  const sig = createHmac('sha256', secret).update(payload).digest('hex');
  return Buffer.from(payload).toString('base64') + '.' + sig;
}

async function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve(raw ? JSON.parse(raw) : {});
      } catch (e) {
        resolve({});
      }
    });
    req.on('error', () => resolve({}));
  });
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).end();

  // Try req.body first (Vercel auto-parse), fall back to raw stream
  let body = req.body;
  if (!body || typeof body !== 'object') {
    body = await readBody(req);
  }

  // facilitador.html — user + pass
  if (body.user !== undefined) {
    if (String(body.user).trim() !== String(process.env.LOGIN_USER || '').trim() ||
        String(body.pass).trim() !== String(process.env.LOGIN_PASS || '').trim()) {
      return res.status(401).json({ ok: false });
    }
    return res.json({ ok: true, token: makeToken('facilitador') });
  }

  // hallazgos.html — key
  if (body.key !== undefined) {
    if (String(body.key).trim() !== String(process.env.VALID_KEY || '').trim()) {
      return res.status(401).json({ ok: false });
    }
    return res.json({ ok: true, token: makeToken('hallazgos') });
  }

  return res.status(400).end();
};
