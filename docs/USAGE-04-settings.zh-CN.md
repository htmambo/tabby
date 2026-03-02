# Tabby 使用说明：设置系统（Settings）

本页详细说明 Settings 各子项及关键行为。

- 返回索引：[INDEX.zh-CN.md](./INDEX.zh-CN.md)

---

## 8. 设置（Settings）全量说明

Settings 由多个模块动态组成，以下为常见完整集合。

## 8.1 Application

- 检查更新 / 执行更新
- 反馈问题、社区、GitHub、发布说明
- Language
- Shell integration（支持平台）
- Enable analytics
- Automatic updates
- Open DevTools
- Accessibility：
  - 启用动画
  - 最小对比度

## 8.2 Window

- Theme
- Spaciness
- Web：关闭浏览器标签前确认
- Vibrancy / Acrylic（平台相关）
- 背景类型（Blur / Fluent，Windows 条件可见）
- Opacity
- Window frame（Native / Thin / Full）
- Hide tray icon（非 Linux Web）
- Docking（停靠）
  - 位置（Top/Left/Right/Bottom/Off）
  - 显示器选择
  - Always on top
  - 尺寸与占比
  - 失焦隐藏
- Tabs
  - 位置（Top/Bottom/Left/Right）
  - 宽度策略（Dynamic/Fixed）
  - 全屏时是否显示标签栏
  - 隐藏标签索引
  - 标签显示 Profile 图标
  - 隐藏关闭按钮
  - 关闭最后一个标签时关闭窗口
- Panes
  - Pane resize step
  - Focus follows mouse（需重启）
- Hacks
  - 禁用 GPU 加速（需重启）
  - Fluent 背景实验项（Windows）

## 8.3 Terminal

- Rendering：frontend、scrollback、粗体亮色、sixel
- Keyboard：Alt 作为 Meta、输入时自动滚动
- Mouse：右键策略、中键粘贴、词分隔符、点击链接修饰键
- Clipboard：
  - 选中即复制
  - 保留格式复制
  - bracketed paste
  - 多行粘贴警告
  - 粘贴前后裁剪空白
- Sound：bell off/visual/audible
- Startup：
  - 启动自动打开终端
  - 启动恢复标签
- Windows：Set Tabby as `%COMSPEC%`

## 8.4 Appearance

- 字体族 + 字号
- ligatures
- 正常/粗体字重
- 终端背景来源（theme / color scheme）
- 光标形状与闪烁
- 最小对比度
- fallback 字体
- 行间距
- 自定义 CSS

## 8.5 Color scheme

- 颜色模式切换：
  - Follow system
  - Always dark
  - Always light
- 深色与浅色模式可分别选方案
- 可编辑并保存自定义方案（含 16 ANSI 色）

## 8.6 Profiles & connections

见第 4、5 节。

## 8.7 Shell（Windows）

- ConPTY 开关
- WSL + ConPTY 提示

## 8.8 SSH

见第 5.2 节“SSH 全局设置”。

## 8.9 Hotkeys

- 支持搜索
- 支持多段快捷键
- 重复绑定会被检测标记
- 可配置范围包括：
  - 全局标签/窗口行为
  - 终端编辑/导航
  - SSH/Telnet/Serial 专用动作
  - Settings 打开与直达设置页
  - 每个 Profile/Provider/Group 的选择器热键

## 8.10 Plugins

- Available：从 NPM 搜索并安装
- Installed：升级、启用/禁用、卸载
- 打开插件目录
- 注意：安装/卸载/启停通常需要重启应用

## 8.11 Vault

见第 9 节。

## 8.12 Config sync

见第 10 节。

## 8.13 Config file

- 内置 YAML 编辑器
- 语法校验（invalid syntax 会阻止保存）
- Show defaults 查看默认配置
- Show config file 打开文件所在目录（桌面版）

---

