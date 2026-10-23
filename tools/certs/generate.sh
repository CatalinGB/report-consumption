#!/usr/bin/env bash
# Generate the test-only certificates for the local Aedes broker.
# They are ignored by git and must never be used in production.
set -euo pipefail
cd "$(dirname "$0")"

if [[ -f server.key && -f server.crt && -f ca.crt ]]; then
  echo "Test certificates already exist; leaving them untouched."
  exit 0
fi

rm -f server.key server.crt server.csr ca.key ca.crt ca.srl san.ext

openssl req -x509 -newkey rsa:2048 -nodes \
  -keyout ca.key -out ca.crt -days 3650 \
  -subj "/CN=Report Consumption Test CA"

openssl req -newkey rsa:2048 -nodes \
  -keyout server.key -out server.csr \
  -subj "/CN=localhost"

cat > san.ext <<'EOF'
subjectAltName=DNS:localhost,IP:127.0.0.1
EOF

openssl x509 -req -in server.csr \
  -CA ca.crt -CAkey ca.key -CAcreateserial \
  -out server.crt -days 3650 -extfile san.ext

chmod 600 server.key ca.key
rm -f server.csr ca.key ca.srl
echo "Generated test-only certificates: ca.crt, server.crt, server.key (mode 600)."
