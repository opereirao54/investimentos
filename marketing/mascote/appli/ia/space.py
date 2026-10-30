"""Chama um Space Gradio numa conexão HTTP só: upload, fila e download na
mesma réplica (pelo proxy da nuvem, cada conexão nova cai em outra réplica e
o gradio_client falha com "session not found" / CancelledError).
Uso: space.py <host-do-space> <api_name> <saida> <json-dos-dados, @arquivo sobe>"""
import os, sys, json, uuid, httpx, shutil
host, api, out, dados = sys.argv[1], sys.argv[2], sys.argv[3], json.loads(sys.argv[4])
H = {} if os.environ.get('ANON') else {'Authorization': 'Bearer ' + os.environ['HF_TOKEN']}
with httpx.Client(base_url=f'https://{host}', headers=H, timeout=httpx.Timeout(60, read=900), http2=False) as c:
    info = c.get('/config').json()
    fn = next(i for i, d in enumerate(info['dependencies']) if d.get('api_name') == api)
    def sobe(v):
        if isinstance(v, str) and v.startswith('@'):
            p = v[1:]
            r = c.post('/gradio_api/upload', files={'files': (os.path.basename(p), open(p, 'rb'))}); r.raise_for_status()
            return {'path': r.json()[0], 'orig_name': os.path.basename(p), 'meta': {'_type': 'gradio.FileData'}}
        return v
    dados = [sobe(v) for v in dados]
    sess = uuid.uuid4().hex[:11]
    r = c.post('/gradio_api/queue/join', json={'data': dados, 'fn_index': fn, 'session_hash': sess, 'event_data': None, 'trigger_id': None}); r.raise_for_status()
    v = None
    with c.stream('GET', '/gradio_api/queue/data', params={'session_hash': sess}) as s:
        for linha in s.iter_lines():
            if not linha.startswith('data:'): continue
            m = json.loads(linha[5:])
            msg = m.get('msg')
            if msg == 'heartbeat' or msg == 'progress': continue
            if msg == 'process_completed':
                o = m.get('output', {})
                if not m.get('success'): print('ERRO', json.dumps(o)[:800]); sys.exit(1)
                v = o['data'][0]; v = v.get('video', v) if isinstance(v, dict) else v
                print('saida', v.get('path') if isinstance(v, dict) else v, flush=True)
                continue
            print(msg, m.get('rank'), m.get('queue_size'), m.get('rank_eta'), flush=True)
    # o fluxo terminou: a conexão volta ao pool e o download vai pela mesma réplica
    p = v['path'] if isinstance(v, dict) else v
    for tentativa in range(6):
        d = c.get('/gradio_api/file=' + p)
        if d.status_code == 200: break
        c.close(); c = httpx.Client(base_url=f'https://{host}', headers=H, timeout=60)
    print('download', d.status_code, d.headers.get('content-type'), len(d.content))
    if d.status_code == 200: open(out, 'wb').write(d.content); print('ok', out)
