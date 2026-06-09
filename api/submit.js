const https = require('https');

async function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve(raw ? JSON.parse(raw) : {});
      } catch (e) { resolve({}); }
    });
    req.on('error', () => resolve({}));
  });
}

function resolveRedirect(loc, baseUrl) {
  if (/^https?:\/\//i.test(loc)) return loc;
  if (loc.startsWith('//')) return 'https:' + loc;
  var base = baseUrl.match(/^(https?:\/\/[^/?#]*)/i);
  return base ? base[1] + (loc.startsWith('/') ? loc : '/' + loc) : loc;
}

function httpsPost(urlStr, bodyStr, maxRedirects) {
  if (maxRedirects === undefined) maxRedirects = 10;
  return new Promise(function(resolve, reject) {
    function doRequest(url, method, payload, redirectsLeft) {
      var isPost = method === 'POST' && payload != null;
      var reqOptions = {
        method: method,
        headers: Object.assign(
          { 'User-Agent': 'DiagnosticoIA-Proxy/1.0' },
          isPost ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}
        )
      };
      var req = https.request(url, reqOptions, function(res) {
        var loc = res.headers.location;
        if ([301, 302, 303].indexOf(res.statusCode) >= 0 && loc && redirectsLeft > 0) {
          res.resume();
          doRequest(resolveRedirect(loc, url), 'GET', null, redirectsLeft - 1);
          return;
        }
        if ([307, 308].indexOf(res.statusCode) >= 0 && loc && redirectsLeft > 0) {
          res.resume();
          doRequest(resolveRedirect(loc, url), method, payload, redirectsLeft - 1);
          return;
        }
        var chunks = [];
        res.on('data', function(c) { chunks.push(c); });
        res.on('end', function() { resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }); });
        res.on('error', reject);
      });
      req.on('error', reject);
      if (isPost) req.write(payload);
      req.end();
    }
    doRequest(urlStr, 'POST', bodyStr, maxRedirects);
  });
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).end();

  let body = req.body;
  if (!body || typeof body !== 'object') body = await readBody(req);

  const scriptUrl = (process.env.APPS_SCRIPT_URL || '').replace(/^﻿/, '').trim();
  if (!scriptUrl) return res.status(500).json({ status: 'error', message: 'server_misconfigured' });

  try {
    const { status, body: responseBody } = await httpsPost(scriptUrl, JSON.stringify(body));
    res.setHeader('Content-Type', 'application/json');
    res.status(status).send(responseBody);
  } catch (e) {
    res.status(502).json({ status: 'error', message: 'upstream_error', detail: e.message });
  }
};
