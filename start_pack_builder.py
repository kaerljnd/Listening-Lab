#!/usr/bin/env python3
from pathlib import Path
import runpy

try:
    import webrtcvad  # noqa: F401
except ModuleNotFoundError:
    print("提示：未安装 WebRTC VAD，将使用 FFmpeg fallback。")
    print("建议运行：python3 -m pip install -r tools/pack_builder/requirements-vad.txt")
p=Path(__file__).resolve().parent/'tools'/'pack_builder'/'pack_builder_web.py'
runpy.run_path(str(p),run_name='__main__')
