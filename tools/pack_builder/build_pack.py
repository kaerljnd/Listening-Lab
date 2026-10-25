#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import math
import os
import shutil
import subprocess
import sys
import tempfile
import zipfile
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any
import xml.etree.ElementTree as ET

ALLOWED_TYPES = {"best_response", "conversation", "announcement", "academic_talk"}
ALLOWED_ANSWERS = {"A", "B", "C", "D"}
ROOT = Path(__file__).resolve().parents[2]
DEFAULT_ASSETS = Path(__file__).resolve().parent / "default_assets"

DEFAULT_VISUALS = {
    ("best_response", "male"): "male_single.png",
    ("best_response", "female"): "female_single.png",
    ("best_response", "unknown"): "male_single.png",
    ("conversation", "mixed"): "conversation_pair.png",
    ("conversation", "unknown"): "conversation_pair.png",
    ("announcement", "male"): "announcement_male.png",
    ("announcement", "female"): "female_single.png",
    ("announcement", "unknown"): "announcement_male.png",
    ("academic_talk", "male"): "male_single.png",
    ("academic_talk", "female"): "lecture_female.png",
    ("academic_talk", "unknown"): "lecture_female.png",
}


def clean(v: Any) -> Any:
    if isinstance(v, str):
        return v.strip()
    return v


def truthy(v: Any) -> bool:
    if isinstance(v, bool):
        return v
    if isinstance(v, (int, float)):
        return v != 0
    return str(v or "").strip().lower() in {"1", "true", "yes", "y", "是", "启用", "enabled"}


def num(v: Any) -> float | None:
    if v is None or v == "":
        return None
    try:
        x = float(v)
        if math.isnan(x) or math.isinf(x):
            return None
        return x
    except Exception:
        return None


def integer(v: Any) -> int | None:
    x = num(v)
    return int(x) if x is not None else None


def col_index(cell_ref: str) -> int:
    letters = "".join(ch for ch in cell_ref if ch.isalpha()).upper()
    n = 0
    for ch in letters:
        n = n * 26 + (ord(ch) - 64)
    return n - 1


def read_xlsx(path: Path) -> dict[str, list[list[Any]]]:
    """Small dependency-free XLSX reader for the pack template."""
    ns = {
        "m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
        "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
        "pr": "http://schemas.openxmlformats.org/package/2006/relationships",
    }
    with zipfile.ZipFile(path) as z:
        shared: list[str] = []
        if "xl/sharedStrings.xml" in z.namelist():
            root = ET.fromstring(z.read("xl/sharedStrings.xml"))
            for si in root.findall("m:si", ns):
                text = "".join(t.text or "" for t in si.findall(".//m:t", ns))
                shared.append(text)

        wb = ET.fromstring(z.read("xl/workbook.xml"))
        rels = ET.fromstring(z.read("xl/_rels/workbook.xml.rels"))
        relmap = {r.attrib["Id"]: r.attrib["Target"] for r in rels.findall("pr:Relationship", ns)}
        out: dict[str, list[list[Any]]] = {}
        for sheet in wb.findall("m:sheets/m:sheet", ns):
            name = sheet.attrib["name"]
            rid = sheet.attrib[f"{{{ns['r']}}}id"]
            target = relmap[rid]
            if not target.startswith("/"):
                target = "xl/" + target.lstrip("/")
            else:
                target = target.lstrip("/")
            root = ET.fromstring(z.read(target))
            rows: list[list[Any]] = []
            for row in root.findall(".//m:sheetData/m:row", ns):
                vals: dict[int, Any] = {}
                maxc = -1
                for c in row.findall("m:c", ns):
                    idx = col_index(c.attrib.get("r", "A1"))
                    maxc = max(maxc, idx)
                    t = c.attrib.get("t")
                    v = c.find("m:v", ns)
                    if t == "inlineStr":
                        isel = c.find("m:is", ns)
                        val = "" if isel is None else "".join(x.text or "" for x in isel.findall(".//m:t", ns))
                    elif v is None:
                        val = ""
                    else:
                        raw = v.text or ""
                        if t == "s":
                            try: val = shared[int(raw)]
                            except Exception: val = raw
                        elif t == "b":
                            val = raw == "1"
                        elif t in {"str", "e"}:
                            val = raw
                        else:
                            try:
                                f = float(raw)
                                val = int(f) if f.is_integer() else f
                            except Exception:
                                val = raw
                    vals[idx] = val
                if maxc >= 0:
                    rows.append([vals.get(i, "") for i in range(maxc + 1)])
            out[name] = rows
        return out


