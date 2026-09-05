#!/usr/bin/env bash
# 生成自签名证书到 ./local/certs（供 compose 的 WEB_CERT_DIR 挂载）
# 用法：bash scripts/gen-dev-cert.sh [局域网IP]   （IP 进 SAN，减少浏览器告警项）
set -euo pipefail

LAN_IP="${1:-}"
OUT_DIR="$(dirname "$0")/../local/certs"
mkdir -p "$OUT_DIR"

SAN="DNS:localhost,IP:127.0.0.1"
if [ -n "$LAN_IP" ]; then
  SAN="$SAN,IP:$LAN_IP"
fi

# MSYS_NO_PATHCONV：Git Bash 会把 /CN=... 当路径转换，需禁用
MSYS_NO_PATHCONV=1 openssl req -x509 -newkey rsa:2048 -sha256 -days 825 -nodes \
  -keyout "$OUT_DIR/privkey.pem" \
  -out "$OUT_DIR/fullchain.pem" \
  -subj "/CN=livedemo-self-signed" \
  -addext "subjectAltName=$SAN"

echo "证书已生成：$OUT_DIR/fullchain.pem + privkey.pem（SAN: $SAN）"
echo "浏览器首次访问 https://<host>:<端口> 时点『高级 → 继续前往』信任一次即可"
