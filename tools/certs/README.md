# Test certificates

Self-signed certificates for the local Aedes broker. They are **test only**,
generated on demand, and ignored by git. The CA private key is deleted after
signing and is never committed.

```bash
bash generate.sh
```

Browsers will warn about the self-signed certificate at
`wss://localhost:8084`; accept it for local testing or use the plain WS listener
at `ws://localhost:8083`. Never use these certificates for anything reachable
from the internet.
