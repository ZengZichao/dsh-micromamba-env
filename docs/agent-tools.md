# 让智能体查询环境、软件包并执行命令

不点面板也能问：用自然语言提要求，智能体就会调对应的工具，把结果以纯文本贴回来。

需要：插件已安装（Host 半部随应用启动，与是否打开面板无关）。

1. 直接说要做的事，不必点名工具。例如："列一下本机的 micromamba 环境"。
   > 提示：只有 `micromamba_run` 需要先选环境；其余四个工具在没选环境时也照常可用。
2. 读返回文本的第一行，确认它读的是哪一份 micromamba。`micromamba_list_envs` 会写成 `micromamba <版本> — root: <根前缀> — platform: <平台>`。
3. 需要精确到某个环境时，把环境名或绝对路径写进要求，例如："看 `science` 里有没有 torch"。
4. 需要过滤包时补一句匹配条件，例如："只看版本里带 2.1 的"。
5. 想核对插件到底用了哪个二进制时，说："确认一下 micromamba 的安装位置和根前缀"。
6. 想在不点选择器的情况下换环境时，说："把这个工作区切到 `science`"。

**结果：** 每次返回一段纯文本报告，没有卡片和交互元素；内容与面板同源，读的是同一份缓存。

## 五个工具各管什么

| 你想做的事 | 工具 | 参数 |
| --- | --- | --- |
| 列出环境、标签、包数、解释器 | `micromamba_list_envs` | 无 |
| 查某个环境的包 | `micromamba_list_packages` | `env`：环境名或绝对路径（必填）；`search`：按包名或版本过滤（可选） |
| 确认二进制、版本、根前缀、平台、环境目录 | `micromamba_info` | 无 |
| 读或改当前工作区的选择 | `micromamba_workspace_environment` | `path`：省略＝读取；空字符串＝清除；绝对路径＝选中 |
| 在所选环境跑命令 | `micromamba_run` | `command`（必填）、`args`（字符串数组）、`timeout`（1000–120000 毫秒） |

### 输出长什么样

`micromamba_list_envs`：

```
micromamba 1.5.9 — root: /Users/you/micromamba — platform: osx-arm64
Environments (2):
- base (base, default): /Users/you/micromamba — 14 packages · Python 3.12.3
- science (external): /Users/you/projects/lab/envs/science — 412 packages · Python 3.11.9 · R 4.3.3
```

`micromamba_list_packages`：

```
Packages in /Users/you/micromamba/envs/science (412 total):
numpy	1.26.4	py311h...	conda-forge
```

四列制表符分隔：包名、版本、build、channel。被 `maxPackages` 截断时，首行会多出 `, showing first N`。

`micromamba_workspace_environment` 返回选择文件的 JSON（含 `workspace`、`environment`、`updatedAt`）。

> 提示：工具输出里的标签是英文 `base` / `default` / `external`，面板里是中文 **默认** / **当前** / **外部**。同一个含义的两种写法，不必对照猜测。

> 提示：`env` 写错名字不会静默失败——`micromamba list` 会报出它自己的错误。名字拼错时，先用 `micromamba_list_envs` 把准确名字抄回来。

## 相关文档

- [查看某个环境里装了哪些软件包](./browse-packages.md)
- [用所选环境运行 Python 或 R 命令](./run-python.md)
- [理解"默认""当前""外部"三个标签与只读边界](./concepts.md)
