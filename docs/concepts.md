# 理解"默认""当前""外部"三个标签与只读边界

三个标签回答三个不同的问题。混着读，会把"micromamba 认为的默认"当成"我在终端里 activate 的那个"，于是怀疑插件读错了。

## **默认**：micromamba 在这个进程里的默认环境

来自 `micromamba info --json` 的 `env location`。它指的是 Harness 后端进程启动时 micromamba 解析出的默认环境，通常是根前缀下的 `base`。

它不是你在某个终端里 `micromamba activate` 的结果。终端里的激活状态是那个 shell 的，插件看不到，也不该假装看得到。

## **当前**：这个工作区自己选的环境

来自 `<工作区>/.context/micromamba-environment.json` 里的 `environment.path`。每个工作区一份，切工作区就换一份。

一个环境可以同时是 **默认** 又是 **当前**（比如你把 base 选给了这个工作区）；也可以只是 **当前**。两个标签互不推导。

## **外部**：不在根前缀之下的环境

判定方式：环境路径不在 `rootPrefix` 目录内，也不是 `rootPrefix` 本身。典型例子是项目自带的 `~/projects/xxx/envs/lab`，或你从别处拷来的环境目录。

改 `rootPrefix` 会让这个标签整体重算——同一批环境可能从"外部"变成"内部"。见 [配置](./configure.md)。

## 只读到什么程度

插件对环境的全部读取只有三条命令：

```
micromamba env list --json
micromamba info --json
micromamba list -p <环境路径> --json
```

它不安装、不删除、不更新、不改写任何包。唯一的写入是工作区里那份选择文件：

```
<工作区>/.context/micromamba-environment.json
```

选择文件里的 `workspace` 字段会被校验：目录被移动或复制后，旧文件里的选择不会被当成本工作区的选择，而是当作"未选择"。

## 执行策略的边界在哪

当工作区有选择、且 `enforcePythonTool` 为 `true`（默认）时，通过 Bash 提交的 Python 命令会被拒绝，并给出改用 `micromamba_run` 的理由。

这条检测是启发式的：它读的是工具调用的命令文本，会剥掉 `sudo`、`env`、`xargs`、`nohup`、`nice`、`timeout`、`strace` 这类外壳，也会进 `bash -c "…"` 里看，认 `python`、`pip`、`pytest`、`ipython`、`pypy` 和 `uv|conda|micromamba|mamba run python`。它的用途是把模型引到正确的路径，不是安全边界——总能构造出它看不出来的写法。

真正的边界是 `micromamba_run` 自己：它和 Bash 走同一个带沙箱的 shell 执行器，并把当前会话的 `sandboxPolicy` 传下去，所以在 `read-only`、`workspace-write` 会话里，它受的约束和 Bash 一模一样。

## 缓存与"为什么刚装完的包不出现"

环境列表缓存 `cacheTtlMs`（默认 30 秒）。点 **刷新** 会绕过缓存，并清掉已展开的包列表缓存。包列表本身是展开时单独取一次，不随列表缓存走。

## 相关文档

- [查看本机的 micromamba 环境](./view-environments.md)
- [配置 micromamba 路径、根前缀与其他选项](./configure.md)
- [故障排除](./troubleshooting.md)
