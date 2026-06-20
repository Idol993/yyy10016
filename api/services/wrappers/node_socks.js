(function () {
  'use strict';

  const net = require('net');
  const tls = require('tls');
  const http = require('http');
  const https = require('https');

  const WHITELIST_ENV = process.env.SANDBOX_NETWORK_WHITELIST || '';
  const WHITELIST = new Set(
    WHITELIST_ENV
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
  );
  if (WHITELIST.size === 0) {
    WHITELIST.add('localhost');
    WHITELIST.add('127.0.0.1');
  }

  function hostAllowed(host) {
    if (!host || typeof host !== 'string') return false;
    const lower = host.toLowerCase();

    for (const wl of WHITELIST) {
      if (lower === wl || lower.endsWith('.' + wl)) {
        return true;
      }
    }

    return lower === 'localhost' || lower === '127.0.0.1' || lower === '::1';
  }

  function logBlock(host, proto, port) {
    try {
      const list = Array.from(WHITELIST).join(', ');
      const msg =
        `[Network] BLOCKED: ${proto} ${host}${port ? ':' + port : ''} ` +
        `- Host not in whitelist (whitelist: ${list})\n`;
      process.stderr.write(msg);
    } catch {
      // ignore write errors
    }
  }

  function makeBlockError(host, proto) {
    const err = new Error(
      `connect ECONNREFUSED ${host}: connection blocked by sandbox policy. ` +
      `Host '${host}' is not in network whitelist.`
    );
    err.code = 'ECONNREFUSED';
    err.errno = -111;
    err.syscall = 'connect';
    err.address = host;
    return err;
  }

  try {
    const origNetConnect = net.Socket.prototype.connect;
    net.Socket.prototype.connect = function (opts, cb) {
      try {
        if (typeof opts === 'object' && opts && !Array.isArray(opts)) {
          const host = opts.host || opts.hostname;
          const port = opts.port;

          if (host && !hostAllowed(host)) {
            logBlock(host, 'TCP', port);

            if (typeof cb === 'function') {
              process.nextTick(() => {
                try { cb(makeBlockError(host, 'TCP')); } catch { /* ignore */ }
              });
            }

            process.nextTick(() => {
              try {
                this.emit('error', makeBlockError(host, 'TCP'));
              } catch { /* ignore */ }
            });

            return this;
          }
        }
      } catch {
        // ignore any errors in our interception logic, fall through to original
      }

      return origNetConnect.call(this, opts, cb);
    };
  } catch {
    // ignore errors while patching
  }

  try {
    const origTlsConnect = tls.connect;
    tls.connect = function (opts, cb) {
      try {
        if (typeof opts === 'object' && opts && !Array.isArray(opts)) {
          const host = opts.host || opts.hostname;
          const port = opts.port;

          if (host && !hostAllowed(host)) {
            logBlock(host, 'TLS', port);

            const err = makeBlockError(host, 'TLS');
            const mockSocket = new tls.TLSSocket();

            process.nextTick(() => {
              try {
                mockSocket.emit('error', err);
              } catch { /* ignore */ }
            });

            if (typeof cb === 'function') {
              process.nextTick(() => {
                try { cb(err); } catch { /* ignore */ }
              });
            }

            return mockSocket;
          }
        }
      } catch {
        // ignore any errors in our interception logic, fall through to original
      }

      return origTlsConnect.call(tls, opts, cb);
    };
  } catch {
    // ignore errors while patching
  }

  try {
    const origHttpRequest = http.request;
    http.request = function (opts, cb) {
      try {
        if (typeof opts === 'object' && opts && !Array.isArray(opts)) {
          const host = opts.hostname || opts.host;
          const port = opts.port;

          if (host && !hostAllowed(host)) {
            logBlock(host, 'HTTP', port);

            const err = makeBlockError(host, 'HTTP');
            let req;
            try {
              req = new http.ClientRequest(opts);
            } catch {
              req = origHttpRequest.call(http, opts, cb);
            }

            process.nextTick(() => {
              try {
                req.emit('error', err);
              } catch { /* ignore */ }
            });

            return req;
          }
        }
      } catch {
        // ignore any errors in our interception logic, fall through to original
      }

      return origHttpRequest.call(http, opts, cb);
    };
  } catch {
    // ignore errors while patching
  }

  try {
    const origHttpsRequest = https.request;
    https.request = function (opts, cb) {
      try {
        if (typeof opts === 'object' && opts && !Array.isArray(opts)) {
          const host = opts.hostname || opts.host;
          const port = opts.port;

          if (host && !hostAllowed(host)) {
            logBlock(host, 'HTTPS', port);

            const err = makeBlockError(host, 'HTTPS');
            let req;
            try {
              req = new https.ClientRequest(opts);
            } catch {
              req = origHttpsRequest.call(https, opts, cb);
            }

            process.nextTick(() => {
              try {
                req.emit('error', err);
              } catch { /* ignore */ }
            });

            return req;
          }
        }
      } catch {
        // ignore any errors in our interception logic, fall through to original
      }

      return origHttpsRequest.call(https, opts, cb);
    };
  } catch {
    // ignore errors while patching
  }

  try {
    const origHttpGet = http.get;
    http.get = function (opts, cb) {
      const req = http.request(opts, cb);
      req.end();
      return req;
    };

    const origHttpsGet = https.get;
    https.get = function (opts, cb) {
      const req = https.request(opts, cb);
      req.end();
      return req;
    };
  } catch {
    // ignore errors while patching
  }
})();
