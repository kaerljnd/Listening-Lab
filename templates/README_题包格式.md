# Listening Lab 题包格式 v1.0

## 1. 原则

程序核心放在 `app/`，任何题目、答案、音频、人物图、Transcript 都不得写入 `app/`。
每一套材料单独放在 `practice_packs/<set_id>/`。

## 2. 题包目录

```text
practice_packs/
└── 20260906A/
    ├── manifest.json
    ├── pack.json
    ├── audio/
    │   ├── M1.mp3
    │   └── M2H.mp3
    └── images/
        ├── male_single.png
        ├── female_single.png
        ├── conversation_pair.png
        └── lecture_female.png
```

## 3. manifest.json

只用于 Practice Library 快速扫描，不放完整题目。
必须包含：`schema_version`、`set_id`、`title`、`pack_file`、`modules`。

## 4. pack.json

### module
- `module_id`: `M1` / `M2H` / `M2S` 等
- `audio`: 模块长音频相对路径
- `materials`: 听力材料列表
- `questions`: 题目列表

### material
固定 `type` 只允许：
- `best_response`
- `conversation`
- `announcement`
- `academic_talk`

必备字段：
- `material_id`
- `type`
- `listen_window: [start_sec, end_sec]`
- `visual`
- `transcript`
- `question_ids`

Transcript 当前可以直接是字符串；未来建议改成带时间戳的数组：

```json
[
  {"start": 12.3, "end": 16.8, "speaker": "Professor", "text": "..."},
  {"start": 16.8, "end": 21.4, "speaker": "Student", "text": "..."}
]
```

### question
必备字段：
- `question_id`
- `question_number`
- `material_id`
- `stem`
- `options`（当前版本固定 4 个）
- `correct_answer`（A/B/C/D）
- `answer_verified`
- `timer_sec`：Best Response / Conversation / Announcement = 20；Academic Talk = 30

可选字段：
- `explanation`
- `evidence`

教师标准 Evidence 可存点或区间：

```json
{"time": 82.4}
```

或：

```json
{"start": 82.4, "end": 90.1}
```

## 5. 新建题包

在 ListeningLab 根目录运行：

```bash
python3 tools/new_pack.py 20260906A
```

Windows 也可以：

```bat
py -3 tools\new_pack.py 20260906A
```

然后把音频和图片放进去并填写 `pack.json`。

## 6. 检查题包

```bash
python3 tools/validate_pack.py practice_packs/20260906A
```

只有 `阻断错误：0` 才建议正式使用。

## 7. 加入程序

只需把整个题包目录复制到 `practice_packs/`。Listening Lab 已经启动时不必重启，在 Practice Library 点击“重新扫描题包”即可。
