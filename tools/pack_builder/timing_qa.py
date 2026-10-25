#!/usr/bin/env python3
from __future__ import annotations

import re
import subprocess
from pathlib import Path
from typing import Any

SAMPLE_RATE = 16000
FRAME_MS = 30
VAD_AGGRESSIVENESS = 2
MERGE_GAP_SEC = 0.30
PAD_SEC = 0.12
MIN_SPEECH_SEC = 0.18

SILENCE_LIMITS = {
    "best_response": (2.5, 3.0, 2.5),
    "conversation": (4.0, 6.0, 6.0),
    "announcement": (4.0, 6.0, 6.0),
    "academic_talk": (6.0, 10.0, 8.0),
}


def _audio_duration(path: Path) -> float | None:
    try:
        cp = subprocess.run(
            ["ffprobe", "-v", "quiet", "-show_entries", "format=duration",
             "-of", "default=nw=1:nk=1", str(path)],
            capture_output=True, text=True, timeout=20, check=True,
        )
        return float(cp.stdout.strip())
    except Exception:
        return None


def _merge_regions(
    regions: list[tuple[float, float]],
    *,
    max_gap: float = MERGE_GAP_SEC,
    pad: float = PAD_SEC,
    duration: float | None = None,
) -> list[tuple[float, float]]:
    clean = sorted((max(0.0, float(a)), max(0.0, float(b))) for a, b in regions if b > a)
    if not clean:
        return []
    merged: list[list[float]] = []
    for a, b in clean:
        if not merged or a - merged[-1][1] > max_gap:
            merged.append([a, b])
        else:
            merged[-1][1] = max(merged[-1][1], b)
    out: list[tuple[float, float]] = []
    for a, b in merged:
        if b - a < MIN_SPEECH_SEC:
            continue
        a = max(0.0, a - pad)
        b = b + pad
        if duration is not None:
            b = min(duration, b)
        out.append((round(a, 3), round(b, 3)))
    return out


def _decode_pcm_16k_mono(path: Path) -> bytes:
    cp = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", str(path), "-ac", "1", "-ar", str(SAMPLE_RATE),
         "-f", "s16le", "-acodec", "pcm_s16le", "pipe:1"],
        capture_output=True, timeout=180, check=True,
    )
    return cp.stdout


def _webrtc_vad(path: Path, duration: float | None) -> tuple[list[tuple[float, float]], dict[str, Any]]:
    import webrtcvad  # provided by webrtcvad-wheels

    pcm = _decode_pcm_16k_mono(path)
    vad = webrtcvad.Vad(VAD_AGGRESSIVENESS)
    samples_per_frame = int(SAMPLE_RATE * FRAME_MS / 1000)
    bytes_per_frame = samples_per_frame * 2
    frame_sec = FRAME_MS / 1000.0

    flags: list[bool] = []
    for offset in range(0, len(pcm) - bytes_per_frame + 1, bytes_per_frame):
        frame = pcm[offset:offset + bytes_per_frame]
        flags.append(bool(vad.is_speech(frame, SAMPLE_RATE)))

    # One-frame dilation prevents clipped consonants at VAD boundaries.
    expanded = flags[:]
    for i, flag in enumerate(flags):
        if flag:
            if i > 0:
                expanded[i - 1] = True
            if i + 1 < len(expanded):
                expanded[i + 1] = True

    raw: list[tuple[float, float]] = []
    start: int | None = None
    for i, flag in enumerate(expanded + [False]):
        if flag and start is None:
            start = i
        elif not flag and start is not None:
            raw.append((start * frame_sec, i * frame_sec))
            start = None

    return _merge_regions(raw, duration=duration), {
        "engine": "webrtcvad",
        "aggressiveness": VAD_AGGRESSIVENESS,
        "sample_rate": SAMPLE_RATE,
        "frame_ms": FRAME_MS,
    }


def _ffmpeg_activity(path: Path, duration: float | None) -> tuple[list[tuple[float, float]], dict[str, Any]]:
    if duration is None:
        raise RuntimeError("无法读取音频总时长")
    cp = subprocess.run(
        ["ffmpeg", "-hide_banner", "-nostats", "-i", str(path),
         "-af", "silencedetect=noise=-38dB:d=0.20", "-f", "null", "-"],
        capture_output=True, text=True, timeout=180,
    )
    log = cp.stderr or ""
    starts = [float(x) for x in re.findall(r"silence_start:\s*([0-9.]+)", log)]
    ends = [float(x) for x in re.findall(r"silence_end:\s*([0-9.]+)", log)]

    silences: list[tuple[float, float]] = []
    ei = 0
    current_start: float | None = None
    events = []
    for line in log.splitlines():
        sm = re.search(r"silence_start:\s*([0-9.]+)", line)
        em = re.search(r"silence_end:\s*([0-9.]+)", line)
        if sm:
            events.append(("start", float(sm.group(1))))
        if em:
            events.append(("end", float(em.group(1))))
    for typ, t in events:
        if typ == "start":
            if current_start is None:
                current_start = t
        elif current_start is not None:
            silences.append((current_start, t))
            current_start = None
    if current_start is not None:
        silences.append((current_start, duration))

    speech: list[tuple[float, float]] = []
    cursor = 0.0
    for a, b in sorted(silences):
        if a > cursor:
            speech.append((cursor, a))
        cursor = max(cursor, b)
    if cursor < duration:
        speech.append((cursor, duration))

    return _merge_regions(speech, duration=duration), {
        "engine": "ffmpeg_silencedetect_fallback",
        "noise_threshold_db": -38,
        "minimum_silence_sec": 0.20,
        "note": "WebRTC VAD 不可用时使用；这是音频活动 fallback，不等同于语音分类器。",
    }


