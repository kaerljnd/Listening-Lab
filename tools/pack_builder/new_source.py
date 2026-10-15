#!/usr/bin/env python3
from pathlib import Path
import shutil, sys

ROOT=Path(__file__).resolve().parents[2]
TEMPLATE=ROOT/'templates'/'ListeningPack_Source_Template_v0.1.xlsx'
if len(sys.argv)!=2:
    print('用法：python tools/pack_builder/new_source.py 20260906A')
    raise SystemExit(2)
set_id=sys.argv[1].strip()
out=ROOT/'source_bundles'/set_id
if out.exists():
    print(f'已存在：{out}'); raise SystemExit(1)
(out/'audio').mkdir(parents=True)
(out/'images').mkdir()
shutil.copy2(TEMPLATE,out/'content.xlsx')
(out/'README.txt').write_text(
    f'''Listening Pack Source Bundle: {set_id}\n\n1. 打开 content.xlsx，把 Pack.set_id 修改为 {set_id}。\n2. 在 Modules 填模块和音频文件名。\n3. 在 Materials / Questions / Transcript 填内容。\n4. 将音频放入 audio/，自定义图片放入 images/。\n5. 构建：python tools/pack_builder/build_pack.py source_bundles/{set_id} --install\n''',encoding='utf-8')
print(f'已创建：{out}')
