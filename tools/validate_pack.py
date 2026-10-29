#!/usr/bin/env python3
from __future__ import annotations

import json
import subprocess
import sys
from collections import Counter
from pathlib import Path

ALLOWED_TYPES = {"best_response", "conversation", "announcement", "academic_talk"}
ALLOWED_ANSWERS = {"A", "B", "C", "D"}
TIMING_WPM_FLOOR = {"conversation": 95, "announcement": 95, "academic_talk": 90}
MIN_POST_MATERIAL_GAP = 12.0


def load_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def load_module_list(pack_dir: Path, mod: dict, inline_key: str, files_key: str, errors: list[str]) -> list:
    """Load a module list from inline JSON or one/more fragment files."""
    mid = mod.get("module_id") or "?"
    inline = mod.get(inline_key)
    if isinstance(inline, list):
        return inline

    files = mod.get(files_key)
    if not files:
        errors.append(f"{mid}: 缺少 {inline_key} 或 {files_key}")
        return []
    if not isinstance(files, list):
        errors.append(f"{mid}: {files_key} 必须是数组")
        return []

    out = []
    for rel in files:
        path = pack_dir / str(rel)
        if not path.is_file():
            errors.append(f"{mid}: 找不到分片文件 {rel}")
            continue
        try:
            part = load_json(path)
        except Exception as exc:
            errors.append(f"{mid}: 分片文件 {rel} 无法读取：{exc}")
            continue
        if not isinstance(part, list):
            errors.append(f"{mid}: 分片文件 {rel} 顶层必须是数组")
            continue
        out.extend(part)
    return out


def expanded_pack(pack_dir: Path, pack: dict, errors: list[str] | None = None) -> dict:
    errors = errors if errors is not None else []
    result = dict(pack)
    modules = []
    for raw_mod in pack.get("modules", []):
        mod = dict(raw_mod)
        mod["materials"] = load_module_list(pack_dir, raw_mod, "materials", "materials_files", errors)
        mod["questions"] = load_module_list(pack_dir, raw_mod, "questions", "questions_files", errors)
        modules.append(mod)
    result["modules"] = modules
    return result


