# Tabby 使用说明：插件与文件传输

本页覆盖插件系统与 Transfers 文件传输中心。

- 返回索引：[INDEX.zh-CN.md](./INDEX.zh-CN.md)

---

## 11. 插件系统

## 11.1 插件来源与安装

- 插件管理器从 NPM 检索（`tabby-` / `terminus-` 生态）
- 支持安装、升级、卸载
- 支持按插件启用/禁用（通过 `pluginBlacklist`）

## 11.2 插件目录

可在插件设置页直接打开本地插件目录。

## 11.3 常见内置扩展模块（本仓库）

- `tabby-linkifier`：终端内 URL/IP/文件路径点击
- `tabby-community-color-schemes`：额外配色方案
- `tabby-auto-sudo-password`：检测 sudo 提示后可一键回填已保存密码

---

## 12. 文件传输中心（Transfers）

所有上传/下载任务都会进入顶部 Transfers 菜单：
- 显示任务名、状态、进度、速度
- 点击任务可定位到文件（桌面版）
- 可单个取消/移除
- 可一键清空，若有活动任务会先确认是否中止

---

