# Listening Lab 稳定基线

## stable-0.7.15

这是 Listening Lab 当前确认的稳定运行基线，用于后续题包维护、回归测试和故障排查。

- 稳定分支：`stable-0.7.15`
- 来源分支：`classroom-pilot`
- 前端缓存版本：`classroom-pilot-0.7.15`
- 固定 commit：`8678e3d69981bfcd7efb53dec1916689d52dcd6d`
- GitHub Pages Run #196：Build / Deploy / Report Build Status 全部成功

## 该基线已经确认的关键能力

- 学生端完整练习、题型专项、单篇讲座分析流程可用。
- 桌面端答案选项单击生效。
- 教师端支持 `materials_files` / `questions_files` 分片题包并显示正确答案。
- 移动端与桌面端采用分离的播放策略。
- 移动端长音频播放会按当前 `listen_window` 完成定位验证后再播放。
- iPad Safari 实测 Conversation：可以正常开始、播放结束、答题、进入下一题并自动进入后续题目。
- 移动端音频正常结束后不会再把结束状态误报为恢复/重新加载状态。
- 阿里云课堂 API 使用 set_id 格式校验，不需要为每套新题包维护逐题包白名单。

## 后续维护原则

1. **核心程序默认冻结。**
   新增真题时，不因题包更新顺手修改播放器、Session、教师端或分析流程。

2. **新增题包只走固定发布流程。**
   使用 `tools/validate_pack.py` 和 `tools/release_pack.py`，并完成最小 Smoke Test。

3. **真实课堂反馈优先。**
   只有课堂真实使用中出现可复现问题，才修改核心程序。

4. **修改核心后必须和 stable-0.7.15 对照。**
   若新问题只存在于后续版本，应优先比较与本稳定基线之间的代码差异。

5. **不要移动 stable-0.7.15。**
   这个分支应长期保持指向 commit `8678e3d69981bfcd7efb53dec1916689d52dcd6d`，作为固定恢复点。

## 当前主要工作方向

后续日常工作应以题包更新为主：

```text
原始 PDF / Answer Key / 转写 / M1-M2H 音频
→ 制作题包
→ 校验
→ 发布
→ GitHub Pages
→ 最小 Smoke Test
```

可选的后续增强（非当前阻断项）包括：音频迁移到阿里云 OSS/CDN、Transcript 单词级强制对齐、教师端媒体故障诊断可视化。
