# Local test broker

Aedes over TLS (8883), WSS (8084) and local-only plain WS (8083), used only for
local development and the E2E harness. It accepts a token-as-username login
(`report` / `report` by default), mirroring Flespi's auth shape. All listeners
bind to `127.0.0.1` unless `MQTT_HOST` is explicitly set.

```bash
bash ../certs/generate.sh   # test-only certs, ignored by git
npm install
node server.js
```

The browser test client sends no password. Start the local broker with
`MQTT_ALLOW_EMPTY_PASS=1 node server.js` only for those tests.

The certificates in `../certs` are **test-only** and must never be used in
production. The CA private key is deleted after signing and is never committed.

Production uses Flespi (`wss://mqtt.flespi.io:443`). See
[`docs/mqtt-contract.md`](../../docs/mqtt-contract.md).
