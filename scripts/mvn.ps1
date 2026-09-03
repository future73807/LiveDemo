# Docker 化 Maven：本机无 JDK/Maven，在容器内执行 mvn（参数原样透传）
# 用法示例：
#   ./scripts/mvn.ps1 compile
#   ./scripts/mvn.ps1 test "-Dtest=RoomServiceTest"
$ErrorActionPreference = "Stop"
$root = (Get-Item "$PSScriptRoot\..").FullName -replace '\\', '/'
docker run --rm -v "$root/live-service:/src" -v livedemo-m2:/root/.m2 -w /src maven:3.9-eclipse-temurin-17 mvn -B @args
