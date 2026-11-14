# 常见问题

短答优先。需要动手的，答案里直接给那篇文档的名字。

## 插件会改动我的 micromamba 环境吗？

不会。读取只有 `env list`、`info`、`list` 三条 JSON 查询；唯一的写入是工作区里的 `<工作区>/.context/micromamba-environment.json`。详见 [三个标签与只读边界](./concepts.md)。

## 能在面板里装包、删包、升级包吗？

不能，面板是只读的。装包请在终端里用 `micromamba install`。

## 一个工作区能选几个环境？

一个。想换就重新选；想留空就在菜单里点 **未选择**。

## 选择会跟着 git 提交吗？

会。选择文件在 `.context/` 目录下，没被忽略就会进版本库。不想共享就把它加进 `.gitignore`。

## 为什么 **默认** 和我在终端里 activate 的不是同一个？

**默认** 来自 Harness 进程里 micromamba 的 `env location`，不是任何终端的激活状态。终端里的激活是那个 shell 私有的，插件看不到。

## 为什么某个环境的包数显示 `—`？

它排在 `maxDetailEnvs`（默认 25）之后；或者它的 `micromamba list` 失败了（此时会带红字 **读取失败：…**）。

## 能看到 pip 装进这个环境的包吗？

基本看不到。列表来自 `micromamba list`，读的是 conda/mamba 的安装记录；pip 直接装进 site-packages 的包通常不在记录里。

## 支持 Windows 和 Linux 吗？

三套路径都有处理：Windows 用 `<环境>/python.exe`、`Scripts`、`Library/bin`，macOS 与 Linux 用 `bin/python`、`bin/Rscript`。实际验证主要在 macOS 上做，其他平台遇到问题按 [故障排除](./troubleshooting.md) 归类反馈。

## base 环境能选吗？

能。它在列表里环境名就是 `base`，选它和选别的环境没有区别。

## 插件会拖慢应用启动吗？

影响很小：只有前 25 个环境会跑 `micromamba list` 统计包数，列表本身缓存 30 秒，包列表是展开时才取。

## 为什么工具返回的标签是英文 `default`，面板里却是 **默认**？

工具输出是给模型读的稳定纯文本，不跟界面语言走；面板文案才做本地化。含义完全对应。

## 为什么面板顶部没有 **工作区** 和 **环境** 两栏？

没有打开的会话时，这两栏不显示。打开一个会话就会回来。

## 和 conda 能共存吗？

能。插件只调用 `micromamba`，不碰 `conda`。两个工具各自的环境目录互不干扰。

## 怎么卸载？

1. 从 `~/.dsh/profiles/desktop/package.json` 的 `dsh.profile.bundles` 删掉 `"dsh-micromamba-env"`。
2. 删掉 `~/.dsh/profiles/desktop/node_modules/dsh-micromamba-env` 这个链接。
3. 重启应用。
4. 可选：删掉各工作区里的 `.context/micromamba-environment.json`。

> 提示：卸载不会动你的 micromamba 环境，也不会动已经装好的包。

## 相关文档

- [理解"默认""当前""外部"三个标签与只读边界](./concepts.md)
- [故障排除](./troubleshooting.md)
- [安装并在侧边栏打开 Micromamba 面板](./install.md)
