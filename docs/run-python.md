# 用所选环境运行 Python 或 R 命令

让智能体在所选环境的解释器上跑命令，装在这个环境里的包才导得进来。

需要：工作区已选好环境（见 [为当前工作区选择 micromamba 环境](./select-environment.md)）。

1. 在对话里说清要跑什么，例如："用这个环境跑 `scripts/rank.py`，把输出贴给我"。
2. 让智能体自己选路径。所选环境存在时，它会走 `micromamba_run`，不需要你点名工具。
   > 提示：你不需要记工具名，也不需要在话里带上环境路径；环境来自工作区的选择，不来自这句话。
3. 读返回报告的第一行 `exit code:`。
4. 读 `--- stdout ---` 段里的脚本输出。
5. 有报错时读 `--- stderr ---` 段里的 traceback。

**结果：** 报告以 `exit code: 0` 开头，`--- stdout ---` 下是脚本本该打印的内容；`import numpy` 这类语句用的是所选环境里的版本。

> 截图位：一段 `micromamba_run` 的工具结果，含 exit code、stdout 和 stderr 三个部分。alt：工具结果卡片，第一行 exit code: 0，下面是 stdout 段和一段 Python 脚本输出。

## 解释器是怎么映射的

| 你要求的命令 | 实际执行 |
| --- | --- |
| `python`、`python3`、`python3.11`、`python.exe` | `<所选环境>/bin/python`（Windows 为 `<环境>/python.exe`） |
| `Rscript` | `<所选环境>/bin/Rscript`（Windows 为 `<环境>/Scripts\Rscript.exe`） |
| 其他命令（`numpy` 之外的可执行文件、`bash` 等） | 原样执行，但 `PATH` 以环境的 `bin` 开头 |

同时注入的环境变量：`CONDA_PREFIX` 为环境路径、`CONDA_DEFAULT_ENV` 为环境名、`PYTHONNOUSERSITE=1`。

> 提示：`PYTHONNOUSERSITE=1` 意味着 `~/.local/lib` 里的用户级包不参与导入。报告里的解释器和 import 结果因此就是这个环境本身的样子，不会被你机器上别处的包污染。

## 三个容易踩的点

- Bash 里的 Python 会被拒绝。有选择、且 `enforcePythonTool` 为 `true`（默认）时，通过 Bash 提交 Python 命令会收到"Python execution through Bash is disabled…"的拒绝理由。这不是故障，是策略；照它说的改用 `micromamba_run` 即可。
- 工作目录是工作区根目录，不是当前打开的文件所在目录。脚本用相对路径时按工作区根来写。
- 沙箱照旧生效。`read-only` 会话里写文件会得到 `[sandbox: file access denied under read-only mode]`；这是会话策略，不是插件拦的。

> 提示：单条命令默认 30 秒超时，最长 120 秒。需要更久就在请求里说明，让智能体给 `timeout` 传更大的毫秒值。

## 相关文档

- [为当前工作区选择 micromamba 环境](./select-environment.md)
- [让智能体查询环境、软件包并执行命令](./agent-tools.md)
- [故障排除：Bash 里的 Python 被拒绝](./troubleshooting.md#bash-里的-python-被拒绝)
