#!/usr/bin/env bash
# 推一路合成测试流到 SRS，用法: ./push-test.sh [streamKey] [rtmpHost]
set -e
KEY="${1:-test}"
HOST="${2:-localhost}"
exec ffmpeg -re -f lavfi -i "testsrc2=size=1280x720:rate=30" \
  -f lavfi -i "sine=frequency=1000" \
  -c:v libx264 -preset veryfast -tune zerolatency -pix_fmt yuv420p \
  -c:a aac -b:a 128k -f flv "rtmp://${HOST}:1935/live/${KEY}"