def table_rows(sheet_rows: list[list[Any]]) -> list[dict[str, Any]]:
    if not sheet_rows:
        return []
    headers = [str(x).strip() for x in sheet_rows[0]]
    rows = []
    for raw in sheet_rows[1:]:
        if not any(str(x).strip() for x in raw if x is not None):
            continue
        item = {}
        for i, h in enumerate(headers):
            if h:
                item[h] = clean(raw[i] if i < len(raw) else "")
        rows.append(item)
    return rows


def pack_kv(sheet_rows: list[list[Any]]) -> dict[str, Any]:
    result = {}
    for row in table_rows(sheet_rows):
        key = str(row.get("Key", "")).strip()
        if key:
            result[key] = row.get("Value", "")
    return result


def audio_duration(path: Path) -> float | None:
    try:
        cp = subprocess.run(
            ["ffprobe", "-v", "quiet", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", str(path)],
            capture_output=True, text=True, timeout=15, check=True
        )
        return float(cp.stdout.strip())
    except Exception:
        return None


def safe_extract(zip_path: Path, dest: Path) -> None:
    with zipfile.ZipFile(zip_path) as z:
        for member in z.infolist():
            target = (dest / member.filename).resolve()
            try:
                target.relative_to(dest.resolve())
            except ValueError:
                raise ValueError(f"ZIP 包含不安全路径：{member.filename}")
        z.extractall(dest)


def find_source_root(root: Path) -> Path:
    xlsx = list(root.glob("*.xlsx"))
    if xlsx:
        return root
    children = [p for p in root.iterdir() if p.is_dir() and not p.name.startswith(".")]
    if len(children) == 1 and list(children[0].glob("*.xlsx")):
        return children[0]
    return root


def default_visual_name(tp: str, gender: str) -> str:
    gender = (gender or "unknown").strip().lower()
    if gender not in {"male", "female", "mixed", "unknown"}:
        gender = "unknown"
    if tp == "conversation": gender = "mixed"
    return DEFAULT_VISUALS.get((tp, gender), DEFAULT_VISUALS[(tp, "unknown")])


def build(source: Path, output_dir: Path, install_dir: Path | None = None, overwrite: bool = False) -> dict[str, Any]:
    errors: list[str] = []
    warnings: list[str] = []
    temp_ctx = None
    if source.is_file() and source.suffix.lower() == ".zip":
        temp_ctx = tempfile.TemporaryDirectory(prefix="listeningpack_source_")
        extracted = Path(temp_ctx.name)
        safe_extract(source, extracted)
        src = find_source_root(extracted)
    elif source.is_dir():
        src = source
    else:
        raise FileNotFoundError(f"找不到源目录/ZIP：{source}")

    xlsx_files = sorted(src.glob("*.xlsx"))
    if not xlsx_files:
        return {"ok": False, "errors": ["源目录根目录缺少 .xlsx 内容表"], "warnings": [], "output": None}
    if len(xlsx_files) > 1:
        preferred = [p for p in xlsx_files if "source" in p.name.lower() or "content" in p.name.lower()]
        xlsx = preferred[0] if preferred else xlsx_files[0]
        warnings.append(f"检测到多个 xlsx，使用：{xlsx.name}")
    else:
        xlsx = xlsx_files[0]

    try:
        sheets = read_xlsx(xlsx)
    except Exception as exc:
        return {"ok": False, "errors": [f"无法读取 XLSX：{exc}"], "warnings": [], "output": None}

    required_sheets = {"Pack", "Modules", "Materials", "Questions"}
    missing = required_sheets - set(sheets)
    if missing:
        return {"ok": False, "errors": [f"XLSX 缺少工作表：{', '.join(sorted(missing))}"], "warnings": [], "output": None}

    meta = pack_kv(sheets["Pack"])
    set_id = str(meta.get("set_id", "")).strip()
    title = str(meta.get("title", "")).strip() or (f"{set_id} Listening" if set_id else "")
    schema_version = str(meta.get("schema_version", "1.0")).strip() or "1.0"
    description = str(meta.get("description", "")).strip()
    if not set_id:
        errors.append("Pack.set_id 不能为空")
    if any(c in set_id for c in '/\\:'):
        errors.append("Pack.set_id 包含非法路径字符")

    modules_rows = [r for r in table_rows(sheets["Modules"]) if truthy(r.get("enabled", True))]
    materials_rows = table_rows(sheets["Materials"])
    questions_rows = table_rows(sheets["Questions"])
    transcript_rows = table_rows(sheets.get("Transcript", []))
    if not modules_rows: errors.append("Modules 没有启用模块")
    if not materials_rows: errors.append("Materials 没有材料")
    if not questions_rows: errors.append("Questions 没有题目")

    trans_groups: dict[tuple[str,str], list[dict[str,Any]]] = defaultdict(list)
    for tr in transcript_rows:
        mid = str(tr.get("module_id", "")).strip()
        matid = str(tr.get("material_id", "")).strip()
        if not mid or not matid: continue
        text = str(tr.get("text", "")).strip()
        if not text: continue
        trans_groups[(mid,matid)].append({
            "start": num(tr.get("start")),
            "end": num(tr.get("end")),
            "speaker": str(tr.get("speaker", "")).strip(),
            "text": text,
        })
    for arr in trans_groups.values():
        arr.sort(key=lambda x: (x["start"] is None, x["start"] or 0))

    module_defs: dict[str, dict[str,Any]] = {}
    for row in modules_rows:
        mid = str(row.get("module_id", "")).strip()
        if not mid:
            errors.append("Modules 存在 module_id 为空的行"); continue
        if mid in module_defs:
            errors.append(f"Modules 重复 module_id：{mid}"); continue
        audio_file = str(row.get("audio_file", "")).strip()
        if not audio_file:
            errors.append(f"{mid}: audio_file 不能为空")
        module_defs[mid] = {"row": row, "audio_file": audio_file}

    material_defs: dict[tuple[str,str], dict[str,Any]] = {}
    for row in materials_rows:
        mid = str(row.get("module_id", "")).strip()
        matid = str(row.get("material_id", "")).strip()
        tp = str(row.get("type", "")).strip().lower()
        if mid not in module_defs:
            errors.append(f"Materials {mid}/{matid}: module_id 不存在")
        if not matid:
            errors.append(f"Materials {mid}: material_id 不能为空"); continue
        key=(mid,matid)
        if key in material_defs:
            errors.append(f"Materials 重复：{mid}/{matid}"); continue
        if tp not in ALLOWED_TYPES:
            errors.append(f"Materials {mid}/{matid}: type={tp!r} 无效")
        material_defs[key] = row

    q_by_material: dict[tuple[str,str], list[dict[str,Any]]] = defaultdict(list)
    seen_q: set[tuple[str,str]] = set()
    for row in questions_rows:
        mid = str(row.get("module_id", "")).strip()
        qnum = integer(row.get("question_number"))
        qid = str(row.get("question_id", "")).strip() or (f"Q{qnum}" if qnum is not None else "")
        matid = str(row.get("material_id", "")).strip()
        keyq=(mid,qid)
        if not mid or mid not in module_defs: errors.append(f"Questions {qid or '?'}: module_id={mid!r} 无效")
        if not qid: errors.append(f"Questions {mid}: question_id / question_number 至少提供一个"); continue
        if keyq in seen_q: errors.append(f"Questions 重复：{mid}/{qid}")
        seen_q.add(keyq)
        if (mid,matid) not in material_defs: errors.append(f"Questions {mid}/{qid}: material_id={matid!r} 不存在")
        row = dict(row); row["question_id"] = qid; row["question_number"] = qnum
        q_by_material[(mid,matid)].append(row)
    for arr in q_by_material.values():
        arr.sort(key=lambda x: (x.get("question_number") is None, x.get("question_number") or 999999))

    if errors:
        if temp_ctx: temp_ctx.cleanup()
        return {"ok": False, "errors": errors, "warnings": warnings, "output": None}

    output_dir.mkdir(parents=True, exist_ok=True)
    work = Path(tempfile.mkdtemp(prefix="listeningpack_build_", dir=str(output_dir)))
    pack_dir = work / set_id
    (pack_dir / "audio").mkdir(parents=True)
    (pack_dir / "images").mkdir(parents=True)

    modules_out = []
    type_q_total=Counter(); type_m_total=Counter()
    for mid, mdef in module_defs.items():
        row=mdef["row"]
        audio_src = src / "audio" / mdef["audio_file"]
        if not audio_src.is_file():
            errors.append(f"{mid}: 找不到 audio/{mdef['audio_file']}")
            duration=None
        else:
            shutil.copy2(audio_src, pack_dir / "audio" / audio_src.name)
            duration=audio_duration(audio_src)
            if duration is None: warnings.append(f"{mid}: ffprobe 不可用，跳过音频总时长检查")

        mats_out=[]; qs_out=[]; module_type_m=Counter(); module_type_q=Counter()
        mats_for_module=[(k,r) for k,r in material_defs.items() if k[0]==mid]
        for (mm,matid), mr in mats_for_module:
            tp=str(mr.get("type","")).strip().lower()
            segs=trans_groups.get((mid,matid),[])
            a0=num(mr.get("audio_start")); a1=num(mr.get("audio_end"))
            timed=[s for s in segs if s["start"] is not None and s["end"] is not None]
            if a0 is None and timed: a0=min(s["start"] for s in timed)
            if a1 is None and timed: a1=max(s["end"] for s in timed)
            if a0 is None or a1 is None or a1 <= a0:
                errors.append(f"{mid}/{matid}: 缺少有效 audio_start/audio_end，且无法从 Transcript 推导")
                a0,a1=0.0,0.1
            if duration is not None and a1 > duration + 0.5:
                errors.append(f"{mid}/{matid}: audio_end={a1:.2f}s 超过音频时长 {duration:.2f}s")

            explicit_visual=str(mr.get("visual_file","")).strip()
            if explicit_visual:
                vis_src=src / "images" / explicit_visual
                if not vis_src.is_file():
                    errors.append(f"{mid}/{matid}: 找不到 images/{explicit_visual}")
                    visual_name=default_visual_name(tp,str(mr.get("speaker_gender","unknown")))
                    vis_src=DEFAULT_ASSETS/visual_name
                else:
                    visual_name=Path(explicit_visual).name
            else:
                visual_name=default_visual_name(tp,str(mr.get("speaker_gender","unknown")))
                vis_src=DEFAULT_ASSETS/visual_name
            if vis_src.is_file(): shutil.copy2(vis_src, pack_dir/"images"/visual_name)
            else: errors.append(f"缺少默认图片资源：{visual_name}")

            transcript_text=str(mr.get("transcript_text","")).strip()
            if segs:
                transcript_text=" ".join(s["text"] for s in segs)
            if not transcript_text:
                warnings.append(f"{mid}/{matid}: 没有 Transcript，无法完成完整文本分析")
            elif tp in {"conversation", "announcement", "academic_talk"} and a1 > a0:
                words=len(transcript_text.split())
                span=a1-a0
                floor={"conversation":95,"announcement":95,"academic_talk":90}[tp]
                if words and span > 0:
                    wpm=words/span*60
                    if wpm < floor:
                        warnings.append(
                            f"{mid}/{matid}: audio_start/audio_end 疑似过宽（约 {wpm:.0f} wpm），"
                            "可能把答题静音计入材料"
                        )

            qrows=q_by_material.get((mid,matid),[])
            qids=[]
            for qr in qrows:
                qid=qr["question_id"]; qids.append(qid)
                opts=[str(qr.get(f"option_{c}","")).strip() for c in "ABCD"]
                if any(not x for x in opts): errors.append(f"{mid}/{qid}: A-D 四个选项必须全部填写")
                ans=str(qr.get("correct_answer","")).strip().upper()
                if ans not in ALLOWED_ANSWERS: errors.append(f"{mid}/{qid}: correct_answer={ans!r} 无效")
                verified=truthy(qr.get("answer_verified"))
                if not verified: warnings.append(f"{mid}/{qid}: answer_verified 不是 TRUE")
                timer=integer(qr.get("timer_sec"))
                if timer is None: timer=30 if tp=="academic_talk" else 20
                evidence=[]
                es=num(qr.get("evidence_start")); ee=num(qr.get("evidence_end"))
                if es is not None:
                    if ee is not None and ee > es: evidence.append({"start":es,"end":ee})
                    else: evidence.append({"time":es})
                qout={
                    "question_id":qid,
                    "question_number":qr.get("question_number"),
                    "material_id":matid,
                    "stem":str(qr.get("stem","")).strip(),
                    "options":opts,
                    "correct_answer":ans,
                    "answer_verified":verified,
                    "timer_sec":timer,
                }
                explanation=str(qr.get("explanation","")).strip()
                vocab=str(qr.get("vocabulary","")).strip()
                if explanation: qout["explanation"]=explanation
                if evidence: qout["evidence"]=evidence
                if vocab: qout["vocabulary"]=vocab
                qs_out.append(qout); module_type_q[tp]+=1; type_q_total[tp]+=1
            if not qids: warnings.append(f"{mid}/{matid}: 没有题目关联")
            mout={
                "material_id":matid,
                "type":tp,
                "title":str(mr.get("title","")).strip() or {
                    "best_response":"Choose the best response.",
                    "conversation":"Listen to a conversation.",
                    "announcement":"Listen to an announcement.",
                    "academic_talk":"Listen to a talk."
                }.get(tp,"Listening"),
                "listen_window":[round(a0,3),round(a1,3)],
                "visual":f"images/{visual_name}",
                "speaker_gender":str(mr.get("speaker_gender","")).strip().lower() or "unknown",
                "transcript":transcript_text,
                "question_ids":qids,
            }
            if segs: mout["transcript_segments"]=segs
            mats_out.append(mout); module_type_m[tp]+=1; type_m_total[tp]+=1

        qs_out.sort(key=lambda x:(x.get("question_number") is None,x.get("question_number") or 999999))
        declared_title=str(row.get("title","")).strip() or f"{set_id} · {mid}"
        modules_out.append({
            "module_id":mid,
            "id":f"{set_id}-{mid}",
            "title":declared_title,
            "audio":f"audio/{Path(mdef['audio_file']).name}",
            "question_count":len(qs_out),
            "materials":mats_out,
            "questions":qs_out,
        })

    if errors:
        shutil.rmtree(work,ignore_errors=True)
        if temp_ctx: temp_ctx.cleanup()
        return {"ok": False, "errors": errors, "warnings": warnings, "output": None}

    pack={"schema_version":"1.0","set_id":set_id,"title":title,"modules":modules_out}
    manifest_modules=[]
    for mod in modules_out:
        qcount=Counter(); mcount=Counter()
        mat_type={m["material_id"]:m["type"] for m in mod["materials"]}
        for m in mod["materials"]: mcount[m["type"]]+=1
        for q in mod["questions"]: qcount[mat_type.get(q["material_id"],"unknown")]+=1
        manifest_modules.append({
            "module_id":mod["module_id"],"title":mod["title"],"question_count":len(mod["questions"]),
            "question_type_counts":dict(qcount),"material_type_counts":dict(mcount)
        })
    manifest={
        "schema_version":"1.0","set_id":set_id,"title":title,"pack_file":"pack.json",
        "modules":manifest_modules,"description":description or f"Generated by Listening Pack Builder from {xlsx.name}."
    }
    (pack_dir/"pack.json").write_text(json.dumps(pack,ensure_ascii=False,indent=2),encoding="utf-8")
    (pack_dir/"manifest.json").write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding="utf-8")

    # quality level
    all_mats=[m for mod in modules_out for m in mod["materials"]]
    all_q=[q for mod in modules_out for q in mod["questions"]]
    has_transcript=all(bool(m.get("transcript")) for m in all_mats) if all_mats else False
    full_verified=all(q.get("answer_verified") is True for q in all_q) if all_q else False
    has_evidence=all(bool(q.get("evidence")) for q in all_q) if all_q else False
    has_expl=all(bool(q.get("explanation")) for q in all_q) if all_q else False
    quality=1
    if has_transcript: quality=2
    if has_transcript and full_verified and has_evidence and has_expl: quality=3
    report={
        "builder_version":"0.1","source_xlsx":xlsx.name,"set_id":set_id,"quality_level":quality,
        "blocking_errors":[],"warnings":warnings,
        "stats":{"modules":len(modules_out),"materials":len(all_mats),"questions":len(all_q),
                 "material_type_counts":dict(type_m_total),"question_type_counts":dict(type_q_total)}
    }
    (pack_dir/"build_report.json").write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding="utf-8")

    zip_path=output_dir/f"{set_id}.listeningpack.zip"
    if zip_path.exists():
        if overwrite: zip_path.unlink()
        else:
            stamp=1
            while (output_dir/f"{set_id}_{stamp}.listeningpack.zip").exists(): stamp+=1
            zip_path=output_dir/f"{set_id}_{stamp}.listeningpack.zip"
    with zipfile.ZipFile(zip_path,"w",zipfile.ZIP_DEFLATED) as z:
        for p in pack_dir.rglob("*"):
            if p.is_file(): z.write(p, p.relative_to(pack_dir.parent))

    installed=None
    if install_dir is not None:
        install_dir.mkdir(parents=True,exist_ok=True)
        target=install_dir/set_id
        if target.exists():
            if overwrite: shutil.rmtree(target)
            else: errors.append(f"安装目录已存在：{target}（使用 --overwrite 可替换）")
        if not errors:
            shutil.copytree(pack_dir,target); installed=str(target)

    shutil.rmtree(work,ignore_errors=True)
    if temp_ctx: temp_ctx.cleanup()
    if errors:
        return {"ok":False,"errors":errors,"warnings":warnings,"output":str(zip_path)}
    return {"ok":True,"errors":[],"warnings":warnings,"output":str(zip_path),"installed":installed,"report":report}


def main():
    ap=argparse.ArgumentParser(description="Listening Pack Builder v0.1")
    ap.add_argument("source",help="源文件夹或 Source Bundle ZIP")
    ap.add_argument("--output",default=str(ROOT/"builder_output"))
    ap.add_argument("--install",action="store_true",help="构建后安装到当前 Listening Lab 的 practice_packs")
    ap.add_argument("--overwrite",action="store_true")
    args=ap.parse_args()
    result=build(Path(args.source).resolve(),Path(args.output).resolve(), ROOT/"practice_packs" if args.install else None,args.overwrite)
    print(json.dumps(result,ensure_ascii=False,indent=2))
    raise SystemExit(0 if result.get("ok") else 1)

if __name__=="__main__": main()
