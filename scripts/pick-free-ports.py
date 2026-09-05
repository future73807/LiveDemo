"""为本地 docker compose 部署挑选可用端口，写回 .env

Windows 上 Hyper-V/WSL 会保留动态端口区段且随重启漂移（1935/1985/8080/8081 都可能被吞），
本脚本对照当前排除表与在听端口逐个挑选，直接更新 .env 对应行。

用法：python scripts/pick-free-ports.py（在仓库根目录执行，需已存在 .env）
"""
import re
import socket
import subprocess

NEEDS = ['SRS_RTMP_PORT', 'SRS_API_PORT', 'SRS_HTTP_PORT', 'API_PORT', 'WEB_PORT']
START = {'SRS_RTMP_PORT': 11935, 'SRS_API_PORT': 21985, 'SRS_HTTP_PORT': 18080, 'API_PORT': 28081, 'WEB_PORT': 3002}


def exclusions(proto):
    out = subprocess.run(['netsh', 'interface', 'ipv4', 'show', 'excludedportrange', f'protocol={proto}'],
                         capture_output=True, text=True).stdout
    return [tuple(map(int, m)) for m in re.findall(r'\s+(\d+)\s+(\d+)\s*\n', out)]


def in_ranges(p, ranges):
    return any(a <= p <= b for a, b in ranges)


def in_use(p):
    s = socket.socket()
    try:
        s.bind(('0.0.0.0', p))
        return False
    except OSError:
        return True
    finally:
        s.close()


def pick(name, ranges):
    p = START[name]
    while in_ranges(p, ranges) or in_use(p):
        p += 1
    return p


tcp = exclusions('tcp')
udp = exclusions('udp')
plan = {name: str(pick(name, tcp)) for name in NEEDS}
print('UDP 8000 (WebRTC 媒体) excluded:', in_ranges(8000, udp), 'in_use:', in_use(8000))

path = '.env'
lines = open(path, encoding='utf-8').read().splitlines()
out, seen = [], set()
for line in lines:
    m = re.match(r'^([A-Z_]+)=', line)
    if m and m.group(1) in plan:
        out.append(f"{m.group(1)}={plan[m.group(1)]}")
        seen.add(m.group(1))
    else:
        out.append(line)
for k, v in plan.items():
    if k not in seen:
        out.append(f"{k}={v}")
open(path, 'w', encoding='utf-8').write('\n'.join(out) + '\n')
print('\n'.join(f'{k} -> {v}' for k, v in plan.items()))
print('已写回', path)
