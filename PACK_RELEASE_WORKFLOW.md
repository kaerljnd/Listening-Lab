# Listening Lab 题包发布流程 v1.1

> 当前标准：`classroom-pilot` 分支 + `tools/release_pack.py`。本文描述仓库当前脚本实际执行的检查；浏览器端 Smoke Test 仍需人工完成。

## 1. 一次性基础配置

阿里云 Function Compute 后端使用版本：

`classroom-pilot-0.6.9-set-policy`

该版本通过 set_id 格式校验（`YYYYMMDD[A-Z]`），不再为每套题包维护逐题包白名单。新题包是否显示由 `practice_packs/catalog.json` 决定。

发布新题包前，可检查：

- API Health：`https://listeni-lab-api-yuhpblgpyn.cn-hangzhou.fcapp.run/health`
- 预期版本字段：`classroom-pilot-0.6.9-set-policy`
- Git 分支必须是：`classroom-pilot`

新增标准题包通常不需要再次修改或部署阿里云后端。

## 2. 标准目录结构

```text
practice_packs/<SET_ID>/
  manifest.json
  pack.json
  audio/
    M1.mp3
    M2H.mp3
  data/
    M1_materials_1.json
    M1_questions_1.json
    ...
  images/                 # 需要图片时使用
```

音频文件名建议使用简单 ASCII 名称（例如 `M1.mp3`、`M2H.mp3`），避免空格和特殊字符造成跨浏览器 URL 处理差异。前端已加入媒体 URL 标准化比较，但仍应保持统一命名。

`manifest.json` 提供套题元数据和模块题数；`pack.json` 描述模块音频及材料/题目数据位置。题目和材料既可以内嵌在 `pack.json`，也可以通过 `materials_files`、`questions_files` 引用一个或多个 JSON 数组分片。学生端和教师端均支持分片加载。

## 3. 固定发布命令

在本地 Listening Lab 仓库根目录执行。

### 第一步：检查基础结构

```bash
python tools/validate_pack.py practice_packs/<SET_ID>
```

Windows 可使用：

```powershell
py -3 tools\validate_pack.py practice_packs\<SET_ID>
```

### 第二步：执行发布预检（不修改文件）

```bash
python tools/release_pack.py <SET_ID> --check-only
```

`--check-only` 只做检查，不重建 catalog、不更新缓存标识、不生成最终 Release Report，也不会提交 Git。

### 第三步：通过后正式发布

```bash
python tools/release_pack.py <SET_ID> --publish
```

脚本要求当前 Git 分支为 `classroom-pilot`，并使用本地 Git 的 `origin` remote。通过检查后会：

1. 从所有有效的 `manifest.json` 重建 `practice_packs/catalog.json`；
2. 将 `app/index.html` 中的 `classroom-pilot-x.y.z` 缓存标识的 patch 加 1；
3. 生成 `release_reports/<SET_ID>_RELEASE_REPORT.txt`；
4. 只暂存本次题包目录、catalog、学生端 index 和报告；
5. 创建 commit 并 push 到 `classroom-pilot`。

不要手工维护逐题包前端或后端白名单。不要只上传 catalog 而遗漏题包 JSON、分片或音频。

## 4. 自动检查实际覆盖范围

### 基础题包检查（`validate_pack.py`）

- manifest、pack 和目录中的 set_id 一致；
- manifest 与 pack 的模块集合和题数一致；
- M1 / M2H 模块音频文件存在；
- 分片 JSON 可读取且顶层为数组；
- material_id、question_id 不为空且不重复；
- 题目引用的 material 存在；
- 题型属于允许集合：`best_response`、`conversation`、`announcement`、`academic_talk`；
- 每题 4 个选项，correct_answer 为 A/B/C/D；
- listen_window 合法，且在可读取的音频时长范围内；
- manifest 中声明的题型数量与实际数据一致。

若本机安装了 `ffprobe`，脚本会读取音频时长并校验时间窗；若无法读取时长，会给出警告，不能把该警告理解成音频时长已验证。过短的材料间隔、疑似过宽的材料窗口、缺少 transcript 等情况会产生警告。

