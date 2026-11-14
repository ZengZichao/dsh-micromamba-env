# 排查故障：面板报错、入口消失、选择不生效

按你看到的原文找对应小节。每条先给原因，再给动作；动作做完还不行，会有下一步指向。

## 侧边栏没有 Micromamba

原因按概率排：插件没进 `dsh.profile.bundles`、装完没重启、链接断了、运行时版本低于 0.2.0。

1. 打开 `~/.dsh/profiles/desktop/package.json`，确认 `dsh.profile.bundles` 里有 `"dsh-micromamba-env"`。
2. 终端运行 `ls -l ~/.dsh/profiles/desktop/node_modules/dsh-micromamba-env`，确认它是指向插件目录的符号链接。
3. 完全退出应用再打开——只关窗口不算重启。
4. 在插件目录运行 `npm run check:runtime`，看有没有 `FAIL` 行。
5. 仍然没有入口时，打开应用日志，搜 `dsh-micromamba-env`，看加载时抛了什么。

> 提示：第 1 步缺失是最常见的原因。链接只是让 Node 能解析到包，`bundles` 才决定 Loader 是否挂载这一行。

## 面板显示 **读取失败：…**

后面跟的是系统原文，常见 `spawn micromamba ENOENT`、`command not found`、`No such file or directory`——都指向同一个事实：进程找不到 `micromamba`。

1. 终端运行 `which micromamba`，复制输出的绝对路径。
2. 按 [配置](./configure.md) 把该路径写进 `micromambaPath`。
3. 重启应用。
4. 再让智能体跑 `micromamba_info`，确认 `Binary:` 是这个路径。

> 提示：图形界面应用通常不继承你 shell 的 `PATH`，终端里能用不代表面板里能用。填绝对路径最省事。

## 面板只有 **未找到环境。**

`micromamba env list --json` 跑通了，但返回的 `envs` 是空的。多半是根前缀不对：应用拿不到你 shell 里的 `MAMBA_ROOT_PREFIX`。

1. 终端运行 `micromamba env list`，确认环境确实存在。
2. 终端运行 `echo $MAMBA_ROOT_PREFIX`，把这个值记下来。
3. 按 [配置](./configure.md) 把 `rootPrefix` 写成这个绝对路径。
4. 重启应用，再点 **Micromamba**。

> 提示：环境不在根前缀下（例如项目自带的 `envs/` 目录）时，`micromamba env list` 本来就不会列它。用 `extraEnvPaths` 补进去，标签会显示 **外部**。

## 某个环境的包数是破折号或读取失败

两种情况，先分清：

- 只有 `—`，没有红字：这个环境排在 `maxDetailEnvs`（默认 25）之后，插件没为它统计。把 `maxDetailEnvs` 调大即可。
- `—` 加红字 **读取失败：…**：对这个环境的 `micromamba list -p <路径> --json` 失败了。

1. 终端运行 `micromamba list -p <该环境路径>`，复现同样的错误。
2. 报环境损坏、缺 `conda-meta` 之类时，先用 micromamba 修好这个环境——插件只读，改不了它。
3. 报超时或卡住时，把 `timeoutMs` 调大，重启应用。

> 提示：整块面板的报错和一个环境行的报错不是一回事。前者说明列表没读出来，后者只说明那一个环境的摘要读失败。

## 选择器显示读取失败

选择器按钮上的文字变成 **读取失败**，或菜单顶部出现红字。

1. 确认这个工作区是通过应用打开的目录，且路径没被移动、改名。
2. 终端运行 `ls -la <工作区>/.context`，确认目录可写——写入失败同样会显示这个状态。
3. 重启应用，让 Host 的路由重新挂载。
4. 仍失败时，把工作区路径和报错原文一起记下来，对照应用日志里 `/dsh-micromamba-env/selection` 的响应。

> 提示：选择器把保存做成"先显示、再落盘"。落盘失败时按钮会退回 **读取失败**，所以你看到它，通常说明文件没写成功，而不是菜单没读到环境。

## Bash 里的 Python 被拒绝

原文大意："Python execution through Bash is disabled while this workspace has a micromamba environment selected. Retry with micromamba_run so the selected interpreter is enforced."

这是策略生效，不是故障。两条出路：

1. 照理由说的改用 `micromamba_run`（见 [用所选环境运行 Python 或 R 命令](./run-python.md)）。
2. 或者在工作区选择器里点 **未选择**，清除选择后 Bash 恢复。

> 提示：不想保留这条策略时，把 `enforcePythonTool` 设为 `false` 并重启。但那样就等于放弃"用所选解释器"的保证。

## 选好了环境，Python 还是走 Bash

1. 打开 `<工作区>/.context/micromamba-environment.json`，确认 `environment.path` 就是你要的那个环境。
2. 确认 `enforcePythonTool` 没有被改成 `false`。
3. 确认当前会话的工作区根目录就是这份选择文件所在的目录。
   > 提示：在子目录里新开一个会话，那是一个新工作区，会有自己的一份选择文件。目录不同，选择就不共享。

## `No micromamba environment is selected for this workspace`

`micromamba_run` 拿不到选择。三种可能：从没选过、选择被清除、选择文件里的 `workspace` 与当前目录不符（目录被移动或复制过）。

1. 用选择器重新选一次。
2. 再跑一次命令。

## 命令超时 `timed out after N ms`

`micromamba_run` 的默认超时是 30 秒，上限 120 秒。它和配置里的 `timeoutMs` 不是同一个开关——后者管的是插件的读取命令。

1. 把任务拆小，先跑一段能快速返回的。
2. 需要更久时，在请求里说明，让智能体给 `timeout` 传更大的毫秒值（不超过 120000）。

## `[sandbox: file access denied under … mode]`

会话的沙箱策略不允许这次写操作。插件只是把策略原样传给了执行器。

1. 改写到工作区目录内的路径。
2. 或者换一个允许写入的会话模式再跑。

> 提示：看到 `[sandbox: the sandbox runner itself failed; the command did not run]` 时，命令根本没执行，问题在执行器而不在插件；重启应用后重试。

## 筛选后只有 **没有匹配项。**

筛选只比对包名和版本，不比对 channel 和 build。

1. 换一个包名或版本片段再试。
2. 想按 channel 找，就让智能体用 `micromamba_list_packages`，它返回的第四列就是 channel。

## 点了 **刷新**，列表还是旧的

1. 确认点的是标题行右侧的图标按钮（悬停提示 **刷新**），不是重新切面板。
2. 等几秒：刷新会重新跑一次 `micromamba env list`，环境多时要遍历前 25 个环境。
3. 依旧不变时，在终端跑 `micromamba env list` 对比——很可能是环境本身没变。

## `npm run check:runtime` 报 FAIL

- `installed runtime … is older than the declared floor`：应用版本低于插件声明的 `>=0.2.0`，升级应用。
- `dsh-micromamba-env in … links to …, not to this checkout`：profile 里的链接指到别的副本，按 [安装](./install.md) 第 4 步重新链接。
- `package.json is missing dsh.client` / `exports["./client"] …`：仓库文件被改动过，用 `git status` 看改动再恢复。

## 相关文档

- [安装并在侧边栏打开 Micromamba 面板](./install.md)
- [配置 micromamba 路径、根前缀与其他选项](./configure.md)
- [常见问题](./faq.md)
