# Third-Party Notices

本项目的安装包包含或依赖以下第三方组件。各组件的许可证以其上游发布为准。

## 随安装包分发的模型

### BAAI/bge-small-zh-v1.5

- 来源：<https://huggingface.co/BAAI/bge-small-zh-v1.5>
- 本包内镜像来源：ModelScope `Qdrant/bge-small-zh-v1.5`
- 用途：本地文本向量化（512 维），不用于对话生成
- 许可证：MIT
- 说明：安装包内含 `resources/models/bge-small-zh-v1.5/`（ONNX 模型、tokenizer、config 等）

```text
MIT License

Copyright (c) Beijing Academy of Artificial Intelligence (BAAI)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## 运行时与主要依赖

| 组件 | 许可证 | 项目地址 |
| --- | --- | --- |
| Electron | MIT | <https://github.com/electron/electron> |
| Chromium | BSD-3-Clause 等 | <https://www.chromium.org/> |
| React / React DOM | MIT | <https://github.com/facebook/react> |
| React Router | MIT | <https://github.com/remix-run/react-router> |
| Vite | MIT | <https://github.com/vitejs/vite> |
| Python | PSF License | <https://www.python.org/> |
| FastAPI | MIT | <https://github.com/fastapi/fastapi> |
| Uvicorn | BSD-3-Clause | <https://github.com/encode/uvicorn> |
| SQLAlchemy | MIT | <https://github.com/sqlalchemy/sqlalchemy> |
| Alembic | MIT | <https://github.com/sqlalchemy/alembic> |
| APScheduler | MIT | <https://github.com/agronholm/apscheduler> |
| ChromaDB | Apache-2.0 | <https://github.com/chroma-core/chroma> |
| ONNX Runtime | MIT | <https://github.com/microsoft/onnxruntime> |
| fastembed | Apache-2.0 | <https://github.com/qdrant/fastembed> |
| httpx | BSD-3-Clause | <https://github.com/encode/httpx> |
| py-keyring | MIT | <https://github.com/jaraco/keyring> |
| PyInstaller | GPL-2.0-or-later with bootloader exception | <https://github.com/pyinstaller/pyinstaller> |

Electron 与 Chromium 的完整许可证文本随安装包内的 `LICENSE.electron.txt` 和 `LICENSES.chromium.html` 提供。其余依赖的完整许可证文本可在对应上游仓库或 Python/npm 包元数据中查阅。

## 服务与外部接口

- **DeepSeek API**：仅在用户配置 API Key 并显式开启外联后调用；受 DeepSeek 服务条款约束。本项目不随包分发任何 API Key。
- **ModelScope / Hugging Face**：仅用于构建期获取开源模型，运行时不再下载模型。

如发现遗漏或归属错误，请通过仓库 Issue 或 Security 渠道联系维护者。