def detect_voice_regions(path: Path) -> tuple[list[tuple[float, float]], dict[str, Any], list[str]]:
    duration = _audio_duration(path)
    notes: list[str] = []
    try:
        regions, meta = _webrtc_vad(path, duration)
        if regions:
            meta["duration_sec"] = duration
            return regions, meta, notes
        notes.append("WebRTC VAD 未检测到语音，尝试 FFmpeg fallback。")
    except ModuleNotFoundError:
        notes.append("未安装 webrtcvad；已使用 FFmpeg fallback。建议安装 requirements-vad.txt。")
    except Exception as exc:
        notes.append(f"WebRTC VAD 失败：{exc}；已尝试 FFmpeg fallback。")

    try:
        regions, meta = _ffmpeg_activity(path, duration)
        meta["duration_sec"] = duration
        return regions, meta, notes
    except Exception as exc:
        notes.append(f"FFmpeg activity detection 失败：{exc}")
        return [], {"engine": "unavailable", "duration_sec": duration}, notes


def _overlap(a: float, b: float, regions: list[tuple[float, float]]) -> float:
    return sum(max(0.0, min(b, y) - max(a, x)) for x, y in regions)


def _regions_in_window(
    regions: list[tuple[float, float]], start: float, end: float
) -> list[tuple[float, float]]:
    return [
        (max(start, a), min(end, b))
        for a, b in regions
        if min(end, b) > max(start, a)
    ]


def _segment_absolute(seg: dict[str, Any], material_start: float, material_end: float) -> tuple[float | None, float | None, str]:
    try:
        a = float(seg.get("start"))
        b = float(seg.get("end"))
    except (TypeError, ValueError):
        return None, None, "missing"
    span = material_end - material_start
    if material_start > 1.0 and 0 <= a <= span + 1.0 and 0 < b <= span + 1.0 and b < material_start - 0.5:
        return material_start + a, material_start + b, "relative"
    return a, b, "absolute"


def _sentence_checks(
    material: dict[str, Any],
    vad_regions: list[tuple[float, float]],
    start: float,
    end: float,
) -> tuple[list[dict[str, Any]], list[str], list[str]]:
    checks: list[dict[str, Any]] = []
    warnings: list[str] = []
    blockers: list[str] = []
    segments = material.get("transcript_segments") or []
    if not segments:
        return checks, warnings, blockers

    for i, seg in enumerate(segments, start=1):
        a, b, mode = _segment_absolute(seg, start, end)
        row: dict[str, Any] = {
            "sentence_index": i,
            "text": str(seg.get("text") or "").strip(),
            "source_time_mode": mode,
            "start": a,
            "end": b,
            "flags": [],
        }
        if a is None or b is None or b <= a:
            row["flags"].append("MISSING_OR_INVALID_TIMESTAMP")
            warnings.append(f"句子 {i} 缺少有效时间戳")
            checks.append(row)
            continue

        duration = b - a
        coverage = _overlap(a, b, vad_regions) / duration if duration > 0 else 0.0
        row["vad_speech_coverage"] = round(coverage, 3)
        if a < start - 0.5 or b > end + 0.5:
            row["flags"].append("OUTSIDE_MATERIAL_WINDOW")
            blockers.append(f"句子 {i} 时间戳超出材料 listen_window")
        if coverage < 0.35:
            row["flags"].append("LOW_VAD_SPEECH_COVERAGE")
            warnings.append(f"句子 {i} 与 VAD 语音区重合仅 {coverage:.0%}")
        checks.append(row)

    return checks, warnings, blockers


