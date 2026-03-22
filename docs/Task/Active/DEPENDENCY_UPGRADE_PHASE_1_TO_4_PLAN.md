# Tabby 依赖包升级计划（Phase 1-4）

**状态**: ✅ 已完成（Phase 1-3 已落地，Phase 4 保留冻结）
**创建时间**: 2026-03-07
**当前代码**: 2026-03-15 优化分支（含依赖升级）

## 2026-03-22 增量更新

- 已新增 `eslint.config.mjs` 并完成从 legacy `.eslintrc.yml` 到 flat config 的迁移
- 已将 `eslint` 从 `9.39.4` 升级到 `10.1.0`
- 已保留 progressive lint 行为：
  - `@typescript-eslint/no-floating-promises`: `warn` → `error`
  - `@typescript-eslint/require-await`: `warn` → `error`
- 已在 `app/tsconfig.json` 收紧 `types: ["node"]`，避免 ESLint 10 类型依赖渗入应用 webpack 编译并产生额外 warning
- 已验证：
  - `./node_modules/.bin/eslint --print-config app/src/app.module.ts`
  - `TABBY_LINT_PROGRESSIVE=true ./node_modules/.bin/eslint --print-config app/src/app.module.ts`
  - `yarn lint` 可执行，当前仍回到历史基线失败：`6503 problems (2141 errors, 4362 warnings)`
  - `./node_modules/.bin/webpack --config app/webpack.config.mjs` 通过

## 当前剩余阻塞项（2026-03-22）

- `@types/minimatch@6`
  - 升级后会触发 `TS2688: Cannot find type definition file for 'minimatch'`
- `@types/node@25`
  - 先前已经引入真实类型回归，当前暂缓
- `filesize@11`
  - `ngx-filesize@3.0.7` 仍声明 `filesize: >= 6.0.0 < 10.0.0`
- `lru-cache@11`
  - 仍受 ESM/CommonJS 运行时兼容问题阻塞

## 备注（2026-03-22）

- `eslint-plugin-import@2.32.0` 运行实测可兼容 `eslint@10.1.0`，但其 `peerDependencies` 仍只声明到 `^9`
- 本轮剩余 `yarn outdated` 仅有：`@types/minimatch`、`@types/node`、`filesize`、`lru-cache`

## 任务目标

继续升级 Tabby 项目中的依赖包，分阶段完成低风险和中风险包的升级；高风险项保留冻结并单独评估。

## 背景分析

当前状态：
- Angular 21.2.1 运行正常
- Electron 40.8.0 已升级
- 已完成：babel-loader、sass-loader、css-loader 及 Phase 1-3 依赖升级

根据 codex 分析，存在以下硬阻塞：
- `ngx-toastr@20` 需要 Angular 17+（当前 Angular 15）
- `filesize@11` 与 `ngx-filesize@3.x` peer 依赖不兼容
- `@sentry/electron@7` 不支持 Electron 40
- `@electron/notarize@3` 需要 Node 22+ 且为 ESM-only

## 详细任务分解

### Phase 1: 低风险工具链批次 ✅

**包列表**：
- `@types/node`: 20.19.27 → 20.19.37
- `@typescript-eslint/eslint-plugin`: 6.4.1 → 6.21.0
- `@typescript-eslint/parser`: 6.4.1 → 6.21.0
- `eslint`: 8.48.0 → 8.57.1
- `ts-loader`: 9.4.2 → 9.5.4
- `tslib`: 2.5.0 → 2.8.1

**风险评估**: 低
**原因**: 工具链小版本升级，不直接影响运行时行为
**注意**: `@typescript-eslint/*` 和 `eslint` 必须一起升级

**验证结果**：
1. 依赖已升级
2. 构建验证通过
3. 应用启动验证通过

### Phase 2: 低风险运行时工具批次 ✅

**包列表**：
- `compare-versions`: 5.0.3 → 6.1.1
- `deep-equal`: 2.0.5 → 2.2.3
- `dotenv`: 16.6.1 → 17.3.1
- `shell-quote`: 1.7.4 → 1.8.3

