"""Isolated, local-only throttled origin for the native transport acceptance harness.
python3 origin.py --fixture path/to/reminder.mp3 --port 46371
Never deploy: intentionally supports fault injection and unauthenticated fixture bytes.
"""
import argparse, hashlib, json, threading, time
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
p = argparse.ArgumentParser()
p.add_argument('--fixture', required=True)
p.add_argument('--port', type=int, default=46371)
args = p.parse_args()
raw = open(args.fixture, 'rb').read()
media = (raw * ((2_726_391 // len(raw)) + 1))[:2_726_391]
digest = hashlib.sha256(media).hexdigest()
lock = threading.Lock()
stats = {'bytes': 0, 'requests': []}
class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args): pass
    def do_GET(self):
        path = urlparse(self.path)
        if path.path == '/reset':
            with lock: stats.update(bytes=0, requests=[])
        if path.path in ('/meta', '/stats', '/reset'):
            with lock: body = json.dumps({'id': digest, 'bytes': len(media)} if path.path == '/meta' else stats).encode()
            self.send_response(200); self.send_header('Content-Length', str(len(body))); self.end_headers(); self.wfile.write(body); return
        q = parse_qs(path.query)
        mode = q.get('mode', ['normal'])[0]
        offset = int(self.headers.get('Range', 'bytes=0-').split('=')[1].split('-')[0])
        if mode == 'ignore': offset = 0
        with lock: stats['requests'].append({'range': self.headers.get('Range'), 'offset': offset, 'mode': mode, 'ifRange': self.headers.get('If-Range')})
        self.send_response(206 if offset else 200)
        self.send_header('Content-Length', str(len(media)-offset))
        self.send_header('Content-Type', 'audio/mpeg')
        self.send_header('ETag', '"'+digest+'"')
        if offset: self.send_header('Content-Range', f'bytes {offset + (1 if mode == "bad-range" else 0)}-{len(media)-1}/{len(media)}')
        self.end_headers()
        try:
            for pos in range(offset, len(media), 8192):
                chunk = media[pos:pos+8192]
                if mode == 'corrupt': chunk = bytes([chunk[0] ^ 255]) + chunk[1:]
                self.wfile.write(chunk); self.wfile.flush()
                with lock: stats['bytes'] += len(chunk)
                if mode == 'interrupt' and pos-offset > 100000: self.close_connection = True; return
                time.sleep(float(q.get('delay', ['0.025'])[0]))
        except (BrokenPipeError, ConnectionResetError): pass
print(json.dumps({'id': digest, 'bytes':len(media), 'port':args.port}), flush=True)
ThreadingHTTPServer(('127.0.0.1', args.port), Handler).serve_forever()
