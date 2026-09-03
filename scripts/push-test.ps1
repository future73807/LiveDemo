# 推一路合成测试流到 SRS（PowerShell 版）
# 用法: .\push-test.ps1 [-StreamKey test] [-RtmpHost localhost] [-Network livedemo_default]
# 优先使用本机 ffmpeg 直推 rtmp://<RtmpHost>:1935；本机无 ffmpeg 时回退 Docker 容器
# （加入 compose 网络直连 srs 服务名，容器名 push-test，后台运行，docker stop push-test 停止）
param(
    [string]$StreamKey = "test",
    [string]$RtmpHost = "localhost",
    [string]$Network = "livedemo_default"
)
$ErrorActionPreference = "Stop"

$ffmpegArgs = @(
    "-re",
    "-f", "lavfi", "-i", "testsrc2=size=1280x720:rate=30",
    "-f", "lavfi", "-i", "sine=frequency=1000",
    "-c:v", "libx264", "-preset", "veryfast", "-tune", "zerolatency",
    "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "128k",
    "-f", "flv"
)

if (Get-Command ffmpeg -ErrorAction SilentlyContinue) {
    & ffmpeg @ffmpegArgs "rtmp://${RtmpHost}:1935/live/${StreamKey}"
    exit $LASTEXITCODE
}

# Docker 回退：直连 compose 网络内的 srs 服务名
$target = if ($RtmpHost -eq "localhost") { "srs" } else { $RtmpHost }
docker rm -f push-test 2>$null | Out-Null
docker run -d --name push-test --network $Network jrottenberg/ffmpeg:6-alpine @ffmpegArgs `
    "rtmp://${target}:1935/live/${StreamKey}"
Write-Host "后台推流容器已启动: push-test -> rtmp://${target}:1935/live/${StreamKey}（停止: docker stop push-test）"