**风险评估**: 低
**原因**: 使用方式简单，升级后大概率不需要改代码
**关联文件**：
- `compare-versions`: app/lib/window.ts:10
- `dotenv`: app/lib/index.ts:7
- `shell-quote`: app/lib/urlHandler.ts:2

**验证结果**：
1. 依赖已升级
2. 基本功能与窗口/URL 流程验证通过

### Phase 3a: cross-env 单包升级 ✅

**包列表**：
- `cross-env`: 7.0.3 → 10.1.0

**风险评估**: 中
**原因**: 直接影响开发和启动命令，需要 Node 20+
**关联文件**: package.json:115, 116, 118 (watch, start, prod 脚本)

**验证结果**：
1. 依赖已升级
2. 开发/启动/生产模式验证通过

### Phase 3b: @fortawesome/fontawesome-free 单包升级 ✅

**包列表**：
- `@fortawesome/fontawesome-free`: 6.4.0 → 7.2.0

**风险评估**: 中
**原因**: Major 版本升级，涉及全局 CSS 和图标 metadata
**关联文件**：
- scripts/generate-icon-metadata.mjs:10
- app/src/entry.preload.ts:5

**验证结果**：
1. 依赖已升级
2. 图标 metadata 生成通过
3. 图标与样式验证通过

### Phase 3c: @sentry/cli 单包升级 ✅

**包列表**：
- `@sentry/cli`: 2.18.1 → 3.3.0

**风险评估**: 中
**原因**: 只影响发布/符号上传链
**关联文件**：
- scripts/sentry-upload.mjs:5
- .github/workflows/build.yml:111

**验证结果**：
1. 依赖已升级
2. 本地构建验证通过

### Phase 4: lru-cache 重构升级 ❌

**包列表**：
- `lru-cache`: 6.0.0 → 11.2.6

**状态**: 已放弃
**原因**: lru-cache 11.x 的 ESM/CommonJS 导出方式与当前 webpack 配置不兼容，导致运行时错误。需要更深入的 webpack 配置调整或等待更好的解决方案。

**尝试过的方法**：
1. 使用命名导入 `{ LRUCache }` - 失败
2. 使用默认导入 - 失败
3. 添加到 webpack externals - 失败
4. 使用 require 语法 - TypeScript 不允许
5. 使用动态导入回退 - 仍然失败

**建议**: 暂时保持 lru-cache 6.0.0，等待 lru-cache 或 webpack 生态改进后再升级。

## 明确冻结的包（Phase 5）

以下包本轮**不升级**，留到平台升级窗口：

- `ngx-toastr`: 16.2.0 → 20.0.5（需要 Angular 17+）
- `filesize`: 9.0.11 → 11.0.13（与 ngx-filesize 不兼容）
- `@sentry/electron`: 2.5.4 → 7.9.0（不支持 Electron 40）
- `@electron/notarize`: 1.2.4 → 3.1.1（需要 Node 22+）

以上包继续冻结，待兼容性评估与平台窗口确认后再推进。

## 预期效果

- 完成 Phase 1-4 的依赖升级
- 应用正常启动，进度条正常显示
- 主界面正常进入
- 所有核心功能正常工作
- 代码通过 lint 检查
- 构建成功

## 风险评估

- **低风险**: Phase 1, 2
- **中风险**: Phase 3a, 3b, 3c
- **中高风险**: Phase 4（需要代码改动）

## 缓解措施

- 每个 Phase 独立提交，便于回滚
- Phase 3 的三个包分别独立提交
- Phase 4 单独提交并充分测试
- 出现问题立即回滚到上一个工作版本

## 实施顺序

1. Phase 1: 低风险工具链
2. Phase 2: 低风险运行时工具
3. Phase 3a: cross-env
4. Phase 3b: @fortawesome/fontawesome-free
5. Phase 3c: @sentry/cli
6. Phase 4: lru-cache（需要代码改动）

## 备注

- 不修改 entry.ts（用户明确要求）
- 每个阶段完成后需要用户确认功能正常
- 不自作主张提交，需要用户确认后再提交
