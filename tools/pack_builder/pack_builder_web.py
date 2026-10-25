#!/usr/bin/env python3
from __future__ import annotations
import json, mimetypes, os, socket, tempfile, threading, webbrowser
from email.parser import BytesParser
from email.policy import default
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse
from build_pack import build

ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'builder_output'
PACKS=ROOT/'practice_packs'
HTML='''<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Listening Pack Builder</title><style>
:root{--g:#007F68;--gd:#05675C;--bg:#f6f8f7;--line:#dce6e2;--text:#202626;--muted:#65716e}*{box-sizing:border-box}body{margin:0;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;background:var(--bg);color:var(--text)}header{height:68px;background:var(--g);color:white;display:flex;align-items:center;padding:0 28px;font-weight:800;font-size:21px}.wrap{max-width:980px;margin:32px auto;padding:0 22px}.card{background:white;border:1px solid var(--line);border-radius:18px;padding:24px;margin-bottom:20px}.drop{border:2px dashed #9ebdb5;border-radius:16px;padding:35px;text-align:center;background:#f9fcfb}.drop.drag{border-color:var(--g);background:#eff8f5}button,.link{border:0;border-radius:10px;background:var(--g);color:white;font-weight:750;padding:11px 18px;cursor:pointer;text-decoration:none;display:inline-block}button:disabled{opacity:.45;cursor:not-allowed}.muted{color:var(--muted)}.row{display:flex;gap:12px;align-items:center;flex-wrap:wrap}.check{display:flex;gap:8px;align-items:center;margin:15px 0}.log{white-space:pre-wrap;background:#111a18;color:#dff5ee;border-radius:12px;padding:16px;min-height:120px;font:14px/1.55 ui-monospace,SFMono-Regular,Menlo,monospace}.ok{color:#007F68;font-weight:800}.err{color:#b42318;font-weight:800}</style></head><body><header>Listening Pack Builder · v0.2</header><div class="wrap">
<div class="card"><h2>把 Source Bundle 转成标准 Listening Pack + Timing QA</h2><p class="muted">Source Bundle 是一个 ZIP，根目录包含 <b>content.xlsx</b>、<b>audio/</b>，可选 <b>images/</b>。打包过程完全在本机完成；默认执行 VAD + 句子时间戳校验。</p><div id="drop" class="drop"><b>拖入 Source Bundle ZIP</b><br><span class="muted">或点击选择文件</span><br><br><input id="file" type="file" accept=".zip" style="max-width:100%"></div><label class="check"><input id="install" type="checkbox"> 构建成功后直接安装到本机 Listening Lab</label><label class="check"><input id="overwrite" type="checkbox"> 若题包已存在，允许覆盖</label><div class="row"><button id="build" disabled>开始 VAD 校验并打包</button><a class="link" href="/template">下载 Excel 模板</a></div></div>
<div class="card"><h3>构建日志</h3><div id="status" class="muted">等待 Source Bundle…</div><div id="log" class="log">尚未开始。</div><div id="download" style="margin-top:14px"></div></div>
</div><script>
const f=document.getElementById('file'),b=document.getElementById('build'),drop=document.getElementById('drop'),log=document.getElementById('log'),status=document.getElementById('status'),dl=document.getElementById('download');
function picked(){b.disabled=!f.files.length;if(f.files.length)status.textContent='已选择：'+f.files[0].name}f.addEventListener('change',picked);['dragenter','dragover'].forEach(e=>drop.addEventListener(e,x=>{x.preventDefault();drop.classList.add('drag')}));['dragleave','drop'].forEach(e=>drop.addEventListener(e,x=>{x.preventDefault();drop.classList.remove('drag')}));drop.addEventListener('drop',e=>{if(e.dataTransfer.files.length){f.files=e.dataTransfer.files;picked()}});
b.addEventListener('click',async()=>{if(!f.files.length)return;b.disabled=true;dl.innerHTML='';status.textContent='正在构建…';log.textContent='上传并校验中…';const fd=new FormData();fd.append('source_zip',f.files[0]);fd.append('install',document.getElementById('install').checked?'1':'0');fd.append('overwrite',document.getElementById('overwrite').checked?'1':'0');try{const r=await fetch('/api/build',{method:'POST',body:fd});const j=await r.json();log.textContent=JSON.stringify(j,null,2);status.innerHTML=j.ok?'<span class="ok">构建成功</span>':'<span class="err">构建失败</span>';if(j.download)dl.innerHTML='<a class="link" href="'+j.download+'">下载标准题包 ZIP</a>'; }catch(e){status.innerHTML='<span class="err">请求失败</span>';log.textContent=String(e)}finally{b.disabled=false}});
</script></body></html>'''

