# Listening Lab v1.8.3 · Mobile Audio Hotfix

本版针对公网手机测试中的音频问题：

1. 每一段新音频播放前统一 3 秒准备时间：每道 Best Response、以及每篇 Conversation / Announcement / Academic Talk 的首次播放。
2. 修复快速切题/跨材料时旧播放回调可能误触发，避免新页面播放上一题/错误片段。
3. 切换音频源时显式 `load()`，并在 seek 完成后才播放，改善移动浏览器定位长音频的稳定性。
4. 播放末尾增加 0.35 秒安全尾量，缓解移动端 MP3 解码/seek 边界造成的结尾截断；Analysis/Review 播放同样应用。
5. `<audio>` 改为 `preload="auto" playsinline`，并在 Start 点击时预解锁移动端音频元素。
6. 套题详情页说明已改为“每次进入一段新音频前都有 3 秒准备时间”。

手机响应式布局尚未在本版整体重构，后续单独处理。
