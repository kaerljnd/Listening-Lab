#!/usr/bin/env python3
from __future__ import annotations
import json, shutil, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TEMPLATE = ROOT / "templates" / "sample_pack"
PACKS = ROOT / "practice_packs"

if len(sys.argv) != 2:
    print("用法：python tools/new_pack.py 20260906A")
    raise SystemExit(2)
set_id = sys.argv[1].strip()
if not set_id or any(c in set_id for c in '/\\:'):
    print("题包 ID 不合法。建议使用 20260906A 这类名称。")
    raise SystemExit(2)
out = PACKS / set_id
if out.exists():
    print(f"已存在：{out}")
    raise SystemExit(1)
shutil.copytree(TEMPLATE, out)
for name in ("manifest.json", "pack.json"):
    p = out / name
    data = json.loads(p.read_text(encoding="utf-8"))
    if name == "manifest.json":
        data["set_id"] = set_id
        data["title"] = f"{set_id} Listening"
        for m in data.get("modules", []):
            m["title"] = f"{set_id} · {m.get('module_id','M1')}"
    else:
        data["set_id"] = set_id
        data["title"] = f"{set_id} Listening"
        for m in data.get("modules", []):
            m["id"] = f"{set_id}-{m.get('module_id','M1')}"
            m["title"] = f"{set_id} · {m.get('module_id','M1')}"
    p.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
print(f"已创建：{out}")
print("下一步：放入音频/图片，填写 pack.json，然后运行 validate_pack.py。")
