Listening Lab 正式题包目录说明
================================

正式题包统一放在：
practice_packs/<SET_ID>/

标准目录：
  <SET_ID>/
    manifest.json
    pack.json
    audio/
      M1.mp3
      M2H.mp3
    data/
      *_materials_*.json
      *_questions_*.json
    images/                 # 可选

一、文件职责
- manifest.json：题包元数据、模块列表、题数和题型数量；catalog 由发布脚本扫描 manifest 自动生成。
- pack.json：模块音频路径，以及材料/题目内嵌数据或分片文件引用。
- data/*.json：材料或题目数组，可按模块拆成多个分片。
- audio/*.mp3：模块原始长音频。
- images/：题目或材料需要的图片（可选）。

二、标准新托福题数
- M1：32 题
- M2H：15 题
- 全套：47 题
- 每题 4 个选项；答案 A/B/C/D；answer_verified 必须为 true。

三、固定规则
1. manifest.set_id、pack.set_id 和目录名必须一致。
2. 学生端与教师端均支持 materials_files / questions_files 分片。
3. 不手工编辑 catalog.json；使用 tools/release_pack.py 自动重建。
4. 不在学生端或后端维护逐题包白名单。
5. 音频推荐使用 M1.mp3 / M2H.mp3 等简单 ASCII 文件名。
6. ZIP / 7z / RAR 仅用于备份和交付，不放入正式题包目录。
7. 不要把真实密钥、学生敏感个人信息放入题包或仓库。

四、发布前检查
  python tools/validate_pack.py practice_packs/<SET_ID>
  python tools/release_pack.py <SET_ID> --check-only
  python tools/release_pack.py <SET_ID> --publish

完整流程、自动检查边界和部署后 Smoke Test：
  ../PACK_RELEASE_WORKFLOW.md
题包字段和 JSON 示例：
  ../templates/README_题包格式.md
