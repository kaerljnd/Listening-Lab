# Listening Pack Builder v0.2

## 它现在能自动做什么

把一个 **Source Bundle**（Excel + 音频 + 可选图片）自动转换为 Listening Lab 标准题包：

1. 读取 `content.xlsx`。
2. 自动生成 Material / Question 关联。
3. 自动根据题型生成 20s / 30s 计时。
4. `question_id` 留空时可由 `question_number` 自动生成 `Qn`。
5. Material 的 `audio_start/audio_end` 留空时，如果 Transcript Sheet 有时间戳，会自动用最早/最晚时间推导。
6. `visual_file` 留空时，根据题型和 `speaker_gender` 自动使用默认人物图。
7. Transcript Sheet 多行会自动合并成整篇 transcript，同时保留 `transcript_segments`。
8. 自动检查题目、答案、音频区间、图片、关联关系。
9. 默认运行 **VAD + 句子时间戳 QA**：优先 WebRTC VAD，缺少依赖时回退 FFmpeg 静音检测。
10. 自动生成 `timing_qa.json`，逐篇记录声明窗口、实际语音窗口、前后静音、句子覆盖率、建议边界与严重级别。
11. 高置信度 Timing 错误（如窗口切进语音、句子时间戳跑出材料范围）会阻止直接安装，但仍保留 ZIP 供人工检查。
12. 自动生成 `manifest.json`、`pack.json`、`build_report.json`。
13. 输出 `<set_id>.listeningpack.zip`，可选直接安装进 `practice_packs/`。


## VAD 环境

Pack Builder v0.2 默认优先使用 WebRTC VAD。首次使用建议安装：

```bash
python3 -m pip install -r tools/pack_builder/requirements-vad.txt
```

Windows：

```powershell
py -m pip install -r tools\pack_builder\requirements-vad.txt
```

如果没有安装 `webrtcvad`，Builder 仍可运行，但会自动退回 FFmpeg `silencedetect`，并在 `timing_qa.json` 中明确标记为 `ffmpeg_silencedetect_fallback`。

Timing QA 默认不会自动改写时间轴，而是给出 `suggested_window` 和问题标记。明显切进语音等高置信度错误会阻止直接安装。人工确认后可用 CLI 的 `--allow-timing-review` 临时放行。

## Source Bundle

```text
20260906A_source/
├── content.xlsx
├── audio/
│   ├── M1.mp3
│   └── M2H.mp3
└── images/              # 可选；不放则自动用默认人物图
```

把整个文件夹压缩成 ZIP 后，可以直接拖进网页打包器。

## 启动网页打包器

macOS：双击 `start_pack_builder_mac.command`

Windows：双击 `start_pack_builder_windows.bat`

或：

```bash
python3 start_pack_builder.py
```

## CLI

```bash
python3 tools/pack_builder/build_pack.py source_bundles/20260906A --install
```

或者直接给 ZIP：

```bash
python3 tools/pack_builder/build_pack.py 20260906A_source.zip --install
```

## 当前 v0.2 的边界

本版自动化的是 **“标准化 → VAD/时间戳 QA → 校验 → 打包 → 安装”**。它已经能检测材料边界中的语音/静音异常，并校验已有句子时间戳，但 **不会凭 VAD 自动生成逐词强制对齐**。没有句子级时间戳时，报告会只检查材料级边界；后续可继续接入 ASR/forced alignment 生成逐句或逐词时间戳。
