# 配置 micromamba 路径、根前缀与其他选项

默认值在多数机器上开箱可用。只有找不到 micromamba、环境列表不对、或要调超时与上限时，才需要动配置。

需要：能编辑 `~/.dsh/profiles/desktop/cordis.patch.yml`。

1. 用编辑器打开 `~/.dsh/profiles/desktop/cordis.patch.yml`。
2. 在文件末尾追加一段：
   ```yaml
   - id: micromamba-env
     name: dsh-micromamba-env
     config:
       rootPrefix: /Users/you/.local/share/mamba
   ```
3. 只保留你要改的字段，其余删掉走默认值。
   > 提示：文件里已有同 id 的 `micromamba-env` 段时，改那一段的 `config`，不要加第二段——两段同 id 会让最终值取决于合并顺序。
4. 保存文件。
5. 重启 DeepSeek Harness（先完全退出，再打开）。
   > 提示：配置只在插件加载时读一次，改完必须重启；刷新按钮不会重读配置。
6. 点侧边栏 **Micromamba**，读标题下的 `micromamba <版本>` 是否为预期的那一份。
7. 让智能体跑 `micromamba_info`，核对 `Root prefix:` 与 `Environment directories:`。
   > 提示：这类需要重启才生效的改动，用 `micromamba_info` 验证比看面板快——它直接报二进制路径和根前缀。

**结果：** 面板标题下的版本号来自你指定的二进制；环境列表按新的根前缀重新判定，**外部** 标签随之变化；`micromamba_info` 的 `Root prefix:` 与配置一致。

## 字段一览

| 字段 | 默认值 | 取值范围 | 作用 |
| --- | --- | --- | --- |
| `micromambaPath` | `""` | 任意路径 | `micromamba` 可执行文件的绝对路径。空值按下面的顺序自动探测。 |
| `rootPrefix` | `""` | 任意路径 | 根前缀（等价于 `-r`）。空值依次取 `$MAMBA_ROOT_PREFIX`、micromamba 自己的默认值。 |
| `extraEnvPaths` | `[]` | 字符串数组 | 补进列表的环境路径，用于 `micromamba env list` 漏掉的环境。 |
| `maxDetailEnvs` | `25` | 1–200 | 列表里前几个环境会统计包数与解释器版本。 |
| `maxPackages` | `20000` | 1–50000 | 一次包查询最多返回多少条。 |
| `timeoutMs` | `30000` | 1000–120000 | 每次 `micromamba` 读取命令的超时。注意它管的是读取，不是 `micromamba_run`。 |
| `enforcePythonTool` | `true` | `true` / `false` | 有选择时是否拒绝 Bash 里的 Python 命令。 |
| `cacheTtlMs` | `30000` | 0–3600000 | 环境列表缓存多久。**刷新** 会绕过它。 |

## `micromambaPath` 的自动探测顺序

空值时依次检查，命中即用：

1. 环境变量 `$MICROMAMBA`
2. 环境变量 `$MAMBA_EXE`
3. `~/bin/micromamba`
4. `~/.local/bin/micromamba`
5. `/opt/homebrew/bin/micromamba`
6. `/usr/local/bin/micromamba`
7. `PATH` 里的 `micromamba`

> 提示：第 7 步只是把名字交出去，实际能否找到取决于应用进程的 `PATH`。图形界面应用常拿不到你 shell 里的 `PATH`，这正是"终端里明明能用、面板里却报错"的常见原因——直接填绝对路径最省事。

## 什么时候该改哪一项

| 症状 | 改这个 |
| --- | --- |
| 面板报 `micromamba: command not found` 或 `micromamba is not available` | `micromambaPath` |
| 面板只有 **未找到环境。**，但终端 `micromamba env list` 有环境 | `rootPrefix` |
| 某些环境在终端看得到、面板里没有 | `extraEnvPaths` |
| 环境多，只有前 25 个有包数 | `maxDetailEnvs` |
| 大环境的包列表被截断 | `maxPackages` |
| 读取经常超时（环境很大、磁盘慢） | `timeoutMs` |
| 刚装的包在面板里看不到 | 等一个 `cacheTtlMs`，或点 **刷新** |
| 想让智能体照旧用 Bash 跑 Python | `enforcePythonTool: false` |

## 相关文档

- [安装并在侧边栏打开 Micromamba 面板](./install.md)
- [理解"默认""当前""外部"三个标签与只读边界](./concepts.md)
- [故障排除](./troubleshooting.md)
