> **历史版本记录**：本文仅记录 v1.9.2 单篇讲座 UX 变更，不代表当前完整功能、资源托管方式或部署架构。当前项目状态请以仓库根目录 [README.md](README.md) 为准。

# Listening Lab v1.9.2 · Single Talk UX Refinement

基于学生实际测试反馈，对单篇 Academic Talk 精练进行减负与教学回看优化。

## 新增 / 修改

1. **作业 / 完整分析 与 自主练习分离**
   - 作业模式：必须完成词汇定位、文本前框架、二次选择与 Evidence 后才能查看 Transcript。
   - 自主练习：保留完整分析路径，同时允许“跳过分析 · 直接看 Transcript”。
   - 直接查看文本属于自由查看路径，不生成完整诊断 Results，避免把缺失数据误当成诊断数据。

2. **Transcript 后一键确认答案不变**
   - 新增“全部理解，所有题目答案都不用改”。
   - 一键将全部 Second Answer 复制为 After Transcript Answer。
   - 单独记录 `talkLab.postUnchanged[material_id] = true`。

3. **Results Locked 缺项可定位**
   - 缺项清单增加“去完成 →”。
   - 自动切换到对应题目并滚动到词汇、框架、Evidence、Transcript 或文本后答案区域。

4. **分析页增加全部题目回看**
   - 一屏可展开查看本篇所有题目、选项、First → Second → After Transcript、Evidence 与文本后记录。
   - 不提前显示正确答案。
   - 适合教师课堂讲解和横向比较。

5. **时间锚点统一支持回听**
   - Main Point 时间、词汇时间继续可点击回听。
   - Evidence 点 / 区间增加点击跳转。
   - Results 中词汇时间、框架时间、Evidence 可进入 Post-result Review 并跳到对应位置。

6. **题目分析排版整理**
   - 题干、第一遍答案、选项、Evidence 分区更清晰。

7. **保持 v1.9.1 原则**
   - Main Point 时间点仍为可选诊断信息，不作为完成条件。
   - Main Points 仍默认 2 个、可增删、最多 6 个。

## 数据

导出 JSON `schema_version = 1.9.2`。

`talkLab` 新增 / 使用：
- `mode`: `assignment | practice`
- `directTranscriptSkip[material_id]`: boolean
- `postUnchanged[material_id]`: boolean

题包格式不变。
