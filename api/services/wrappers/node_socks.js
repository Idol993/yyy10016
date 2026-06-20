const net = require('net');
const tls = require('tls');
const http = require('http');
const https = require('https');
const { SocksClient } = null;

const PROXY_HOST = process.env.SOCKS_PROXY_HOST || '127.0.0.1';
const PROXY_PORT = parseInt(process.env.SOCKS_PROXY_PORT || process.env.HTTPS_PROXY?.match(/:(\d+)/)?.[1] || '1080', 10);

const WHITELIST_ENV = (process.env.SANDBOX_NETWORK_WHITELIST || '').split(',').map((s) => s.trim()).filter(Boolean);
const WHITELIST = new Set(WHITELIST_ENV.length > 0 ? WHITELIST_ENV : ['localhost', '127.0.0.1']);

function hostAllowed(host) {
  if (!host) return false;
  const lower = host.toLowerCase();
  for (const wl of WHITELIST) {
    if (lower === wl || lower.endsWith('.' + wl)) return true;
  }
  return lower === 'localhost' || lower === '127.0.0.1' || lower === '::1';
}

function logBlock(host, proto) {
  const list = Array.from(WHITELIST).join(', ');
  process.stderr.write(
    `[Network] BLOCKED: ${proto} ${host} - Host not in whitelist (whitelist: ${list})\n`
  );
}

const origConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (opts, cb) {
  if (typeof opts === 'object' && opts && !Array.isArray(opts)) {
    const host = opts.host || opts.hostname;
    if (host && !hostAllowed(host)) {
      logBlock(host, 'TCP');
      const err = new Error(
        `[SandboxOS] Network blocked: connection to '${host}' denied. Host is not in whitelist.`
      );
      err.code = 'ECONNREFUSED';
      process.nextTick(() => this.emit('error', err));
      return this;
    }
  }
  return origConnect.call(this, opts, cb);
};

const origTlsConnect = tls.connect;
tls.connect = function (opts, cb) {
  if (typeof opts === 'object' && opts && !Array.isArray(opts)) {
    const host = opts.host || opts.hostname;
    if (host && !hostAllowed(host)) {
      logBlock(host, 'TLS');
      const sock = new tls.TLSSocket();
      const err = new Error(
        `[SandboxOS] Network blocked: TLS connection to '${host}' denied. Host is not in whitelist.`
      );
      err.code = 'ECONNREFUSED';
      process.nextTick(() => sock.emit('error', err));
      return sock;
    }
  }
  return origTlsConnect.call(tls, opts, cb);
};

const origHttpRequest = http.request;
http.request = function (opts, cb) {
  if (typeof opts === 'object' && opts && !Array.isArray(opts)) {
    const host = opts.hostname || opts.host;
    if (host && !hostAllowed(host)) {
      logBlock(host, 'HTTP');
      const req = new http.ClientRequest(opts);
      process.nextTick(() => {
        const err = new Error(
          `[SandboxOS] Network blocked: HTTP request to '${host}' denied. Host is not in whitelist.`
        );
        err.code = 'ECONNREFUSED';
        req.emit('error', err);
      });
      return req;
    }
  }
  return origHttpRequest.call(http, opts, cb);
};

const origHttpsRequest = https.request;
https.request = function (opts, cb) {
  if (typeof opts === 'object' && opts && !Array.isArray(opts)) {
    const host = opts.hostname || opts.host;
    if (host && !hostAllowed(host)) {
      logBlock(host, 'HTTPS');
      const req = new https.ClientRequest(opts);
      process.nextTick(() => {
        const err = new Error(
          `[SandboxOS] Network blocked: HTTPS request to '${host}' denied. Host is not in whitelist.`
        );
        err.code = 'ECONNREFUSED';
        req.emit('error', err);
      });
      return req;
    }
  }
  return origHttpsRequest.call(https, opts, cb);
};

module.exports = {};
