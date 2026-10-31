# Listening Lab 本地运行说明

## 1. 作用与边界

`start_local.py` 是本地静态文件服务器，用于在本机运行学生端、教师端和本地题包：

- 学生端网页从本地 `app/` 加载；
- 教师端网页从本地 `teacher/` 加载；
- `/api/packs` 扫描本地 `practice_packs/` 下的 manifest；
- `/packs/<SET_ID>/...` 从本地题包目录读取 JSON、MP3 和图片；
- 音频服务器支持 HTTP Range 请求，便于浏览器分段读取、拖动和定位播放。

**本地运行不等于完全离线。** 当前学生端的课堂 API 地址仍指向阿里云 Function Compute。开始正式题包练习时，仍会请求云端创建 Session，答题和分析记录也会同步到 Tablestore。此本地服务器没有提供独立的本地课堂数据库或离线同步队列。

## 2. 环境要求

- Python 3.10 或更新版本；
- 不需要为静态网页服务器额外安装 Flask；
- 若要执行题包校验并读取 MP3 精确时长，建议另外安装 FFmpeg（提供 `ffprobe`）。

## 3. macOS 启动

在仓库根目录执行：

```bash
python3 start_local.py
```

也可以运行：

```bash
bash start_mac.command
```

## 4. Windows 启动

在仓库根目录执行：

```powershell
py -3 start_local.py
```

或双击 `start_windows.bat`。

## 5. 访问地址

默认从 8000 端口开始寻找空闲端口，最多尝试 8000–8020。启动后终端会显示实际地址，例如：

- 学生端：`http://127.0.0.1:8000/`
- 教师端：`http://127.0.0.1:8000/teacher/`

若 8000 被占用，可指定端口：

```bash
python3 start_local.py --port 8100
```

不自动打开浏览器：

```bash
python3 start_local.py --no-browser
```

## 6. 新增或更新题包

将完整题包目录放进 `practice_packs/<SET_ID>/`，确保 manifest、pack、音频和 JSON 分片都齐全。

回到学生端套题选择页，点击重新扫描题包。服务器每次请求 `/api/packs` 时会重新扫描 manifest，因此一般不需要重启本地服务器。

## 7. 停止服务

在运行服务器的终端按 `Ctrl+C`。

## 8. 本地测试建议

1. 先确认套题列表能扫描出新 set；
2. 打开 M1 和 M2H，确认音频能播放、暂停、继续和拖动；
3. 进入分析阶段，测试 Play / From start；
4. 确认身份弹窗正常；
5. 如果测试正式课堂记录，使用 TEST 学生标识，并确认教师端能看到 Session；
6. 测试完成后不要误删已完成的真实课堂记录。

本地静态文件服务器只改变前端资源和题包的读取位置，不改变当前云端课堂数据路径。
