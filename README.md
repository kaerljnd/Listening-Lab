# Listening Lab · Classroom Pilot

> 当前项目说明（2026-10-31）。本文件是当前运行状态的主说明；历史版本记录请见文末。

Listening Lab 是一套面向 TOEFL Listening 教学的网页练习与课堂记录系统，包含学生练习端、教师记录端、题包资源和云端课堂数据 API。

## 在线入口

| 入口 | 地址 | 用途 |
| --- | --- | --- |
| 学生端 | https://kaerljnd.github.io/Listening-Lab/ | 根地址会自动跳转到 `/app/` |
| 学生端（直接） | https://kaerljnd.github.io/Listening-Lab/app/ | 选择套题、完整练习、题型专项和单篇讲座精练 |
| 教师端 | https://kaerljnd.github.io/Listening-Lab/teacher/ | 查询课堂 Session、学生答题和分析记录 |
| API Health | https://listeni-lab-api-yuhpblgpyn.cn-hangzhou.fcapp.run/health | 检查阿里云课堂 API 是否可用 |

## 当前部署快照

- GitHub 发布分支：`classroom-pilot`
- 学生端静态资源缓存标识：`classroom-pilot-0.7.9`
- 教师端静态资源缓存标识：`teacher-0.2.2`
- 阿里云 API 版本：`classroom-pilot-0.6.9-set-policy`
- 当前题包目录：17 套；最新发布为 `20261021A`、`20261020A`

说明：前端的 `0.7.9`、`0.2.2` 是用于浏览器缓存更新的资源标识，不应理解为完整的产品语义版本号。API 的实际运行版本可通过 Health 接口查看。

## 功能概览

### 学生端

- 完整模块练习：M1、M2H。
- 题型专项：Best Response、Conversation、Announcement、Academic Talk。
- 单篇 Academic Talk 精练：作业模式与自主练习模式。
- 首次作答、重听分析、Transcript 后复核和 Results 汇总。
- 记录选择历史、修改次数、反应时间、分析步骤、Evidence 和文本后答案。
- 支持题包 JSON 内嵌结构，也支持 `materials_files` / `questions_files` 分片结构。
- Transcript 点击跳转：有 `word_timings` 时按词时间定位；没有时使用近似位置，不代表精确单词对齐。
- 题目和练习进度保存在当前浏览器；课堂 Session 与答题分析数据同步到云端。

### 教师端

- 按班号、学生标识、套题、练习类型和 Session 状态筛选。
- 查看进行中、已完成和中途退出的 Session。
- 查看 First / Second / Transcript 后答案、正确答案、反应时间、选择修改历史和材料分析。
- 能读取内嵌题目，也能读取分片题包；正确答案来自题包的 `correct_answer`。

## 系统架构

```text
学生浏览器
  ├─ GitHub Pages：app/、practice_packs/catalog.json、题包 JSON、MP3、图片
  └─ HTTPS POST → 阿里云 Function Compute API
                       └─ Tablestore：Session、答题、分析记录

教师浏览器
  ├─ GitHub Pages：teacher/、题包 JSON（用于还原正确答案和材料）
  └─ HTTPS GET + X-Teacher-Key → 阿里云 API → Tablestore
```

**重要：当前 MP3 和题包静态文件仍托管在 GitHub Pages / GitHub 仓库，不在阿里云。** 阿里云目前承担课堂记录 API 和 Tablestore 数据存储，不承担音频 CDN 或音频文件托管。学生网速慢导致的音频卡顿，不能仅靠当前阿里云 Session API 解决。

详细架构见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。

## 学生开始练习时的身份信息

从正式题包开始练习时，会先出现课堂身份弹窗：

- **学生标识：必填**，最多 40 个字符；建议使用姓名拼音首字母缩写或英文名。
- **班号：可选**，最多 40 个字符；没有班号可以留空。
- 当前浏览器会记住输入内容，供下次预填。
- 学生确认后，前端先创建云端 Session，再进入练习。
- 如果 API 创建 Session 失败，练习不会开始，避免产生没有云端记录的课堂练习。

## 教师端访问

教师端需要输入阿里云 Function Compute 环境变量 `TEACHER_KEY` 对应的访问密钥。密钥只保存在当前浏览器标签页的 `sessionStorage` 中；退出教师页面会清除该标签页中的密钥。**不要把真实密钥写进 README、代码、题包或 GitHub commit。**

