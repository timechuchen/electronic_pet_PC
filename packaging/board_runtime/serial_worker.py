"""USB transport for Electron. JSON-lines over stdio; bounded binary packets to ESP32.
No network listener or credentials. Reconnects after unplugging or firmware restart.
"""
import base64
import json
import queue
import struct
import sys
import threading
import time
import zlib
import os
import subprocess
import serial
from serial.tools import list_ports

requests = queue.Queue(maxsize=16)


def emit(data):
    print(json.dumps(data, separators=(',', ':')), flush=True)


def input_reader():
    for line in sys.stdin:
        try:
            data = json.loads(line)
            requests.put(data)
        except (ValueError, TypeError):
            continue
    requests.put(None)


def packet(kind, seq, payload):
    if len(payload) > 98304:
        raise ValueError('Packet too large')
    return struct.pack('<4sIII', b'LPET', kind, seq, len(payload)) + payload + struct.pack('<I', zlib.crc32(payload))


def receive(link, seq, timeout=4):
    end = time.monotonic() + timeout
    partial = bytearray()
    while time.monotonic() < end:
        raw = link.read_until(b'\n', size=4096)
        if not raw:
            continue
        partial.extend(raw)
        if len(partial) > 4096:
            partial.clear()
            continue
        if not raw.endswith(b'\n'):
            continue
        line = partial.decode('utf-8', errors='replace').strip()
        partial.clear()
        for prefix, event in [('PET_EVENT ', 'event'), ('PET_STATUS ', 'device'), ('PET_ACK ', 'ack')]:
            if line.startswith(prefix):
                try:
                    value = json.loads(line[len(prefix):])
                except ValueError:
                    break
                if event == 'ack':
                    if value.get('seq') == seq:
                        return value
                else:
                    emit({'type': event, **value})
                break
        else:
            if 'Guru Meditation' in line or 'abort()' in line:
                raise RuntimeError('Firmware restarted unexpectedly')
    raise TimeoutError('Device acknowledgement timed out')


def candidate_ports(ports, platform=sys.platform):
    return sorted(p.device for p in ports if p.vid == 0x303A and p.pid == 0x1001
                  and (platform != 'darwin' or p.device.startswith('/dev/cu.')))


def open_board(port=None):
    ports = candidate_ports(list_ports.comports())
    if not port and len(ports) > 1:
        raise RuntimeError('发现多块 ESP32，请只连接一块目标开发板后重试')
    chosen = port or (ports[0] if ports else None)
    if not chosen:
        raise RuntimeError('等待开发板：请连接 USB 数据线，并确认已烧录兰洛固件')
    if sys.platform == 'darwin':
        # Avoid opening a port held by the old companion or an IDF monitor.
        owners = subprocess.run(['/usr/sbin/lsof', '-t', chosen], capture_output=True,
                                text=True, timeout=3).stdout.split()
        if any(pid != str(os.getpid()) for pid in owners):
            raise RuntimeError('USB 串口被占用，请退出其他桌宠服务端或串口监视器')
    link = serial.Serial()
    link.port = chosen
    link.baudrate = 921600
    link.timeout = .08
    link.write_timeout = 3
    link.dtr = False
    link.rts = False
    if os.name != 'nt':
        link.exclusive = True
    try:
        link.open()
        # USB control-line changes can reset the board on macOS.
        deadline = time.monotonic() + 3.5
        while time.monotonic() < deadline:
            link.readline()
        link.write(packet(3, 0, b'status'))
        if not receive(link, 0)['ok']:
            raise RuntimeError('固件握手失败，请确认已烧录兰洛 ESP32 固件')
    except Exception:
        link.close()
        raise
    emit({'type': 'connection', 'connected': True, 'port': chosen})
    return link


def main():
    threading.Thread(target=input_reader, daemon=True).start()
    link = None
    last_error = ''
    while True:
        req = requests.get()
        if req is None:
            break
        seq = req.get('id', 1)
        try:
            if link is None:
                link = open_board(sys.argv[1] if len(sys.argv) > 1 else None)
                last_error = ''
            payload = base64.b64decode(req.get('data', ''), validate=True)
            kind = int(req['kind'])
            if kind not in (1, 2, 3, 4):
                raise ValueError('Unknown packet kind')
            link.write(packet(kind, seq, payload))
            result = receive(link, seq)
            emit({'type': 'result', 'id': seq, **result})
        except Exception as error:
            if link:
                link.close()
            link = None
            message = str(error)
            print(f'USB_ERROR seq={seq} kind={req.get("kind")} {message}', file=sys.stderr, flush=True)
            if message != last_error:
                emit({'type': 'connection', 'connected': False, 'message': message})
                last_error = message
            emit({'type': 'result', 'id': seq, 'ok': False, 'error': message})
            time.sleep(1)
    if link:
        link.close()


if __name__ == '__main__':
    main()
