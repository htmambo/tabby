# Tabby 使用说明：分屏、标签与 SFTP

本页覆盖终端组织方式（标签/分屏）与 SSH 集成 SFTP 文件管理。

- 返回索引：[INDEX.zh-CN.md](./INDEX.zh-CN.md)

---

## 6. 分屏、标签与焦点控制

### 6.1 分屏能力

- 横向/纵向拆分
- 拖动分隔条调整比例
- 一键均分（equalize）
- 最大化当前 pane / 还原

### 6.2 Pane 导航与操作

- 方向导航（上/下/左/右）
- 线性导航（上一个/下一个）
- 指定 pane 序号（1~9）
- 关闭当前 pane
- 调整 pane 大小步长（可配置）

### 6.3 多播输入（Broadcast）

- Focus all panes：同一 split 内多 pane 同时接收输入
- Focus all tabs：多标签同时接收输入

### 6.4 标签级高级操作

- Duplicate
- Close other tabs / left / right
- Switch profile（在 split 子 pane 中切换 Profile）
- Save as profile（把当前标签状态落成新 Profile）
- Save layout as profile（split 标签可用）

---

## 7. SFTP（SSH 集成文件管理）

SFTP 有两种打开方式：
- 在 SSH 标签中打开内嵌 SFTP 面板
- 打开独立 SFTP 标签页

## 7.1 面板结构

- 桌面版：双栏
  - 左：本地文件
  - 右：远程 SFTP
- 浏览器环境：通常只可用远程侧（本地目录枚举能力受限）

## 7.2 远程侧功能

- 面包屑导航、路径手动编辑
- 过滤（Filter）
- 多选（Ctrl/Cmd/Shift）
- 全选/清空选择
- 下载选中项
- 创建目录
- 上传文件
- 上传文件夹
- 右键菜单（含插件扩展项）
  - Download / Download directory
  - Delete
  - Refresh current directory
  - Copy full path（桌面扩展）
  - Edit locally（桌面扩展，自动监听本地修改回传）

## 7.3 本地侧功能（桌面版）

- 目录浏览与面包屑导航
- 双击目录进入
- 双击文件用系统默认程序打开
- 多选后批量上传
- 右键菜单：Upload / Open directory / Refresh / Copy full path

## 7.4 批量与交互细节

- 支持拖拽目录上传（drop zone）
- `Ctrl/Cmd + A`：在当前激活 pane 执行全选
- 目录下载会递归计算大小并显示进度
- 下载默认写入“本地当前目录”（双栏模式下）

---

