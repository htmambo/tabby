# Red Alert Deep 样板说明

## 目标

`Red Alert Deep` 是现有 `Red Alert` 终端配色方案的更深红衍生版本。
它同时也是一个开发样板：配色文件使用语义化 `#define` 命名，而本文档
则负责说明当前 Tabby 配色链路里，哪些字段会被真正消费。

## 对原始 `Red Alert` 的审计

原始文件 `tabby-community-color-schemes/schemes/Red Alert` 中包含：

- 实际写在文件里的键：
  - `foreground`
  - `background`
  - `cursorColor`
  - `color0` 到 `color15`
  - `colorBD`
- 仅作为注释占位的键：
  - `colorIT`
  - `colorUL`

本次改动前，它们在 Tabby 里的运行时效果是：

- `foreground`、`background`、`cursorColor` 和 `color0..15` 会生效。
- `colorBD` 虽然会被解析进通用键值表，但不会继续转发到
  `TerminalColorScheme`，因此没有运行时效果。
- 注释状态的 `colorIT` 和 `colorUL` 不会产生任何效果。

## 本次改动后，加载器的行为

社区配色加载器现在也会转发以下可选字段：

- `selection`
  - 作为 xterm 的选区背景色使用。
  - 在鼠标或键盘选择终端文本时可见。
- `selectionForeground`
  - 选中文本的可选前景色覆盖。
  - 当选区背景本身带有明显色偏时，这个字段尤其有用。
- `cursorAccent`
  - 块光标内部文本颜色。
  - 用来保证光标下字符仍然可读。

加载器仍然允许源文件里出现任意 `*.key: value` 键值对，但当前只有上面
这些字段，再加上 `foreground`、`background`、`cursorColor` 以及 ANSI
配色槽位，会被真正转发进运行时主题对象。

## 需要特别注意的遗留键与半支持键

- `colorBD`
  - 在导入的 Xresources 主题里很常见。
  - 历史上有些终端会拿它当 bold 文本颜色。
  - Tabby 当前的 xterm 主题接线不会消费它。
- `colorIT`
  - 某些生态里历史遗留的 italic 颜色键。
  - Tabby 当前的 xterm 主题接线不会消费它。
- `colorUL`
  - 某些生态里历史遗留的 underline 颜色键。
  - Tabby 当前的 xterm 主题接线不会消费它。
- `color16+`
  - 某些导入主题里会出现，例如 `Base16 Default Dark`。
  - 社区加载器会把它们保留在解析结果的 `colors` 数组中。
  - 但 `tabby-terminal/src/frontends/xtermFrontend.ts` 当前只会把前 16 个
    ANSI 槽位，也就是 `color0..color15`，映射到运行时主题，因此
    `color16+` 在渲染阶段实际上会被忽略。

## 为什么新主题使用语义化 `#define` 命名

原始 `Red Alert` 为每个槽位直接写十六进制字面量。这样虽然简短，但一旦
文件变复杂，设计意图就会迅速丢失，维护成本会上升。

`Red Alert Deep` 则按“颜色职责”分组：

- 画布类颜色
  - `fg_main`、`bg_terminal`、`cursor_fill`、`cursor_text`、
    `selection_bg`、`selection_fg`
- ANSI 基础色
  - `ansi_black` 到 `ansi_white`
- ANSI 高亮色
  - `ansi_bright_black` 到 `ansi_bright_white`

这样可以给后续主题作者一个稳定的命名模式：

1. 先命名语义角色。
2. 再在每个角色旁边写清视觉或行为用途。
3. 最后再把这些角色映射到 `*.foreground`、`*.background` 和 `*.colorN`。

## `Red Alert Deep` 变量用途映射

- `fg_main`
  - 默认终端文字，以及所有未主动请求 ANSI 槽位的文本。
- `bg_terminal`
  - 用户启用“使用配色方案背景”时的终端底色。
- `cursor_fill`
  - 可见光标本体颜色。
- `cursor_text`
  - 块光标内部的文字颜色。
- `selection_bg`
  - 选中文本的高亮底色。
- `selection_fg`
  - 选中文本的可选前景色覆盖。
- `ansi_black`
  - SGR 30，深色背景块、阴影文本。
- `ansi_red`
  - SGR 31，错误与危险输出。
- `ansi_green`
  - SGR 32，成功态、可执行文件、正向状态。
- `ansi_yellow`
  - SGR 33，警告态、中等强调高亮。
- `ansi_blue`
  - SGR 34，提示符元信息、链接、次级强调。
- `ansi_magenta`
  - SGR 35，提示符强调、diff、高亮插件信息。
- `ansi_cyan`
  - SGR 36，信息文本、符号链接标记、主机名。
- `ansi_white`
  - SGR 37，中性亮文本。
- `ansi_bright_black`
  - SGR 90，弱化文本、行号、低存在感边框。
- `ansi_bright_red`
  - SGR 91，更强的红色警示强调。
- `ansi_bright_green`
  - SGR 92，高强度成功强调。
- `ansi_bright_yellow`
  - SGR 93，高可见度警告强调。
- `ansi_bright_blue`
  - SGR 94，偏冷的对照强调色。
- `ansi_bright_magenta`
  - SGR 95，更强的洋红强调。
- `ansi_bright_cyan`
  - SGR 96，明亮信息强调。
- `ansi_bright_white`
  - SGR 97，最高级别强调前景色。

## 给后续主题开发的实践建议

- 背景色、块光标内文字色、选区颜色必须一起校验可读性。
- 不要假设 ANSI 槽位名必须严格对应字面色相。
  - 很多主题会故意把 “blue” 或 “magenta” 槽位做偏移，以服务整体氛围。
- 除非运行时链路明确扩展，否则应把 `colorBD`、`colorIT`、`colorUL`
  视为文档性字段，而不是可生效字段。
- 如果你要添加 `color16+`，可以保留并写明用途，但不要默认认为当前
  Tabby 的 xterm 渲染会使用它们。