def audio_duration(path: Path):
    try:
        cp = subprocess.run(
            ["ffprobe", "-v", "quiet", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", str(path)],
            capture_output=True, text=True, timeout=10, check=True
        )
        return float(cp.stdout.strip())
    except Exception:
        return None


def validate(pack_dir: Path):
    errors, warnings = [], []
    manifest_path = pack_dir / "manifest.json"
    if not manifest_path.exists():
        return ["缺少 manifest.json"], []
    try:
        manifest = load_json(manifest_path)
    except Exception as exc:
        return [f"manifest.json 无法读取：{exc}"], []

    pack_file = manifest.get("pack_file", "pack.json")
    pack_path = pack_dir / pack_file
    if not pack_path.exists():
        return [f"缺少 {pack_file}"], []
    try:
        raw_pack = load_json(pack_path)
    except Exception as exc:
        return [f"{pack_file} 无法读取：{exc}"], []

    manifest_set_id = str(manifest.get("set_id") or "").strip()
    pack_set_id = str(raw_pack.get("set_id") or "").strip()
    folder_set_id = pack_dir.name

    if not manifest_set_id:
        errors.append("manifest.json 缺少 set_id")
    if not pack_set_id:
        errors.append("pack.json 缺少 set_id")
    if manifest_set_id and pack_set_id and manifest_set_id != pack_set_id:
        errors.append("manifest.set_id 与 pack.set_id 不一致")
    if manifest_set_id and manifest_set_id != folder_set_id:
        errors.append(f"目录名 {folder_set_id} 与 manifest.set_id={manifest_set_id} 不一致")
    if pack_set_id and pack_set_id != folder_set_id:
        errors.append(f"目录名 {folder_set_id} 与 pack.set_id={pack_set_id} 不一致")

    pack = expanded_pack(pack_dir, raw_pack, errors)

    manifest_modules = {
        m.get("module_id"): m for m in manifest.get("modules", [])
        if m.get("module_id")
    }

    seen_modules = set()
    for mod in pack.get("modules", []):
        mid = mod.get("module_id")
        if not mid:
            errors.append("存在 module_id 为空的模块")
            continue
        if mid in seen_modules:
            errors.append(f"重复 module_id：{mid}")
        seen_modules.add(mid)

        audio = pack_dir / str(mod.get("audio", ""))
        if not audio.is_file():
            errors.append(f"{mid}: 找不到音频 {mod.get('audio')}")
            duration = None
        else:
            duration = audio_duration(audio)
            if duration is None:
                warnings.append(f"{mid}: 未能读取音频时长（ffprobe 不可用时可忽略）")

        mats = mod.get("materials", [])
        questions = mod.get("questions", [])
        material_map = {}
        for m in mats:
            matid = m.get("material_id")
            if not matid:
                errors.append(f"{mid}: 存在 material_id 为空的材料")
                continue
            if matid in material_map:
                errors.append(f"{mid}: 重复 material_id：{matid}")
            material_map[matid] = m
            tp = m.get("type")
            if tp not in ALLOWED_TYPES:
                errors.append(f"{mid}/{matid}: type={tp!r} 不在允许列表中")
            win = m.get("listen_window")
            if not (isinstance(win, list) and len(win) == 2 and all(isinstance(x, (int, float)) for x in win)):
                errors.append(f"{mid}/{matid}: listen_window 必须是 [start, end]")
            else:
                if win[0] < 0 or win[1] <= win[0]:
                    errors.append(f"{mid}/{matid}: listen_window 无效 {win}")
                if duration is not None and win[1] > duration + 0.5:
                    errors.append(f"{mid}/{matid}: 结束时间 {win[1]}s 超过音频总时长 {duration:.2f}s")
            visual = m.get("visual")
            if visual and not (pack_dir / visual).is_file():
                errors.append(f"{mid}/{matid}: 找不到图片 {visual}")
            transcript = str(m.get("transcript") or "").strip()
            if not transcript:
                warnings.append(f"{mid}/{matid}: 没有 transcript，无法完成完整文本分析")
            elif isinstance(win, list) and len(win) == 2 and win[1] > win[0] and tp in TIMING_WPM_FLOOR:
                words = len(transcript.split())
                span = float(win[1]) - float(win[0])
                if words and span > 0:
                    wpm = words / span * 60
                    if wpm < TIMING_WPM_FLOOR[tp]:
                        warnings.append(
                            f"{mid}/{matid}: listen_window 疑似过宽（约 {wpm:.0f} wpm），"
                            "可能把答题静音计入材料；请核对 audio_start/audio_end"
                        )

        ordered_mats = [
            m for m in mats
            if isinstance(m.get("listen_window"), list)
            and len(m.get("listen_window")) == 2
            and all(isinstance(x, (int, float)) for x in m.get("listen_window"))
        ]
        ordered_mats.sort(key=lambda m: m["listen_window"][0])
        for current, nxt in zip(ordered_mats, ordered_mats[1:]):
            if current.get("type") == "best_response":
                continue
            gap = float(nxt["listen_window"][0]) - float(current["listen_window"][1])
            if gap < MIN_POST_MATERIAL_GAP:
                warnings.append(
                    f"{mid}/{current.get('material_id')}: 材料结束到下一材料仅 {gap:.1f}s，"
                    "疑似 audio_end 延伸进答题/静音区间"
                )

        seen_q = set()
        for q in questions:
            qid = q.get("question_id")
            if not qid:
                errors.append(f"{mid}: 存在 question_id 为空的题目")
                continue
            if qid in seen_q:
                errors.append(f"{mid}: 重复 question_id：{qid}")
            seen_q.add(qid)
            matid = q.get("material_id")
            if matid not in material_map:
                errors.append(f"{mid}/{qid}: 引用了不存在的 material_id={matid}")
            opts = q.get("options", [])
            if len(opts) != 4:
                errors.append(f"{mid}/{qid}: 当前版本要求 4 个选项，实际 {len(opts)} 个")
            ans = q.get("correct_answer")
            if ans not in ALLOWED_ANSWERS:
                errors.append(f"{mid}/{qid}: correct_answer={ans!r} 无效")
            if q.get("answer_verified") is not True:
                warnings.append(f"{mid}/{qid}: answer_verified 不是 true")
            timer = q.get("timer_sec")
            expected = 30 if material_map.get(matid, {}).get("type") == "academic_talk" else 20
            if timer is not None and timer != expected:
                warnings.append(f"{mid}/{qid}: timer_sec={timer}，当前规则建议 {expected}")

        declared = mod.get("question_count")
        if declared is not None and declared != len(questions):
            errors.append(f"{mid}: pack.question_count={declared}，但 questions 实际 {len(questions)}")

        manifest_mod = manifest_modules.get(mid)
        if manifest_mod:
            manifest_count = manifest_mod.get("question_count")
            if manifest_count is not None and manifest_count != len(questions):
                errors.append(f"{mid}: manifest.question_count={manifest_count}，但 questions 实际 {len(questions)}")

            actual_q_counts = Counter(material_map.get(q.get("material_id"), {}).get("type") for q in questions)
            actual_q_counts.pop(None, None)
            declared_q_counts = manifest_mod.get("question_type_counts")
            if isinstance(declared_q_counts, dict) and dict(actual_q_counts) != declared_q_counts:
                errors.append(
                    f"{mid}: manifest.question_type_counts 与实际不一致 "
                    f"(manifest={declared_q_counts}, actual={dict(actual_q_counts)})"
                )

            actual_m_counts = Counter(m.get("type") for m in mats)
            actual_m_counts.pop(None, None)
            declared_m_counts = manifest_mod.get("material_type_counts")
            if isinstance(declared_m_counts, dict) and dict(actual_m_counts) != declared_m_counts:
                errors.append(
                    f"{mid}: manifest.material_type_counts 与实际不一致 "
                    f"(manifest={declared_m_counts}, actual={dict(actual_m_counts)})"
                )
        else:
            errors.append(f"{mid}: manifest.modules 中缺少对应模块")

        for matid, m in material_map.items():
            qids = m.get("question_ids", [])
            real = [q.get("question_id") for q in questions if q.get("material_id") == matid]
            if qids and qids != real:
                warnings.append(f"{mid}/{matid}: question_ids 与 questions 中的实际关联顺序不一致")
            if not real:
                warnings.append(f"{mid}/{matid}: 没有任何题目关联")

    pack_module_ids = {m.get("module_id") for m in pack.get("modules", []) if m.get("module_id")}
    manifest_module_ids = set(manifest_modules)
    if pack_module_ids != manifest_module_ids:
        errors.append(
            f"manifest.modules 与 pack.modules 模块集合不一致 "
            f"(manifest={sorted(manifest_module_ids)}, pack={sorted(pack_module_ids)})"
        )

    if not pack.get("modules"):
        errors.append("pack.json 中没有 modules")
    return errors, warnings


def main():
    if len(sys.argv) != 2:
        print("用法：python tools/validate_pack.py practice_packs/20260830A")
        raise SystemExit(2)
    pack_dir = Path(sys.argv[1]).resolve()
    errors, warnings = validate(pack_dir)
    print(f"\n检查题包：{pack_dir}")
    print(f"阻断错误：{len(errors)}")
    for x in errors:
        print(f"  ✕ {x}")
    print(f"警告：{len(warnings)}")
    for x in warnings:
        print(f"  ⚠ {x}")
    if errors:
        print("\n结果：未通过。请先修复阻断错误。")
        raise SystemExit(1)
    print("\n结果：通过。该题包可以被 Listening Lab 载入。")


if __name__ == "__main__":
    main()
