const { createHmac } = require('crypto');
const https = require('https');

function verifyToken(token) {
  if (!token) return false;
  const dot = token.lastIndexOf('.');
  if (dot < 0) return false;
  const b64 = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  let payload;
  try { payload = Buffer.from(b64, 'base64').toString('utf8'); } catch (e) { return false; }
  const secret = process.env.SESSION_SECRET || 'dev-secret-change-me';
  const expected = createHmac('sha256', secret).update(payload).digest('hex');
  if (expected !== sig) return false;
  const ts = parseInt(payload.split(':')[1]);
  if (!ts || Date.now() - ts > 24 * 3600 * 1000) return false;
  return true;
}

// Uses https.get() with raw URL string — avoids new URL() which can fail on redirect hops
function httpsGet(urlStr, maxRedirects) {
  if (maxRedirects === undefined) maxRedirects = 10;
  return new Promise(function(resolve, reject) {
    function doRequest(url, redirectsLeft) {
      var req = https.get(url, { headers: { 'User-Agent': 'DiagnosticoIA-Proxy/1.0' } }, function(res) {
        var loc = res.headers.location;
        if ([301, 302, 303, 307, 308].indexOf(res.statusCode) >= 0 && loc && redirectsLeft > 0) {
          res.resume();
          // Resolve absolute vs protocol-relative vs relative redirect
          var nextUrl;
          if (/^https?:\/\//i.test(loc)) {
            nextUrl = loc;
          } else if (loc.startsWith('//')) {
            nextUrl = 'https:' + loc;
          } else {
            var base = url.match(/^(https?:\/\/[^/?#]*)/i);
            nextUrl = base ? base[1] + (loc.startsWith('/') ? loc : '/' + loc) : loc;
          }
          doRequest(nextUrl, redirectsLeft - 1);
          return;
        }
        var chunks = [];
        res.on('data', function(c) { chunks.push(c); });
        res.on('end', function() { resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }); });
        res.on('error', reject);
      });
      req.on('error', reject);
    }
    doRequest(urlStr, maxRedirects);
  });
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');

  if (req.method === 'OPTIONS') return res.status(204).end();

  const auth = req.headers['authorization'] || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;

  if (!verifyToken(token)) {
    return res.status(401).json({ ok: false, error: 'unauthorized' });
  }

  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(req.query)) {
    params.set(k, v);
  }

  const action = req.query.action;
  if (action === 'data' || action === 'toggle_test') {
    params.set('key', process.env.FACILITATOR_KEY);
  }

  const scriptUrl = (process.env.APPS_SCRIPT_URL || '').replace(/^﻿/, '').trim();
  if (!scriptUrl) {
    return res.status(500).json({ ok: false, error: 'server_misconfigured' });
  }

  try {
    const { status, body } = await httpsGet(scriptUrl + '?' + params.toString());
    res.setHeader('Content-Type', 'application/json');
    res.status(status).send(body);
  } catch (e) {
    res.status(502).json({ ok: false, error: 'upstream_error', detail: e.message });
  }
};
