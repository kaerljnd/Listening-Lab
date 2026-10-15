# Listening Pack Builder v0.1

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
9. 自动生成 `manifest.json`、`pack.json`、`build_report.json`。
10. 输出 `<set_id>.listeningpack.zip`，可选直接安装进 `practice_packs/`。

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

## 当前 v0.1 的边界

本版自动化的是 **“标准化 → 校验 → 打包 → 安装”**。它还不会直接从原始 PDF 自动 OCR 出题，也不会从整段音频自动判断每篇材料的起止时间。后续版本可以在这个打包层之前继续加入 PDF/Word 导入、ASR 时间轴和自动切点建议。
