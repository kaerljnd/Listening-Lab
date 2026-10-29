#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PACKS_DIR = ROOT / "practice_packs"
CATALOG_PATH = PACKS_DIR / "catalog.json"
APP_INDEX_PATH = ROOT / "app" / "index.html"
REPORTS_DIR = ROOT / "release_reports"

sys.path.insert(0, str(Path(__file__).resolve().parent))
from validate_pack import expanded_pack, load_json, validate

EXPECTED_MODULE_COUNTS = {"M1": 32, "M2H": 15}
GITHUB_HARD_LIMIT = 100 * 1024 * 1024
GITHUB_WARNING_SIZE = 45 * 1024 * 1024
ARCHIVE_SUFFIXES = {".zip", ".7z", ".rar"}


def write_json(path: Path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def scan_manifests():
    packs, errors = [], []
    for folder in sorted(PACKS_DIR.iterdir(), key=lambda p: p.name):
        if not folder.is_dir() or folder.name.startswith((".", "_")):
            continue
        manifest_path = folder / "manifest.json"
        if not manifest_path.exists():
            errors.append(f"{folder.name}: 缺少 manifest.json")
            continue
        try:
            manifest = load_json(manifest_path)
        except Exception as exc:
            errors.append(f"{folder.name}: manifest.json 无法读取：{exc}")
            continue
        set_id = str(manifest.get("set_id") or "").strip()
        if not set_id:
            errors.append(f"{folder.name}: manifest.set_id 为空")
            continue
        if set_id != folder.name:
            errors.append(f"{folder.name}: 目录名与 manifest.set_id={set_id} 不一致")
            continue
        pack_file = manifest.get("pack_file", "pack.json")
        if not (folder / pack_file).is_file():
            errors.append(f"{folder.name}: 找不到 {pack_file}")
            continue
        item = dict(manifest)
        item["folder"] = folder.name
        packs.append(item)
    packs.sort(key=lambda x: str(x.get("set_id") or x.get("folder")), reverse=True)
    return packs, errors


def strict_release_checks(pack_dir: Path):
    errors, warnings = [], []
    manifest = load_json(pack_dir / "manifest.json")
    raw_pack = load_json(pack_dir / manifest.get("pack_file", "pack.json"))
    expand_errors = []
    pack = expanded_pack(pack_dir, raw_pack, expand_errors)
    errors.extend(expand_errors)

    modules = {m.get("module_id"): m for m in pack.get("modules", []) if m.get("module_id")}
    if set(modules) != set(EXPECTED_MODULE_COUNTS):
        errors.append(f"标准新托福题包应包含 M1 + M2H；实际模块为 {sorted(modules)}")

    for mid, expected in EXPECTED_MODULE_COUNTS.items():
        mod = modules.get(mid)
        if mod and len(mod.get("questions", [])) != expected:
            errors.append(f"{mid}: 应为 {expected} 题，实际 {len(mod.get('questions', []))} 题")

    all_questions = [q for m in modules.values() for q in m.get("questions", [])]
    if len(all_questions) != 47:
        errors.append(f"整套应为 47 题，实际 {len(all_questions)} 题")

    unverified = [
        f"{m.get('module_id')}/{q.get('question_id')}"
        for m in modules.values()
        for q in m.get("questions", [])
        if q.get("answer_verified") is not True
    ]
    if unverified:
        errors.append("存在未核验答案：" + ", ".join(unverified))

    missing_transcripts = [
        f"{m.get('module_id')}/{mat.get('material_id')}"
        for m in modules.values()
        for mat in m.get("materials", [])
        if not str(mat.get("transcript") or "").strip()
    ]
    if missing_transcripts:
        warnings.append("存在缺失 transcript：" + ", ".join(missing_transcripts))

    for path in pack_dir.rglob("*"):
        if not path.is_file():
            continue
        if path.suffix.lower() in ARCHIVE_SUFFIXES:
            errors.append(f"正式题包目录不应包含压缩包：{path.relative_to(ROOT)}")
        size = path.stat().st_size
        if size >= GITHUB_HARD_LIMIT:
            errors.append(f"文件超过 GitHub 100 MB 限制：{path.relative_to(ROOT)} ({size / 1024 / 1024:.1f} MB)")
        elif size >= GITHUB_WARNING_SIZE:
            warnings.append(f"大文件接近 GitHub 限制：{path.relative_to(ROOT)} ({size / 1024 / 1024:.1f} MB)")
    return errors, warnings


def build_catalog():
    packs, errors = scan_manifests()
    if errors:
        raise RuntimeError("无法生成 catalog：\n- " + "\n- ".join(errors))
    data = {"packs": packs, "errors": []}
    write_json(CATALOG_PATH, data)
    return data


def bump_frontend_cache():
    text = APP_INDEX_PATH.read_text(encoding="utf-8")
    matches = re.findall(r"classroom-pilot-(\d+)\.(\d+)\.(\d+)", text)
    if not matches:
        raise RuntimeError("app/index.html 中找不到 classroom-pilot-x.y.z 缓存版本")
    major, minor, patch = map(int, matches[0])
    old = f"classroom-pilot-{major}.{minor}.{patch}"
    new = f"classroom-pilot-{major}.{minor}.{patch + 1}"
    APP_INDEX_PATH.write_text(text.replace(old, new), encoding="utf-8")
    return old, new


def verify_generated_consistency(target_set_id: str):
    errors = []
    catalog = load_json(CATALOG_PATH)
    catalog_ids = [str(x.get("set_id") or "") for x in catalog.get("packs", [])]
    if target_set_id not in catalog_ids:
        errors.append(f"{target_set_id} 未进入 catalog.json")

    backend_text = (ROOT / "backend" / "classroom_api_app.py").read_text(encoding="utf-8")
    if "ALLOWED_SET_IDS" in backend_text:
        errors.append("后端仍存在逐题包 ALLOWED_SET_IDS 白名单")
    if "SET_ID_PATTERN" not in backend_text:
        errors.append("后端尚未启用统一 set_id 格式校验")

    app_text = (ROOT / "app" / "app.js").read_text(encoding="utf-8")
    if "CLASSROOM_SET_IDS" in app_text:
        errors.append("学生端仍存在手工 CLASSROOM_SET_IDS 白名单")
    return errors


def make_report(set_id, base_errors, base_warnings, strict_errors, strict_warnings, cache_info, applied):
    errors = list(base_errors) + list(strict_errors)
    warnings = list(base_warnings) + list(strict_warnings)
    status = "PASS" if not errors else "BLOCKED"
    lines = [
        "Listening Lab Pack Release Pipeline v1.0",
        "=" * 48,
        f"Set: {set_id}",
        f"Result: {status}",
        "",
        "PRE-FLIGHT",
        f"- Pack validation: {'PASS' if not base_errors else 'FAIL'}",
        f"- TOEFL shape M1=32 / M2H=15 / Total=47: {'PASS' if not strict_errors else 'FAIL'}",
        f"- Answer verification: {'PASS' if not any('未核验答案' in x for x in strict_errors) else 'FAIL'}",
        f"- GitHub file-size/archive check: {'PASS' if not any(('GitHub' in x or '压缩包' in x) for x in strict_errors) else 'FAIL'}",
        "",
    ]
    if applied:
        lines.extend([
            "GENERATED",
            "- practice_packs/catalog.json: regenerated from manifest.json files",
            "- Classroom set policy: no per-pack frontend/backend whitelist",
            f"- Frontend cache: {cache_info[0]} -> {cache_info[1]}",
            f"- Classroom consistency: {'PASS' if not errors else 'CHECK ERRORS BELOW'}",
            "",
        ])
    if warnings:
        lines.append("WARNINGS")
        lines.extend(f"- {x}" for x in warnings)
        lines.append("")
    if errors:
        lines.append("BLOCKING ERRORS")
        lines.extend(f"- {x}" for x in errors)
        lines.append("")
    lines.extend([
        "ONLINE SMOKE TEST (after GitHub Pages deployment)",
        "[ ] 1. 套题列表能看到新 set",
        "[ ] 2. M1 / M2H 可以打开",
        "[ ] 3. 点击开始时必须弹出班号 + 学生标识",
        "[ ] 4. 用 TEST / TEST 建立 Session，教师端刷新后能看到记录",
        "",
        "NOTE",
        "- .listeningpack.zip / ZIP 只用于备份或交付，不进入 practice_packs 正式运行目录。",
        "- catalog.json 不再手工维护；前端和后端均不维护逐题包白名单。",
        "- 完成 backend 0.6.9 一次性升级后，未来新增题包不再需要修改阿里云代码。",
        "- 若 Result=BLOCKED，禁止发布。",
    ])
    return "\n".join(lines) + "\n", status


def git_publish(set_id: str, report_path: Path):
    branch = subprocess.run(["git", "branch", "--show-current"], cwd=ROOT, capture_output=True, text=True, check=True).stdout.strip()
    if branch != "classroom-pilot":
        raise RuntimeError(f"当前 Git 分支是 {branch!r}，必须在 classroom-pilot 发布")
    paths = [
        str((PACKS_DIR / set_id).relative_to(ROOT)),
        str(CATALOG_PATH.relative_to(ROOT)),
        str(APP_INDEX_PATH.relative_to(ROOT)),
        str(report_path.relative_to(ROOT)),
    ]
    subprocess.run(["git", "add", "--", *paths], cwd=ROOT, check=True)
    if subprocess.run(["git", "diff", "--cached", "--quiet"], cwd=ROOT).returncode == 0:
        print("没有需要提交的变化。")
        return
    subprocess.run(["git", "commit", "-m", f"Release listening pack {set_id}"], cwd=ROOT, check=True)
    subprocess.run(["git", "push", "origin", "classroom-pilot"], cwd=ROOT, check=True)


def main():
    parser = argparse.ArgumentParser(description="Listening Lab Pack Release Pipeline v1.0")
    parser.add_argument("set_id", help="题包 ID，例如 20261026A")
    parser.add_argument("--check-only", action="store_true", help="只执行校验，不改 catalog / 缓存版本")
    parser.add_argument("--publish", action="store_true", help="校验通过后自动 git add/commit/push 到 classroom-pilot")
    parser.add_argument("--allow-nonstandard", action="store_true", help="不强制 M1=32 / M2H=15 / Total=47")
    args = parser.parse_args()

    set_id = args.set_id.strip()
    pack_dir = PACKS_DIR / set_id
    if not pack_dir.is_dir():
        print(f"✕ 找不到题包目录：{pack_dir}")
        raise SystemExit(2)

    base_errors, base_warnings = validate(pack_dir)
    strict_errors, strict_warnings = ([], [])
    if not args.allow_nonstandard:
        strict_errors, strict_warnings = strict_release_checks(pack_dir)
    errors = list(base_errors) + list(strict_errors)
    warnings = list(base_warnings) + list(strict_warnings)

    if args.check_only:
        print(f"\n{set_id} PRE-FLIGHT")
        print(f"阻断错误：{len(errors)}")
        for x in errors:
            print(f"  ✕ {x}")
        print(f"警告：{len(warnings)}")
        for x in warnings:
            print(f"  ⚠ {x}")
        raise SystemExit(1 if errors else 0)

    if errors:
        report, _ = make_report(set_id, base_errors, base_warnings, strict_errors, strict_warnings, ("-", "-"), False)
        REPORTS_DIR.mkdir(exist_ok=True)
        report_path = REPORTS_DIR / f"{set_id}_RELEASE_REPORT.txt"
        report_path.write_text(report, encoding="utf-8")
        print(report)
        raise SystemExit(1)

    build_catalog()
    cache_info = bump_frontend_cache()
    consistency_errors = verify_generated_consistency(set_id)
    if consistency_errors:
        base_errors = list(base_errors) + consistency_errors

    report, status = make_report(set_id, base_errors, base_warnings, strict_errors, strict_warnings, cache_info, True)
    REPORTS_DIR.mkdir(exist_ok=True)
    report_path = REPORTS_DIR / f"{set_id}_RELEASE_REPORT.txt"
    report_path.write_text(report, encoding="utf-8")
    print(report)
    if status != "PASS":
        raise SystemExit(1)

    if args.publish:
        git_publish(set_id, report_path)
        print("\n✓ 已提交并 push 到 classroom-pilot。")
    else:
        print("\n✓ PRE-FLIGHT PASS。文件已准备好；如需自动发布，重新运行并加 --publish。")


if __name__ == "__main__":
    main()
