import net from 'net';
import { EventEmitter } from 'events';
import dns from 'dns';
import { runtimeShim } from './runtimeShim.js';

export interface NetworkEvent {
  type: 'blocked' | 'allowed';
  host: string;
  port: number;
  protocol: 'tcp' | 'udp';
  sandboxId?: number;
  timestamp: number;
}

class NetworkFilterProxy extends EventEmitter {
  private server: net.Server | null = null;
  private port: number = 0;
  private whitelist: Set<string> = new Set();
  private connections: Map<number, net.Socket> = new Map();
  private connIdCounter: number = 0;

  setWhitelist(hosts: string[]): void {
    this.whitelist = new Set(hosts.map((h) => h.toLowerCase()));
  }

  addToWhitelist(host: string): void {
    this.whitelist.add(host.toLowerCase());
  }

  isHostAllowed(host: string): { allowed: boolean; reason?: string } {
    const lowerHost = host.toLowerCase();

    if (this.whitelist.has('*')) {
      return { allowed: true };
    }

    if (this.whitelist.has(lowerHost)) {
      return { allowed: true };
    }

    for (const wl of this.whitelist) {
      if (lowerHost === wl || lowerHost.endsWith('.' + wl)) {
        return { allowed: true };
      }
    }

    if (lowerHost === 'localhost' || lowerHost === '127.0.0.1' || lowerHost === '::1') {
      return { allowed: true };
    }

    return {
      allowed: false,
      reason: `Host '${host}' is not in network whitelist (whitelist: ${this.whitelist.size > 0 ? Array.from(this.whitelist).join(', ') : '<empty>'})`,
    };
  }

  getPort(): number {
    return this.port;
  }

  async start(): Promise<number> {
    return new Promise((resolve, reject) => {
      this.server = net.createServer();

      this.server.on('connection', (clientSocket) => {
        this.handleSocksConnection(clientSocket);
      });

      this.server.on('error', (err) => {
        reject(err);
      });

      this.server.listen(0, '127.0.0.1', () => {
        const addr = this.server?.address();
        if (addr && typeof addr === 'object') {
          this.port = addr.port;
          resolve(this.port);
        } else {
          reject(new Error('Failed to get proxy port'));
        }
      });
    });
  }

  private handleSocksConnection(clientSocket: net.Socket): void {
    const connId = ++this.connIdCounter;
    this.connections.set(connId, clientSocket);

    let handshakeDone = false;
    let targetHost = '';
    let targetPort = 0;

    const cleanup = (remoteSocket?: net.Socket) => {
      this.connections.delete(connId);
      try { clientSocket.destroy(); } catch { /* ignore */ }
      if (remoteSocket) {
        try { remoteSocket.destroy(); } catch { /* ignore */ }
      }
    };

    clientSocket.on('error', () => cleanup());
    clientSocket.on('close', () => cleanup());

    clientSocket.once('data', (handshake) => {
      try {
        if (handshake.length < 3) {
          cleanup();
          return;
        }

        const ver = handshake[0];

        if (ver === 5) {
          const nmethods = handshake[1];
          if (handshake.length < 2 + nmethods) {
            cleanup();
            return;
          }

          clientSocket.write(Buffer.from([0x05, 0x00]));

          clientSocket.once('data', (request) => {
            try {
              if (request.length < 7) {
                cleanup();
                return;
              }

              const cmd = request[1];
              const atyp = request[3];

              if (cmd !== 0x01) {
                clientSocket.write(Buffer.from([0x05, 0x07, 0x00, 0x01, 0, 0, 0, 0, 0, 0]));
                cleanup();
                return;
              }

              let host = '';
              let port = 0;
              let offset = 4;

              if (atyp === 0x01) {
                const ipBytes = request.slice(offset, offset + 4);
                host = `${ipBytes[0]}.${ipBytes[1]}.${ipBytes[2]}.${ipBytes[3]}`;
                offset += 4;
                port = (request[offset] << 8) | request[offset + 1];
              } else if (atyp === 0x03) {
                const len = request[offset];
                offset++;
                host = request.slice(offset, offset + len).toString();
                offset += len;
                port = (request[offset] << 8) | request[offset + 1];
              } else if (atyp === 0x04) {
                cleanup();
                return;
              }

              targetHost = host;
              targetPort = port;

              const checkResult = this.isHostAllowed(host);
              const event: NetworkEvent = {
                type: checkResult.allowed ? 'allowed' : 'blocked',
                host,
                port,
                protocol: 'tcp',
                timestamp: Date.now(),
              };
              this.emit('network', event);

              if (!checkResult.allowed) {
                const resp = Buffer.from([0x05, 0x02, 0x00, 0x01, 0, 0, 0, 0, 0, 0]);
                clientSocket.write(resp);
                cleanup();
                return;
              }

              const connectToHost = (resolvedHost: string) => {
                const remoteSocket = net.createConnection({ host: resolvedHost, port }, () => {
                  const resp = Buffer.from([0x05, 0x00, 0x00, 0x01, 127, 0, 0, 1, 0, 0]);
                  clientSocket.write(resp);

                  remoteSocket.pipe(clientSocket);
                  clientSocket.pipe(remoteSocket);
                });

                remoteSocket.on('error', () => {
                  try {
                    const resp = Buffer.from([0x05, 0x05, 0x00, 0x01, 0, 0, 0, 0, 0, 0]);
                    clientSocket.write(resp);
                  } catch { /* ignore */ }
                  cleanup(remoteSocket);
                });

                remoteSocket.on('close', () => cleanup(remoteSocket));
                clientSocket.on('close', () => cleanup(remoteSocket));
              };

              if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
                connectToHost(host);
              } else {
                dns.lookup(host, (err, address) => {
                  if (err) {
                    try {
                      const resp = Buffer.from([0x05, 0x04, 0x00, 0x01, 0, 0, 0, 0, 0, 0]);
                      clientSocket.write(resp);
                    } catch { /* ignore */ }
                    cleanup();
                    return;
                  }
                  connectToHost(address);
                });
              }
            } catch {
              cleanup();
            }
          });
        } else {
          cleanup();
        }
      } catch {
        cleanup();
      }
    });
  }

  stop(): void {
    if (this.server) {
      try { this.server.close(); } catch { /* ignore */ }
      this.server = null;
    }
    for (const sock of this.connections.values()) {
      try { sock.destroy(); } catch { /* ignore */ }
    }
    this.connections.clear();
  }
}

export const networkFilter = new NetworkFilterProxy();

networkFilter.on('network', (evt: NetworkEvent) => {
  for (const inst of runtimeShim.listInstances()) {
    if (inst.status === 'running') {
      if (evt.type === 'blocked') {
        inst.stats.networkBlockedCount++;
      } else {
        inst.stats.networkAllowedCount++;
      }
    }
  }
});

export async function startNetworkProxy(whitelist: string[]): Promise<number> {
  networkFilter.setWhitelist(whitelist);
  if (networkFilter.getPort() === 0) {
    return await networkFilter.start();
  }
  return networkFilter.getPort();
}
