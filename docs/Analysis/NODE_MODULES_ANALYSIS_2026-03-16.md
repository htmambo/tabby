# node_modules 依赖分析报告

**生成时间**: 2026-03-16

---

## 1. 磁盘占用统计

| 插件 | node_modules 大小 |
|------|------------------|
| tabby-ai-assistant | 621MB |
| tabby-core | 402MB |
| tabby-terminal | 389MB |
| tabby-electron | 153MB |
| tabby-settings | 111MB |
| tabby-plugin-manager | 54MB |
| tabby-serial | 22MB |
| tabby-community-color-schemes | 21MB |
| tabby-local | 19MB |
| tabby-telnet | 15MB |
| tabby-ssh | 15MB |
| tabby-linkifier | 9.5MB |
| tabby-auto-sudo-password | 8.9MB |
| **总计** | **~1.84GB** |

---

## 2. 重复依赖分析

### 核心包重复情况

| 包名 | 重复次数 | 说明 |
|------|---------|------|
| tslib | 3 | TypeScript 运行时助手 |
| rxjs | 0 | 已 hoist 到根目录 |
| zone.js | 0 | 已 hoist 到根目录 |
| @angular/* | 0 | 已 hoist 到根目录 |

### 总包数量
- 各插件 node_modules 中共有 **578** 个 package.json 文件
- 大部分核心依赖已通过 workspace 机制 hoist 到根目录

---

## 3. 主要重复来源

### 3.1 tabby-ai-assistant (621MB)
最大的 node_modules，主要因为：
- 独立的 AI/ML 相关依赖（zod, immutable 等）
- MCP (Model Context Protocol) 相关包
- 测试框架依赖（jest, @types/jest）

### 3.2 tabby-core (402MB)
核心插件，包含：
- Angular 框架依赖
- UI 组件库

### 3.3 tabby-terminal (389MB)
终端核心，包含：
- xterm.js 及其插件
- serialport 相关 native 模块

---

## 4. 优化建议

### 4.1 可立即执行（低风险）

1. **清理未使用的依赖**
   - 运行 `npm run deps:check` 检查未使用依赖
   - 运行 `npm run deps:audit` 审计安全问题

2. **统一版本管理**
   - 当前 package.json 已有完善的 `resolutions` 和 `overrides`
   - 建议继续使用此机制强制统一版本

### 4.2 需评估的优化（中风险）

1. **迁移到 pnpm**
   - pnpm 的硬链接机制可节省 50-70% 磁盘空间
   - 需要更新 CI/CD 流程
   - 需要验证与 electron-builder 的兼容性

2. **进一步 hoisting**
   - 分析各插件独立的依赖是否可以提升到根目录
   - 需要验证不引入版本冲突

### 4.3 不建议的操作

1. **不要删除任何 node_modules**
   - 各插件的 node_modules 是其独立依赖的必要组成部分
   - 删除会导致构建失败

---

## 5. 结论

当前项目的依赖管理已经比较规范：
- ✅ 使用 `resolutions` 和 `overrides` 统一关键依赖版本
- ✅ 核心包（Angular、RxJS）已 hoist 到根目录
- ⚠️ 总磁盘占用约 1.84GB，可通过迁移到 pnpm 节省空间

**推荐操作**：
1. 保持当前 yarn 管理方式（稳定）
2. 定期运行 `npm run deps:update` 更新依赖
3. 考虑在下一个大版本迁移到 pnpm

---

## 6. 附录：依赖更新记录

**已更新依赖** (2026-03-16):
- webpack: 5.104.1 → 5.105.4
- sass: 1.97.3 → 1.98.0
- slugify: 1.6.5 → 1.6.8
- source-code-pro: 2.38.0 → 2.42.0
- utils-decorators: 2.0.6 → 2.10.0
- electron-installer-snap: 5.1.0 → 5.2.0

**验证结果**：
- ✅ npm install 成功
- ✅ 构建通过
- ✅ 无安全漏洞