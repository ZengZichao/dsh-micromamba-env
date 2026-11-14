# 安装并在侧边栏打开 Micromamba 面板

装好一次，之后每次启动 DeepSeek Harness 都能在侧边栏看到本机的 micromamba 环境。

需要：本机能运行 `micromamba`；对 `~/.dsh/profiles/desktop` 有写权限。

1. 在终端运行 `micromamba --version`，记下版本号。
2. 运行 `which micromamba`，记下输出里的绝对路径。
   > 提示：这一步拿到的路径，在 [配置](./configure.md) 里可以直接填进 `micromambaPath`。命令不存在就先装 micromamba。
3. 在终端进入插件目录。
   ```sh
   cd /path/to/dsh-micromamba-env
   ```
4. 把插件链接进 desktop profile 的依赖目录。
   ```sh
   ln -sfn "$PWD" ~/.dsh/profiles/desktop/node_modules/dsh-micromamba-env
   ```
5. 用编辑器打开 `~/.dsh/profiles/desktop/package.json`。
6. 在 `dsh.profile.bundles` 数组里加一行 `"dsh-micromamba-env"`，放在数组末尾，并在前一行补一个逗号。
   > 提示：只做第 4 步的链接、不加这一行，应用不会加载插件，侧边栏也不会出现入口。这是最常见的"装了但没反应"。
7. 保存文件。
8. 重启 DeepSeek Harness（先完全退出，再打开；只关窗口不算）。
9. 点击侧边栏的 **Micromamba**。
   > 截图位：侧边栏里的 **Micromamba** 入口，以及点开后整块面板。alt：侧边栏里的 Micromamba 入口和它打开的环境面板。

**结果：** 面板标题显示 **Micromamba 环境**，标题下方一行小字是 `micromamba <版本号>`，再往下列出环境行；面板顶部还可能出现 **工作区** 与 **环境** 两栏。

> 提示：想确认装得对不对，在插件目录运行 `npm run check:runtime`。正常时最后一行是 `manifest and runtime checks passed`，并会写明 `dsh-micromamba-env in .../profiles/desktop links to this checkout`。

## 相关文档

- [查看本机的 micromamba 环境](./view-environments.md)
- [配置 micromamba 路径、根前缀与其他选项](./configure.md)
- [故障排除：侧边栏没有 Micromamba](./troubleshooting.md#侧边栏没有-micromamba)
