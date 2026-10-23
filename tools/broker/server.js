'use strict';
/**
 * Local broker for testing the Report Consumption.
 *
 *  - TLS MQTT on 8883 (Aedes over tls)
 *  - WSS MQTT on 8084 (Aedes over secure WebSocket) — mirrors Flespi's wss://
 *  - plain WS on 8083 (local tests only)
 *
 * Environment:
 *   MQTT_HOST              bind address (default 127.0.0.1)
 *   MQTT_PORT              TLS MQTT port (default 8883)
 *   MQTT_WSS_PORT          WSS port (default 8084)
 *   MQTT_WS_PORT           plain WS port (default 8083)
 *   MQTT_USER              username (default report)
 *   MQTT_PASS              password (default report, must be non-empty)
 *   MQTT_ALLOW_EMPTY_PASS  set to 1 to accept empty passwords (local only)
 *
 * All listeners bind to 127.0.0.1 unless MQTT_HOST is set explicitly. Set a
 * non-loopback host only when you understand the exposure.
 *
 * The browser sends a token-as-username and no password, so local browser
 * tests need MQTT_ALLOW_EMPTY_PASS=1 (or a client that supplies MQTT_PASS).
 *
 * NOT for production: production uses Flespi (see docs/decisions.md).
 *   MQTT_USER=report MQTT_PASS=report node server.js
 */
const fs = require('fs');
const path = require('path');
const tls = require('tls');
const aedesFactory = require('aedes-server-factory');
const aedes = require('aedes')();

const HOST = process.env.MQTT_HOST || '127.0.0.1';
const PORT = parseInt(process.env.MQTT_PORT || '8883', 10);
const WSS_PORT = parseInt(process.env.MQTT_WSS_PORT || '8084', 10);
const WS_PORT = parseInt(process.env.MQTT_WS_PORT || '8083', 10);
const USER = process.env.MQTT_USER || 'report';
const PASS = process.env.MQTT_PASS !== undefined ? process.env.MQTT_PASS : 'report';
const ALLOW_EMPTY_PASS = process.env.MQTT_ALLOW_EMPTY_PASS === '1';

if (!PASS && !ALLOW_EMPTY_PASS) {
  console.error('[config] MQTT_PASS must be non-empty (set MQTT_ALLOW_EMPTY_PASS=1 to allow empty passwords locally)');
  process.exit(1);
}

// Accept the username; password must match unless empty passwords are allowed.
aedes.authenticate = (client, username, password, done) => {
  const u = username ? username.toString() : '';
  const p = password ? password.toString() : '';
  const passwordOk = p === PASS && p !== '';
  const emptyOk = ALLOW_EMPTY_PASS && p === '';
  if (u === USER && (passwordOk || emptyOk)) return done(null, true);
  const err = new Error('auth failed');
  err.returnCode = 4;
  // Never log the username/token, only the connection's client id.
  console.log('[auth] rejected client=' + client.id);
  done(err, false);
};

aedes.on('client', (c) => console.log('[client+]', c.id));
aedes.on('clientDisconnect', (c) => console.log('[client-]', c.id));
aedes.on('publish', (packet, client) => {
  if (client) {
    const bytes = packet.payload ? packet.payload.length : 0;
    console.log('[pub]', packet.topic, packet.retain ? '(retained)' : '', 'bytes=' + bytes);
  }
});

const key = fs.readFileSync(path.join(__dirname, '..', 'certs', 'server.key'));
const cert = fs.readFileSync(path.join(__dirname, '..', 'certs', 'server.crt'));

const tlsServer = tls.createServer({ key, cert }, aedes.handle);
tlsServer.listen(PORT, HOST, () => console.log(`TLS MQTT on ${HOST}:${PORT}`));

const wssServer = aedesFactory.createServer(aedes, { ws: true, https: { key, cert } });
wssServer.listen(WSS_PORT, HOST, () => console.log(`WSS MQTT on ${HOST}:${WSS_PORT}`));

const wsServer = aedesFactory.createServer(aedes, { ws: true });
wsServer.listen(WS_PORT, HOST, () => console.log(`plain WS MQTT on ${HOST}:${WS_PORT} (local tests only)`));
