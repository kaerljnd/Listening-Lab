# Listening Lab 题包格式 v1.1

> 本文描述当前学生端与教师端共同支持的题包格式。正式新托福题包按 M1=32、M2H=15、总计 47 题制作。

## 1. 目录与原则

程序代码放在 `app/`、`teacher/` 和 `backend/`；题目、答案、音频、Transcript 和图片放在各自题包目录中。

```text
practice_packs/
└── 20261101A/
    ├── manifest.json
    ├── pack.json
    ├── audio/
    │   ├── M1.mp3
    │   └── M2H.mp3
    ├── data/
    │   ├── M1_materials_1.json
    │   ├── M1_questions_1.json
    │   ├── M2H_materials_1.json
    │   └── M2H_questions_1.json
    └── images/                 # 可选
```

建议音频文件名使用简单 ASCII 名称，不使用空格或特殊字符。前端已处理 URL 编码差异，但统一命名更容易检查、上传和维护。

## 2. manifest.json

`manifest.json` 是题包目录元数据来源，发布脚本据此重建 `practice_packs/catalog.json`。不要手工在 catalog 中逐套添加题包。

至少包含：
- `schema_version`
- `set_id`：例如 `20261101A`
- `title`
- `pack_file`：通常为 `pack.json`
- `modules`：模块列表、题数及题型/材料类型数量

示例：

```json
{
  "schema_version": "1.0",
  "set_id": "20261101A",
  "title": "20261101A Listening",
  "pack_file": "pack.json",
  "modules": [
    {
      "module_id": "M1",
      "title": "20261101A · M1",
      "question_count": 32,
      "question_type_counts": {
        "best_response": 12,
        "conversation": 6,
        "announcement": 6,
        "academic_talk": 8
      },
      "material_type_counts": {
        "best_response": 12,
        "conversation": 3,
        "announcement": 3,
        "academic_talk": 2
      }
    },
    {
      "module_id": "M2H",
      "title": "20261101A · M2H",
      "question_count": 15
    }
  ]
}
```

如果实际模块题型数量不同，必须按真实数据填写，不能照抄示例数字。

## 3. pack.json

每个 module 至少包含：
- `module_id`：标准题包使用 `M1`、`M2H`
- `audio`：相对题包目录的音频路径
- `question_count`
- 材料和题目数据：使用内嵌数组或 JSON 分片路径

### 方式 A：内嵌

```json
{
  "schema_version": "1.0",
  "set_id": "20261101A",
  "modules": [
    {
      "module_id": "M1",
      "audio": "audio/M1.mp3",
      "materials": [],
      "questions": []
    }
  ]
}
```

### 方式 B：分片（推荐用于较大题包）

```json
{
  "schema_version": "1.0",
  "set_id": "20261101A",
  "modules": [
    {
      "module_id": "M1",
      "audio": "audio/M1.mp3",
      "question_count": 32,
      "materials_files": [
        "data/M1_materials_1.json",
        "data/M1_materials_2.json"
      ],
      "questions_files": [
        "data/M1_questions_1.json",
        "data/M1_questions_2.json"
      ]
    }
  ]
}
```

每个分片文件顶层必须是 JSON 数组。路径相对于该题包目录；学生端和教师端会自动加载并合并同类分片。

## 4. Material 数据

每个 material 建议包含：

| 字段 | 说明 |
| --- | --- |
| `material_id` | 模块内唯一 ID，例如 TALK01、CONV01、SR01 |
| `type` | `best_response` / `conversation` / `announcement` / `academic_talk` |
| `listen_window` | 原始模块音频中的绝对时间窗，单位秒：`[start, end]` |
| `transcript` | 完整文本；可为字符串，也可为包含 speaker/text 的数组 |
| `question_ids` | 关联题目 ID，建议与题目数据中的实际顺序一致 |
| `visual` | 图片相对路径，可选 |
| `speaker_gender` | 说话人图片/展示需要时使用，可选 |
| `word_timings` | 单词级时间信息，可选 |
| `word_timings_absolute` | word_timings 时间是否相对整段模块音频，可选 |
| `audio_missing` | 原始片段缺失或静音占位时可设为 true，可选 |

Transcript 字符串示例：

```json
{
  "material_id": "TALK01",
  "type": "academic_talk",
  "listen_window": [125.2, 310.8],
  "transcript": "Today we will discuss ...",
  "question_ids": ["Q8", "Q9", "Q10"]
}
```

Transcript 分段数组示例：

```json
[
  {"speaker": "Professor", "text": "Today we will discuss ..."},
  {"speaker": "Student", "text": "Could you explain ...?"}
]
```

如果提供 `word_timings`，应确保时间戳与原始音频对应。没有单词时间戳时，文本点击跳转只能使用近似位置，不应标注为精确单词对齐。强制对齐需另行处理原始音频。

## 5. Question 数据

每题必备字段：

| 字段 | 说明 |
| --- | --- |
| `question_id` | 模块内唯一题目 ID |
| `question_number` | 题目序号 |
| `material_id` | 所属 material |
| `stem` | 题干 |
| `options` | 4 个选项，顺序对应 A/B/C/D |
| `correct_answer` | A/B/C/D |
| `answer_verified` | 必须为布尔值 true |
| `timer_sec` | Best Response / Conversation / Announcement 通常 20；Academic Talk 通常 30 |

可选字段：
- `explanation`：答案解释；
- `evidence`：教师参考证据点或区间；
- `answer_source`、`answer_revision_note`：答案经来源复核修订时记录来源和理由；
- `source_reconstructed`、`source_note`：原始 PDF 缺页、题目重建时记录依据。

Evidence 可用时间点：

```json
{"time": 82.4}
```

也可用时间区间：

```json
{"start": 82.4, "end": 90.1}
```

**答案核验规则：** `answer_verified: true` 是发布门槛，但不会由程序自动判断语义正确性。必须结合原始音频、题目和转写人工核对。若答案表与材料冲突，保留修订来源，不要只改答案字母并删除来源信息。

## 6. 标准题包结构要求

- M1：32 题。
- M2H：15 题。
- 总计：47 题。
- 每题 4 个选项。
- 每道题引用存在的 material。
- `listen_window` 使用原始长音频的绝对秒数，不能超过音频长度。
- `audio`、`visual` 和分片文件路径必须真实存在。
- `manifest.modules` 的题数和题型统计必须与实际数据一致。

允许题型：
- `best_response`
- `conversation`
- `announcement`
- `academic_talk`

## 7. 新建、校验与发布

在仓库根目录执行：

```bash
python tools/new_pack.py 20261101A
python tools/validate_pack.py practice_packs/20261101A
python tools/release_pack.py 20261101A --check-only
python tools/release_pack.py 20261101A --publish
```

Windows 可将 `python` 替换为 `py -3`。

正式发布目录不要放 ZIP / 7z / RAR。压缩包只用于备份、传输或交付。单文件达到 GitHub 100 MB 限制会被发布脚本阻断；达到 45 MB 会产生警告。

详细发布步骤、脚本检查范围和部署后浏览器 Smoke Test 见仓库根目录 `PACK_RELEASE_WORKFLOW.md`。