### 标准新托福发布阻断检查（`release_pack.py`）

- 必须包含 M1 + M2H；
- M1=32、M2H=15、总计 47 题；
- 每题答案必须设置 `answer_verified: true`；
- 正式题包目录不能包含 ZIP / 7z / RAR；
- 单文件达到 GitHub 100 MB 限制时阻断，达到 45 MB 时警告；
- 学生端必须存在媒体 URL 标准化函数 `sameAudioSource`，且不能重新出现 `audio.src.includes(src)`；
- 后端必须使用 set_id 格式校验，不能恢复逐题包白名单；
- 学生端不能恢复逐题包 `CLASSROOM_SET_IDS` 白名单。

注意：脚本不会代替教师判断答案语义，也不会模拟真实浏览器播放、身份弹窗、云端 Session 写入或教师端查询。教师端分片加载兼容性也必须在发布后的人工检查中确认。

## 5. GitHub Pages 部署后 Smoke Test（必做）

在 GitHub Actions 中确认本次 `pages build and deployment` 的 Build、Deploy、Report Build Status 全部成功。然后用浏览器检查：

1. **套题目录**：学生端列表能看到新 set；`catalog.json` 中存在对应 set_id。
2. **题包读取**：M1、M2H 均能打开；pack.json 和所有 JSON 分片没有 404。
3. **音频播放**：分别测试首听播放、暂停、继续、From start；进入分析阶段后再次测试 Play / From start。重点检查长音频分段定位和拖动。
4. **身份弹窗**：点击开始后必须出现班号（可选）和学生标识（必填）；取消时不得创建 Session。
5. **云端记录**：使用 TEST 班号 / TEST 学生标识建立一次测试 Session；教师端刷新后应能看到对应套题、模块、状态和学生标识。
6. **答案读取**：教师端详情页显示正确答案，首听正确率分母不应为 0/0；抽查 First / Second / Transcript 后记录。
7. **数据分析**：确认答题选择历史、修改次数和材料分析记录能正常显示。

浏览器测试完成后，把 Release Report 中的 Smoke Test 项目标记为 PASS，并记录测试日期/浏览器。GitHub Actions 绿色只证明构建和部署成功，不等于以上交互已全部验证。

## 6. 答案修订与来源追踪

如果官方/原始 Answer Key 与题目、音频或转写语义存在冲突：

- 不要只覆盖 `correct_answer` 而删除原始来源；
- 由教师确认后再修订；
- 保留 `answer_source`、`answer_revision_note` 等来源说明；
- 若题目因原 PDF 缺页而重建，使用 `source_reconstructed: true` 并说明依据；
- 修订后重新执行完整预检，并在教师端核对答案映射。

`answer_verified: true` 是发布门槛，不代表脚本自动证明答案正确；最终语义核验仍由教师负责。

## 7. 后端何时需要重新部署

仅新增符合格式的 set_id（例如 `20261101A`），且当前 Health 仍返回 `classroom-pilot-0.6.9-set-policy` 时，不需要为每套题包重新部署阿里云。

只有修改后端代码、API 字段、权限或数据结构时，才需要单独评估并部署 Function Compute。静态题包发布与后端部署是两件事。

## 8. 失败与回滚

- 预检有阻断错误：停止发布，修复源题包后重新检查。
- Pages Build / Deploy 失败：先看 Actions 日志，不要重复盲目上传或手工改 catalog。
- 部署后浏览器 Smoke Test 失败：本次发布不验收；定位是题包、静态资源、前端还是后端问题。
- 需要回滚已发布 commit 时，优先使用 `git revert <commit_sha>`，再 push 到 `classroom-pilot`；不要用 force push 改写历史。

## 9. 当前已发布题包

截至 2026-10-31，`20261020A` 与 `20261021A` 已进入 catalog，GitHub Pages 构建和部署通过。两套题包各 47 题；各自的详细校验和来源说明见 `release_reports/`。浏览器实际创建测试 Session、教师端可见性和分析阶段播放仍按第 5 节完成验收。
