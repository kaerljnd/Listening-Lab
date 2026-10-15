# Listening Lab v1.9 · Single Talk Lab

基于 v1.8.3 Mobile Audio Hotfix，新增“03 单篇讲座精练与分析”。

## 新增模式
每套题详情页会自动列出其中所有 Academic Talk，按单篇进入练习。

单篇流程：
1. First Attempt：按考试逻辑完整播放一次讲座，再完成该篇全部题目。
2. 词汇盲点：分析阶段自由重听/拖动，标记听不懂的词汇或短语位置，并记录自己听到/猜到的声音。
3. 框架理解（文本前）：填写 Topic + Main Points，或明确选择“我不知道”。
4. 题目分析（文本前）：每题重新选择答案并定位 Evidence。
5. Transcript：完成前三项后解锁。
6. 文本后修正：补充实际词/短语和意思，重写 Topic/Main Points，并标注框架偏差类型。
7. 文本后再次作答：每题再次判断。
8. Results：分别输出词汇盲点、框架前后对照、题目 First → Second → After Transcript → Correct，并给出题目分析诊断。

## 设计目标
该模式不是把 Academic Talk 专项再缩短一次，而是以“单篇诊断”为目标，重点回答三个问题：
- 哪些词/短语在声音层面没有听懂或没有及时反应？
- 对讲座 Topic / Main Points / 结构关系的理解在哪里偏了？
- 题目错误来自一遍听、Evidence 定位，还是看完文本后仍存在题干/选项分析问题？

## 数据
导出 JSON schema_version = 1.9，并新增 `talk_lab` 字段。原题包格式无需修改；该模式直接从标准题包中的 `academic_talk` material 动态生成。

## 兼容性
保留 v1.8.3 的：
- 套题选择页
- 整套练习
- 分题型专项
- 3 秒音频准备时间
- 移动端音频播放 hotfix
- 退出 / 题目回看
- Analysis / Results / Post-result Review

如果 Academic Talk 没有 Transcript，单篇讲座卡片会显示“Transcript 缺失 / 暂不可用”，避免进入无法完成的深度分析。

Content update: includes 20260920A standard listening pack (M1 + M2H).
