# Listening Lab v1.9.2

单篇 Academic Talk 精练继续聚焦：词汇盲点 / 框架理解 / 题目分析。

v1.9.2 重点：
- 作业 / 完整分析 与 自主练习分离
- 自主练习可跳过分析直接看 Transcript
- Transcript 后可一键确认“全部理解，答案无需修改”
- Results Locked 缺项可一键定位
- 分析页可展开回看全部题目
- Evidence / Main Point / 词汇等时间锚点强化点击回听
- 保留 Main Point 动态增删及“时间点可选”原则

详见 `README_v1.9.2.md`。


## v1.9.3 ongoing improvements (2026-10-17)
- 20260908A M1 Q2: source pack identifies 30–31s as a one-second silent placeholder. `audio_missing: true` stops normal first-pass playback, shows a warning, and excludes the item from verified accuracy. A replacement original recording is still required.
- Single Academic Talk **自主练习** now offers a separate answer-check panel after the first attempt, without requiring the complete diagnostic steps. The **作业 / 完整分析** answer-release rules are unchanged.
- Transcript words are clickable during analysis, seeking the audio to the selected position; highlighting follows playback. If `word_timings` (one object with `start` per word) exists in the material, the player uses it. Without word timings, seeking is **rough interpolation only**, clearly labeled as approximate. Real word-level sync requires forced alignment against the original audio.
- The Pages/static hosting conversion has **not yet been enabled**. The local Python server still provides `/api/packs`; the current repository must not be assumed static-host-ready.
- Caveat: these changes were committed to source control, but have not yet been end-to-end browser/audio verified.