def qa_material(
    material: dict[str, Any],
    vad_regions: list[tuple[float, float]],
) -> dict[str, Any]:
    matid = str(material.get("material_id") or "")
    tp = str(material.get("type") or "")
    window = material.get("listen_window") or []
    result: dict[str, Any] = {
        "material_id": matid,
        "type": tp,
        "declared_window": window,
        "status": "review",
        "flags": [],
        "warnings": [],
        "blocking_errors": [],
        "sentence_checks": [],
    }
    if not (isinstance(window, list) and len(window) == 2):
        result["blocking_errors"].append("INVALID_LISTEN_WINDOW")
        result["status"] = "block"
        return result
    try:
        start, end = float(window[0]), float(window[1])
    except (TypeError, ValueError):
        result["blocking_errors"].append("INVALID_LISTEN_WINDOW")
        result["status"] = "block"
        return result
    if end <= start:
        result["blocking_errors"].append("INVALID_LISTEN_WINDOW")
        result["status"] = "block"
        return result

    inside = _regions_in_window(vad_regions, start, end)
    transcript = str(material.get("transcript") or "").strip()
    if not inside:
        result["flags"].append("NO_SPEECH_DETECTED_IN_WINDOW")
        if transcript:
            result["blocking_errors"].append("有 transcript，但 listen_window 内未检测到语音")
        result["status"] = "block" if result["blocking_errors"] else "review"
        return result

    speech_start = inside[0][0]
    speech_end = inside[-1][1]
    leading = max(0.0, speech_start - start)
    trailing = max(0.0, end - speech_end)
    gaps = [max(0.0, b[0] - a[1]) for a, b in zip(inside, inside[1:])]
    max_gap = max(gaps) if gaps else 0.0
    result["detected_speech_window"] = [round(speech_start, 3), round(speech_end, 3)]
    result["suggested_window"] = [
        round(max(0.0, speech_start - 0.18), 3),
        round(speech_end + 0.22, 3),
    ]
    result["leading_silence_sec"] = round(leading, 3)
    result["trailing_silence_sec"] = round(trailing, 3)
    result["max_internal_non_speech_gap_sec"] = round(max_gap, 3)
    result["speech_coverage_ratio"] = round(_overlap(start, end, vad_regions) / (end - start), 3)

    lead_limit, trail_limit, gap_limit = SILENCE_LIMITS.get(tp, (5.0, 7.0, 7.0))
    if leading > lead_limit:
        result["flags"].append("EXCESSIVE_LEADING_SILENCE")
        result["warnings"].append(f"前静音 {leading:.1f}s")
    if trailing > trail_limit:
        result["flags"].append("EXCESSIVE_TRAILING_SILENCE")
        result["warnings"].append(f"后静音 {trailing:.1f}s")
    if max_gap > gap_limit:
        result["flags"].append("LONG_INTERNAL_NON_SPEECH")
        result["warnings"].append(f"材料内部最长非语音间隔 {max_gap:.1f}s")

    start_cut = any(a < start - 0.10 and b > start + 0.10 for a, b in vad_regions)
    end_cut = any(a < end - 0.10 and b > end + 0.10 for a, b in vad_regions)
    if start_cut:
        result["flags"].append("SPEECH_CROSSES_START_BOUNDARY")
        result["blocking_errors"].append("listen_window 起点切进语音")
    if end_cut:
        result["flags"].append("SPEECH_CROSSES_END_BOUNDARY")
        result["blocking_errors"].append("listen_window 终点切进语音")

    sentence_checks, sentence_warnings, sentence_blockers = _sentence_checks(
        material, vad_regions, start, end
    )
    result["sentence_checks"] = sentence_checks
    result["warnings"].extend(sentence_warnings)
    result["blocking_errors"].extend(sentence_blockers)

    if result["blocking_errors"]:
        result["status"] = "block"
    elif result["warnings"]:
        result["status"] = "review"
    else:
        result["status"] = "pass"
    return result


def run_timing_qa(pack_dir: Path, pack: dict[str, Any]) -> dict[str, Any]:
    modules_out: list[dict[str, Any]] = []
    global_warnings: list[str] = []
    blocking_errors: list[str] = []
    counts = {"pass": 0, "review": 0, "block": 0}

    for module in pack.get("modules", []):
        mid = str(module.get("module_id") or "")
        audio_path = pack_dir / str(module.get("audio") or "")
        if not audio_path.is_file():
            msg = f"{mid}: VAD 找不到音频 {module.get('audio')}"
            global_warnings.append(msg)
            modules_out.append({"module_id": mid, "engine": {"engine": "unavailable"}, "materials": []})
            continue

        regions, engine, notes = detect_voice_regions(audio_path)
        global_warnings.extend(f"{mid}: {x}" for x in notes)
        mat_results = []
        for material in module.get("materials", []):
            qa = qa_material(material, regions)
            mat_results.append(qa)
            counts[qa["status"]] = counts.get(qa["status"], 0) + 1
            for msg in qa.get("warnings", []):
                global_warnings.append(f"{mid}/{qa['material_id']}: {msg}")
            for msg in qa.get("blocking_errors", []):
                blocking_errors.append(f"{mid}/{qa['material_id']}: {msg}")

        modules_out.append({
            "module_id": mid,
            "audio": module.get("audio"),
            "engine": engine,
            "voice_regions": [[a, b] for a, b in regions],
            "materials": mat_results,
        })

    status = "block" if blocking_errors else ("review" if global_warnings else "pass")
    return {
        "schema_version": "1.0",
        "status": status,
        "summary": counts,
        "blocking_errors": blocking_errors,
        "warnings": global_warnings,
        "modules": modules_out,
    }
