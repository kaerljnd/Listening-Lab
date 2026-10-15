# Listening Lab v1.9.1 · Dynamic Framework + Time Marks

基于 v1.9 Single Talk Lab 的框架理解升级。

## 新增

### 1. Main Points 动态增删
- 文本前默认显示 2 个 Main Point。
- 学生可自由增加 / 删除，最少保留 1 个输入位，最多 6 个。
- 不再默认假设一篇讲座只能有 2–3 个分点。
- 完成条件改为：Topic + 至少 1 个 Main Point，或明确选择“我不知道”。
- 文本后框架同样支持动态增删。

### 2. Main Point 时间点
- 每个 Main Point 都可以点击“＋ 时间点”，记录当前播放器位置。
- 已记录的时间可以点击跳回音频对应位置。
- 可以清除后重新标记。
- 时间点是可选诊断信息，不影响该步骤是否完成。
- 文本前与文本后都可分别记录时间点，以比较学生原始结构判断与修正后结构。

### 3. 框架偏差标签扩展
除原有 Topic / 漏点 / 关系 / 顺序外，新增：
- 把细节当成 Main Point
- Main Points 分得太碎
- 合并了本应分开的 Main Points

### 4. Results
框架结果页会列出文本前 / 文本后的全部 Main Points、可用时间点，以及 Main Point 数量变化。

## 数据
导出 JSON `schema_version = 1.9.1`。
单篇讲座的 `talk_lab` 中新增 / 使用：
- `frameworkBefore[material_id].mainPoints[]`
- `frameworkAfter[material_id].mainPoints[]`

每个 Main Point：
```json
{
  "id": "...",
  "text": "...",
  "time": 123.45
}
```
`time` 可为 null。

题包格式不变。
