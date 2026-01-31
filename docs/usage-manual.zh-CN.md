# Tabby 项目使用手册（源码与开发向）

> 本手册基于仓库内现有文档整理，聚焦源码构建、运行与插件开发流程，并附项目结构分析。

## 1. 项目概览

### 1.1 产品定位

Tabby 是跨平台终端模拟器与 SSH/串口客户端，面向 Windows、macOS 与 Linux。提供多标签、分屏、主题、快捷键以及内建 SSH、串口能力等功能。

### 1.2 技术栈

- Electron 桌面应用
- TypeScript + Angular 前端
- Webpack 打包构建

### 1.3 仓库结构总览

```
tabby
├─ app/                         Electron 宿主应用
├─ build/                       构建资源与中间产物
├─ scripts/                     构建、打包、i18n、发布脚本
├─ extras/                      OS 集成辅助（Automator/Clink/UAC.exe）
├─ locale/                      本地化资源（.po/.pot）
├─ patches/                     patch-package 补丁
├─ snap/                        Snapcraft 打包配置
├─ tabby-core/                  核心 UI 与标签管理插件
├─ tabby-terminal/              终端仿真核心插件
├─ tabby-settings/              设置页插件
├─ tabby-local/                 本地 Shell 插件
├─ tabby-ssh/                   SSH 插件
├─ tabby-serial/                串口插件
├─ tabby-telnet/                Telnet/Socket 插件
├─ tabby-electron/              Electron 平台绑定插件
├─ tabby-plugin-manager/        插件管理器
├─ tabby-linkifier/             链接识别插件
├─ tabby-community-color-schemes/  社区配色插件
├─ tabby-web/                   Web 平台绑定插件
├─ tabby-web-demo/              Web Demo
├─ tabby-uac/                   Windows UAC 辅助组件（C#）
└─ web/                         Web 容器相关依赖
```

### 1.4 内置插件模块一览

| 模块 | 作用 |
| --- | --- |
| tabby-core | 基础 UI、标签管理、配置、主题等核心能力 |
| tabby-terminal | 终端仿真核心 |
| tabby-settings | 设置页与偏好项 |
| tabby-local | 本地 Shell 与配置文件 |
| tabby-ssh | SSH 连接 |
| tabby-serial | 串口连接 |
| tabby-telnet | Telnet/Socket 连接 |
| tabby-electron | Electron 平台绑定 |
| tabby-plugin-manager | 插件安装与管理 |
| tabby-linkifier | URL/IP/路径可点击 |
| tabby-community-color-schemes | 社区配色 |
| tabby-web | Web 平台绑定 |
| tabby-auto-sudo-password | SSH 下自动填充 sudo 密码 |

## 2. 从源码构建与运行（开发模式）

### 2.1 环境准备（必需）

1. 安装 Node.js（版本 >= 15）。
2. 安装 Yarn。
3. Linux（Debian/Ubuntu）依赖示例：

```bash
sudo apt install libfontconfig-dev libsecret-1-dev libarchive-tools libnss3 \
  libatk1.0-0 libatk-bridge2.0-0 libgdk-pixbuf2.0-0 libgtk-3-0 libgbm1 cmake
```

### 2.2 获取代码

1. 克隆仓库到本地：

```bash
git clone <your-repo-url>
cd tabby
```

2. 如果是 fork 仓库，先同步上游 tag（避免安装依赖时缺少标签）：

```bash
git pull --tags upstream master
```

### 2.3 安装依赖

在仓库根目录执行：

```bash
yarn
```

### 2.4 构建项目

```bash
yarn run build
```

说明：该步骤会执行 typings 构建与各模块编译，具体流程由 `scripts/build-modules.mjs` 驱动。

### 2.5 启动开发模式

```bash
yarn start
```

### 2.6 常用开发命令

1. 监听模式（改动自动增量构建）：

```bash
yarn watch
```

2. 生产模式启动（使用已构建产物）：

```bash
yarn start:prod
```

3. 代码检查：

```bash
yarn lint
```

4. 生成文档：

```bash
yarn docs
```

## 3. 打包安装包（桌面发行版）

1. 完成正常构建：

```bash
yarn run build
```

2. 预打包插件：

```bash
node scripts/prepackage-plugins.mjs
```

3. 按目标平台构建安装包（择一）：

```bash
node scripts/build-windows.mjs
# 或
node scripts/build-linux.mjs
# 或
node scripts/build-macos.mjs
```

4. 产物输出在 `dist/` 目录。

## 4. 插件开发与加载

### 4.1 插件结构（示例）

```
tabby-pluginname
├─ src/
│  ├─ components/
│  ├─ services/
│  ├─ api.ts
│  └─ index.ts
├─ package.json
├─ tsconfig.json
└─ webpack.config.js
```

### 4.2 最小插件示例

```ts
import { NgModule } from '@angular/core'

@NgModule()
export default class MyModule {
  constructor () {
    console.log('Angular engaged, cap\\'n.')
  }
}
```

### 4.3 插件加载方式

1. 开发模式下会自动加载源码中的所有插件。
2. 也会加载用户插件目录（Tabby 中 `Settings > Plugins > Open Plugins Directory`）。
3. 支持 `TABBY_PLUGINS` 环境变量指定额外插件目录：

```bash
TABBY_PLUGINS=/path/to/plugin tabby --debug
```

### 4.4 发布与发现

1. 在插件 `package.json` 中加入 `tabby-plugin` 关键字。
2. 发布到 NPM 后可在插件管理器中被发现。

## 5. Web 相关子项目

### 5.1 tabby-web

1. 进入目录：

```bash
cd tabby-web
```

2. 安装依赖并构建：

```bash
yarn
yarn build
```

3. 需要开发调试时使用：

```bash
yarn watch
```

### 5.2 tabby-web-demo

1. 进入目录：

```bash
cd tabby-web-demo
```

2. 安装依赖并构建：

```bash
yarn
yarn build
```

### 5.3 web 容器

`web/` 主要承载浏览器端 polyfill 依赖，通常无需单独执行构建命令，保持依赖安装即可。

## 6. 常见问题与排查建议

1. 依赖安装失败：确认 Node.js 版本 >= 15，并确保 Yarn 可用。
2. Linux 启动失败：优先检查系统依赖是否完整安装。
3. 插件未生效：检查插件 `package.json` 是否包含 `tabby-plugin` 关键字。
4. fork 仓库安装异常：先同步上游 tag 后再执行 `yarn`。