## 本地运行

本地服务器用于在本机加载学生端、教师端和本地题包，支持音频 HTTP Range 请求，便于播放、拖动和分段试听。

- macOS：`python3 start_local.py` 或 `bash start_mac.command`
- Windows：`py -3 start_local.py` 或运行 `start_windows.bat`
- 默认从 8000 端口开始寻找可用端口（最多尝试 8000–8020）。
- 启动后终端会显示学生端和教师端地址；教师端路径为同一地址下的 `/teacher/`。
- 新增本地题包后，回到套题选择页重新扫描即可，不必重启服务器。

**本地运行不等于完全离线。** 学生端仍将课堂 Session 和答题数据发送到当前阿里云 API；本地服务器只负责本机网页、题包和音频文件。更多说明见 [docs/LOCAL_DEVELOPMENT.md](docs/LOCAL_DEVELOPMENT.md)。

## 新增与发布题包

标准新托福题包采用：

- M1：32 题
- M2H：15 题
- 总计：47 题
- 每题 4 个选项，正确答案为 A/B/C/D，且必须经过人工核验并设置 `answer_verified: true`

正式题包放在 `practice_packs/<SET_ID>/`。以 `manifest.json` 为题包目录元数据来源；`pack.json` 可以直接内嵌题目和材料，也可以引用 JSON 分片。

推荐流程：

```bash
python tools/validate_pack.py practice_packs/20261101A
python tools/release_pack.py 20261101A --check-only
python tools/release_pack.py 20261101A --publish
```

`--publish` 会在本地 Git 仓库的 `classroom-pilot` 分支上生成 catalog、更新学生端缓存标识、生成 Release Report，并提交、推送。随后检查 GitHub Actions 的 Pages Build / Deploy，再完成浏览器 Smoke Test。

完整步骤和自动检查边界见 [PACK_RELEASE_WORKFLOW.md](PACK_RELEASE_WORKFLOW.md)。

## 最近发布题包

- `20261021A`：M1 32 题、M2H 15 题。M2H 原 PDF 缺少 Q4 页面；该题依据转写和答案表重建，并在题目数据中保留 `source_reconstructed: true`。
- `20261020A`：M1 32 题、M2H 15 题。M2H Q11、Q12、Q15 经题目、音频文本语义复核并经教师确认，分别修订为 B、A、B；修订来源记录保存在题目 JSON 中。

每套题包的检测记录位于 `release_reports/`。

## 文档索引

| 文档 | 内容 |
| --- | --- |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | 学生端、教师端、静态资源和云端数据架构 |
| [docs/CLASSROOM_DATA.md](docs/CLASSROOM_DATA.md) | Session 生命周期、数据表和 API |
| [docs/LOCAL_DEVELOPMENT.md](docs/LOCAL_DEVELOPMENT.md) | macOS / Windows 本地运行 |
| [PACK_RELEASE_WORKFLOW.md](PACK_RELEASE_WORKFLOW.md) | 题包校验、发布、部署和验收 |
| [practice_packs/README.txt](practice_packs/README.txt) | 正式题包目录规则 |
| [templates/README_题包格式.md](templates/README_题包格式.md) | manifest、pack、materials、questions 格式 |

## 数据与隐私注意事项

- `student_code` 是课堂记录的区分标识，不是用户账号或身份认证。
- 建议使用拼音首字母缩写或英文名，不要在标识中填写身份证号、手机号、家庭住址等敏感信息。
- 学生端写入 API 与教师端读取 API 的权限不同；教师查询接口需要 `X-Teacher-Key`，不要把它暴露给学生或提交到仓库。
- 本项目当前不是完全本地、完全离线的数据系统；课堂记录会写入阿里云 Tablestore。

数据字段和接口细节见 [docs/CLASSROOM_DATA.md](docs/CLASSROOM_DATA.md)。

## 历史版本说明

根目录的 `README_v1.8.3.md`、`README_v1.9.md`、`README_v1.9.1.md`、`README_v1.9.2.md` 是历史版本记录，不代表当前全部功能或部署架构。当前状态以本 README、代码和最新 Release Report 为准。
