Listening Lab 标准题包目录

每套正式题包放在：
practice_packs/<SET_ID>/

例如：
practice_packs/20261026A/
  manifest.json
  pack.json
  audio/
  data/
  images/

固定发布规则：
1. manifest.json 是题包元数据唯一来源。
2. 不手工编辑 practice_packs/catalog.json。
3. 不在学生端或后端维护逐题包白名单。
4. .listeningpack.zip / ZIP 只用于备份和交付，不放进正式题包目录。
5. 正式发布统一使用：
   python tools/release_pack.py 20261026A --check-only
   python tools/release_pack.py 20261026A --publish

发布脚本会自动：
- 校验目录名 / manifest.set_id / pack.set_id
- 支持内嵌或 materials_files / questions_files 分片格式
- 检查 M1=32、M2H=15、总计47题
- 检查答案是否已核验
- 检查材料/题目引用和音频文件
- 阻止 ZIP 和超过 GitHub 限制的大文件进入正式题包
- 从所有 manifest.json 自动重建 catalog.json
- 自动更新前端缓存版本
- 生成 release_reports/<SET_ID>_RELEASE_REPORT.txt

只有 RELEASE_REPORT 为 PASS 才允许发布。