def parse_multipart(handler):
    ctype=handler.headers.get('Content-Type','')
    length=int(handler.headers.get('Content-Length','0'))
    body=handler.rfile.read(length)
    raw=(f'Content-Type: {ctype}\r\nMIME-Version: 1.0\r\n\r\n').encode()+body
    msg=BytesParser(policy=default).parsebytes(raw)
    fields={}; files={}
    for part in msg.iter_parts():
        disp=part.get('Content-Disposition','')
        name=part.get_param('name',header='content-disposition')
        filename=part.get_filename()
        if not name: continue
        payload=part.get_payload(decode=True) or b''
        if filename: files[name]=(Path(filename).name,payload)
        else: fields[name]=payload.decode('utf-8','replace')
    return fields,files

class H(BaseHTTPRequestHandler):
    def log_message(self,fmt,*args): print(fmt%args)
    def send_bytes(self,data,ctype='text/plain; charset=utf-8',status=200,filename=None):
        self.send_response(status);self.send_header('Content-Type',ctype);self.send_header('Content-Length',str(len(data)))
        if filename:self.send_header('Content-Disposition',f'attachment; filename="{filename}"')
        self.end_headers();self.wfile.write(data)
    def do_GET(self):
        p=urlparse(self.path).path
        if p=='/': return self.send_bytes(HTML.encode(),'text/html; charset=utf-8')
        if p=='/template':
            q=ROOT/'templates'/'ListeningPack_Source_Template_v0.1.xlsx'
            return self.send_bytes(q.read_bytes(),'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',filename=q.name)
        if p.startswith('/download/'):
            name=Path(unquote(p.split('/download/',1)[1])).name;q=OUT/name
            if not q.is_file(): return self.send_bytes(b'not found',status=404)
            return self.send_bytes(q.read_bytes(),'application/zip',filename=name)
        return self.send_bytes(b'not found',status=404)
    def do_POST(self):
        if urlparse(self.path).path!='/api/build':return self.send_bytes(b'not found',status=404)
        try:
            fields,files=parse_multipart(self)
            if 'source_zip' not in files: raise ValueError('没有上传 source_zip')
            name,data=files['source_zip']
            if not name.lower().endswith('.zip'): raise ValueError('只接受 ZIP Source Bundle')
            OUT.mkdir(parents=True,exist_ok=True)
            with tempfile.TemporaryDirectory(prefix='builder_upload_') as td:
                src=Path(td)/name;src.write_bytes(data)
                result=build(src,OUT,PACKS if fields.get('install')=='1' else None,fields.get('overwrite')=='1')
            if result.get('output'):
                result['download']='/download/'+Path(result['output']).name
            payload=json.dumps(result,ensure_ascii=False,indent=2).encode()
            self.send_bytes(payload,'application/json; charset=utf-8',200 if result.get('ok') else 400)
        except Exception as e:
            self.send_bytes(json.dumps({'ok':False,'errors':[str(e)]},ensure_ascii=False).encode(),'application/json; charset=utf-8',400)

def free_port(p=8010):
    for x in range(p,p+20):
        with socket.socket() as s:
            try:s.bind(('127.0.0.1',x));return x
            except OSError:pass
    raise RuntimeError('没有可用端口')

def main():
    port=free_port();url=f'http://127.0.0.1:{port}/';print('Listening Pack Builder:',url);print('Ctrl+C 停止')
    server=ThreadingHTTPServer(('127.0.0.1',port),H)
    try:webbrowser.open(url)
    except:pass
    try:server.serve_forever()
    except KeyboardInterrupt:pass
    finally:server.server_close()
if __name__=='__main__':main()
