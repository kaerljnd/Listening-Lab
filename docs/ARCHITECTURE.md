# Listening Lab 系统架构

> 当前实现说明（2026-10-31），以 `classroom-pilot` 分支代码为准。

## 1. 组件总览

Listening Lab 由三部分组成：

1. **学生端静态网页**：`app/`，由 GitHub Pages 发布。
2. **教师端静态网页**：`teacher/`，同样由 GitHub Pages 发布。
3. **课堂数据 API**：`backend/classroom_api_app.py`，部署在阿里云 Function Compute，数据写入 Tablestore。

题包、音频、图片和 Transcript 作为静态资源放在 `practice_packs/`，由 GitHub Pages 提供。

```text
                 GitHub Pages / Listening-Lab
             ┌─────────────────────────────────┐
             │  /app/                          │
学生浏览器 ──┤  /practice_packs/               │
             │  /teacher/                      │
             └──────────────┬──────────────────┘
                            │ HTTPS
              ┌─────────────┴─────────────┐
              │ Alibaba Function Compute │
              │ classroom_api_app.py     │
              └─────────────┬─────────────┘
                            │
                      Alibaba Tablestore
              ┌─────────────┼─────────────┐
              │ sessions   │ responses   │
              │ attempts   │ analysis    │
              └─────────────┴─────────────┘
```

## 2. 学生端资源加载

GitHub Pages 模式下，学生端：

1. 加载 `app/index.html`、`app.js` 和 `styles.css`；
2. 读取 `practice_packs/catalog.json`，展示可用套题；
3. 根据 catalog 中的 `folder`、`pack_file` 读取对应 `manifest.json` / `pack.json`；
4. 从模块的 `audio` 路径读取 MP3；
5. 从内嵌 `materials/questions` 或 `materials_files/questions_files` 读取材料与题目分片；
6. 按 `listen_window` 播放模块长音频中的对应片段。

路径按题包目录相对定位。建议使用 `audio/M1.mp3`、`audio/M2H.mp3` 等简单文件名。学生端已使用标准化媒体 URL 比较，避免因 URL 空格编码差异造成重复重载。

## 3. 教师端资源加载

教师端 `teacher/` 从同一 `practice_packs/` 目录读取 `pack.json` 和题目/材料分片，以建立：

- `answerMap`：题目正确答案；
- `questionMeta`：题干、选项和题目元数据；
- `materialMeta`：材料信息。

因此，教师端也必须支持 `materials_files` 和 `questions_files`。当前版本 `teacher-0.2.2` 已包含分片加载逻辑。

教师端课堂记录来自阿里云 API，不直接读取 Tablestore。

## 4. 课堂数据路径

### 学生端

开始练习时，前端要求学生标识（必填）和班号（可选），随后 POST `/session`。成功后才开始练习。

练习过程中：
- 首次选择和选择历史同步到 `/response`；
- 重听/分析后的作答与诊断字段同步到 `/question`；
- 材料级主题、框架、词汇和 Transcript 状态同步到 `/analysis`；
- 当前页面、题目、材料和事件日志快照同步到 `/session/progress`；
- 完成或退出时通过 `/session/status` 更新 Session 状态。

前端同时在当前浏览器保存练习状态，以支持刷新恢复；浏览器本地保存不替代云端 Session 记录。

### 教师端

教师端带 `X-Teacher-Key` 请求：
- `GET /teacher/sessions?limit=500`
- `GET /teacher/session/<session_id>`

详情接口返回 Session、responses、attempts 和 material_analysis，教师端再结合 GitHub 上的题包数据还原正确答案和材料内容。

## 5. 阿里云后端

当前 Health 版本：

`classroom-pilot-0.6.9-set-policy`

该版本使用 set_id 格式校验（`YYYYMMDD[A-Z]`），不再为每个新题包逐一维护后端白名单。题包是否出现在学生端由 `practice_packs/catalog.json` 控制。

后端将数据写入 Tablestore 的四类表：
- `sessions`
- `question_responses`
- `question_attempts`
- `material_analysis`

教师查询接口使用 Function Compute 环境变量 `TEACHER_KEY` 进行访问控制。不要将密钥提交到 GitHub。

## 6. GitHub Pages 与阿里云的职责边界

| 资源 / 功能 | 当前托管位置 |
| --- | --- |
| 学生端 HTML / CSS / JS | GitHub Pages |
| 教师端 HTML / CSS / JS | GitHub Pages |
| catalog / manifest / pack / JSON 分片 | GitHub Pages |
| MP3 音频 | GitHub Pages / GitHub 仓库 |
| 图片与 Transcript | GitHub Pages / GitHub 仓库 |
| Session API | 阿里云 Function Compute |
| 课堂数据 | 阿里云 Tablestore |

当前尚未把音频迁移到阿里云 OSS 或 CDN。若后续要改善跨地区音频速度，应单独评估 OSS、CDN、Range 请求、缓存策略和源站回源；不能把当前 API 部署误认为音频已迁移。

## 7. 当前资源缓存标识

- 学生端：`classroom-pilot-0.7.9`
- 教师端：`teacher-0.2.2`
- API：`classroom-pilot-0.6.9-set-policy`

前两个是静态资源 cache-busting 标识；后一个是后端服务版本。
