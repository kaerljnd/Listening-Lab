# 课堂 Session 与数据说明

> 本文描述当前阿里云课堂 API 的数据流，不包含任何真实密钥或学生记录。

## 1. 学生身份字段

每次从正式题包开始练习时，学生端会显示身份弹窗：

| 字段 | 要求 | 说明 |
| --- | --- | --- |
| `student_code` | 必填，最多 40 字符 | 建议使用姓名拼音首字母缩写或英文名 |
| `class_code` | 可选，最多 40 字符 | 无班号时可留空 |
| `set_id` | 必填 | 题包 ID，格式为 8 位日期 + 大写字母，例如 20261021A |
| `module_id` | 必填 | M1、M2H，或专项/单篇模式对应的来源模块 |
| `practice_mode` | 必填 | `full_module`、`type_practice` 或 `single_talk` |

学生标识不是登录账号，也不是身份认证。当前浏览器会保存最近使用的班号和学生标识以便预填；不要把手机号、身份证号、住址等敏感信息放进这些字段。

## 2. Session 生命周期

```text
选择题包 / 练习模式
        │
        ▼
身份弹窗（学生标识必填，班号可选）
        │
        ▼
POST /session
        │
   成功才开始
        │
        ├─ 练习中：progress / response / question / analysis
        │
        ├─ 正常完成：POST /session/status → completed
        │
        └─ 中途退出：POST /session/status → abandoned
```

如果创建 Session 的 API 请求失败，学生端会提示错误并阻止本次练习开始，以免出现“学生已练习、教师端却没有云端记录”的情况。

状态值：
- `in_progress`：进行中；
- `completed`：已完成；
- `abandoned`：中途退出。

## 3. Tablestore 数据表

| 表 | 主键 | 主要内容 |
| --- | --- | --- |
| `sessions` | `session_id` | 学生/班号、套题、练习类型、模块、状态、开始/结束时间、当前进度和事件日志 |
| `question_responses` | `session_id + question_id` | 首次答案、初始选择、选择历史、修改次数、反应时间、是否超时 |
| `question_attempts` | `session_id + question_id` | Second / Transcript 后答案、信心、错误原因、Evidence、复核路径等 |
| `material_analysis` | `session_id + material_id` | 主题前后判断、Main Points、词汇标记、框架问题、Transcript 查看和重听记录 |

数据字段以 `backend/classroom_api_app.py` 当前实际写入为准；新增字段时应同步检查后端、学生端 payload 和教师端详情页。

## 4. API 路由

API 根地址：

`https://listeni-lab-api-yuhpblgpyn.cn-hangzhou.fcapp.run`

| 方法 | 路径 | 用途 | 访问要求 |
| --- | --- | --- | --- |
| GET | `/health` | 服务健康和版本信息 | 公开 |
| POST | `/session` | 创建 Session | 学生端调用 |
| POST | `/session/status` | 更新 completed / abandoned 状态 | 学生端调用 |
| POST | `/session/progress` | 保存当前进度和事件日志 | 学生端调用 |
| POST | `/response` | 保存首次作答和选择历史 | 学生端调用 |
| POST | `/question` | 保存分析阶段作答和诊断信息 | 学生端调用 |
| POST | `/analysis` | 保存材料级分析记录 | 学生端调用 |
| GET | `/teacher/sessions?limit=500` | 查询 Session 列表 | 必须提供 `X-Teacher-Key` |
| GET | `/teacher/session/<session_id>` | 查询 Session 详情 | 必须提供 `X-Teacher-Key` |

教师端通过 HTTP Header `X-Teacher-Key` 传递密钥。Function Compute 使用环境变量 `TEACHER_KEY` 校验。教师密钥只保存在当前浏览器标签页的 `sessionStorage`，退出教师页面后清除。

## 5. 权限边界与注意事项

- `/teacher/sessions` 和 `/teacher/session/<id>` 使用 `teacher_required` 保护。
- 学生端写入路由由网页直接调用，不要求教师密钥；CORS 允许来源控制不等于用户身份认证。
- `student_code` 只是记录归类字段，不应被当作密码或身份凭证。
- 不要把 `TEACHER_KEY`、阿里云 AccessKey、STS Token 或其他密钥提交到仓库。
- 本系统当前把课堂数据写入云端 Tablestore；本地运行网页不会自动变成纯本地数据模式。

## 6. 排查没有记录的顺序

如果学生做完练习但教师端没有 Session，按顺序检查：

1. 开始练习时是否出现身份弹窗，学生标识是否填写；
2. 浏览器是否显示“课堂服务器暂时无法连接”；
3. API Health 是否返回 `ok: true`；
4. 创建 Session 的 `POST /session` 是否返回 201；
5. 教师端是否使用正确的 `TEACHER_KEY`，并点击“刷新数据”；
6. 教师端是否按正确的班号、学生标识、套题和状态筛选；
7. 如果 Session 存在但正确答案显示 `—`，检查教师端是否成功读取该题包的 `questions_files` 分片，以及题目 JSON 中是否存在 `correct_answer`。

不要为了排查而删除已完成的 Session。测试时使用 TEST 标识，并在教师端通过筛选区分测试记录。
