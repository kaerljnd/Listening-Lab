# Listening Lab Pack Release Pipeline v1.0

以后新增正式听力题包统一走本流程，不再手工同步 catalog、前端白名单或阿里云题包白名单。

## 一次性基础升级

阿里云 Function Compute 后端升级到 `classroom-pilot-0.6.9-set-policy` 后，新增题包不再需要逐套修改后端。后端只校验 set_id 格式（例如 `20261026A`），学生端是否能看到题包由 `practice_packs/catalog.json` 决定。

## 标准目录

```
practice_packs/<SET_ID>/
  manifest.json
  pack.json
  audio/
  data/
  images/
```

`manifest.json` 是题包元数据唯一来源。可以使用内嵌 `materials/questions`，也可以使用 `materials_files/questions_files` 分片。

## 固定发布命令

先检查：

```bash
python tools/release_pack.py 20261026A --check-only
```

确认无阻断错误后发布：

```bash
python tools/release_pack.py 20261026A --publish
```

如果只是准备文件、不自动 Git push：

```bash
python tools/release_pack.py 20261026A
```

## 自动阻断项目

- 目录名、manifest.set_id、pack.set_id 不一致
- manifest / pack 模块不一致
- 分片 JSON 缺失或格式错误
- M1 不是 32 题
- M2H 不是 15 题
- 总题数不是 47
- question 引用不存在的 material
- 选项数量、答案格式错误
- answer_verified 不是 true
- 音频文件不存在
- 正式题包目录中包含 ZIP / 7z / rar
- 单文件超过 GitHub 100 MB
- 学生端或后端重新出现逐题包白名单
- 新 set 未进入自动生成的 catalog

## 自动生成

通过预检后脚本会：

1. 从所有 `manifest.json` 重建 `practice_packs/catalog.json`
2. 自动提高 `app/index.html` 的缓存版本
3. 生成 `release_reports/<SET_ID>_RELEASE_REPORT.txt`
4. 使用 `--publish` 时只提交目标题包、catalog、缓存版本和报告到 `classroom-pilot`

## 正式题包中不要放 ZIP

`.listeningpack.zip` 只用于备份、传输或交付。正式运行目录只保留网页实际需要加载的文件，避免 GitHub 文件大小问题。

## 上线后固定 Smoke Test

每次发布后只做以下四项：

1. 套题列表能看到新 set
2. M1 / M2H 都能打开
3. 点击开始必须出现“班号 + 学生标识”
4. 用 TEST / TEST 创建一次 Session，教师端刷新后能看到记录

任一项失败，本次发布视为未完成。

## 非标准实验题包

仅在明确不是标准新托福 M1/M2H 结构时使用：

```bash
python tools/release_pack.py <SET_ID> --allow-nonstandard
```

正式真题不要使用这个参数绕过标准检查。
