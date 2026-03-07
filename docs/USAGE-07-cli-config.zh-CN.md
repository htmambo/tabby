# Tabby 使用说明：命令行、URL 与配置文件

本页覆盖 CLI 参数、tabby:// URL 入口、配置文件位置与编辑建议。

- 返回索引：[INDEX.zh-CN.md](./INDEX.zh-CN.md)

---

## 13. 命令行与 URL Scheme

Tabby 支持命令行与 `tabby://` 协议入口。

## 13.1 命令行参数

全局参数：
- `-d, --debug`：启动时打开 DevTools
- `--hidden`：最小化/隐藏启动

命令：

| 命令 | 说明 |
|---|---|
| `tabby open [directory]` | 在目录中打开 shell |
| `tabby run [command...]` | 在终端运行命令 |
| `tabby /k [command...]` | `run` 的别名 |
| `tabby profile [profileName]` | 按 Profile 名称打开 |
| `tabby recent [index]` | 打开最近 Profile（索引） |
| `tabby quickConnect <providerId> <query>` | 快速连接（如 `ssh` / `telnet`） |
| `tabby paste [text]` | 向活动终端注入文本 |
| `tabby paste -e [text]` | 注入前做 shell escaping |

说明：
- `quickConnect` 的 `providerId` 取决于提供器（当前常见 `ssh`、`telnet`）。
- `profileName` 是 Profile 显示名称，需与配置一致。

## 13.2 `tabby://` URL

- 桌面版注册 `tabby://` 协议
- URL 会映射为同名 CLI 命令

示例：

```text
tabby://open?directory=/home/user/project
tabby://profile?profileName=Prod-SSH
tabby://quickConnect?providerId=ssh&query=admin%4010.0.0.8%3A22
```

---

## 14. 配置文件与存储位置

## 14.1 配置文件定位

桌面版配置文件固定文件名为：

```text
config.yaml
```

实际目录由 `TABBY_CONFIG_DIRECTORY` 决定；默认是 Electron 的 `userData` 目录。

最可靠的查看方式：
- Settings -> Config file -> `Show config file`

每次保存还会生成备份：

```text
config.yaml.backup
```

## 14.2 便携模式（Portable）

当 `Tabby.exe` 同级存在 `data` 目录时，用户数据目录会重定向到该目录，即配置文件位于：

```text
<Tabby 可执行文件目录>/data/config.yaml
```

## 14.3 远程同步服务配置

远程同步服务通过其后端接口加载/保存配置，不使用本地桌面文件路径。

## 14.4 YAML 直接编辑建议

- 修改前先备份
- 先用 Settings 页的语法校验
- 小步修改，随改随验证
- 对于多机同步场景，优先在“单机验证后再覆盖全局”

---

