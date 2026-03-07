# Tabby 依赖包升级计划（Phase 1-4）

**状态**: ⏳ 待执行
**创建时间**: 2026-03-07
**当前代码**: commit 51670c79 (babel-loader 升级)

## 任务目标

继续升级 Tabby 项目中的依赖包，跳过 Angular 17 升级（会导致启动问题），分阶段完成低风险和中风险包的升级。

## 背景分析

当前状态：
- Angular 15.2.10 运行正常
- Electron 40.8.0 已升级
- 已完成：babel-loader、sass-loader、css-loader 升级

根据 codex 分析，存在以下硬阻塞：
- `ngx-toastr@20` 需要 Angular 17+（当前 Angular 15）
- `filesize@11` 与 `ngx-filesize@3.x` peer 依赖不兼容
- `@sentry/electron@7` 不支持 Electron 40
- `@electron/notarize@3` 需要 Node 22+ 且为 ESM-only

## 详细任务分解

### Phase 1: 低风险工具链批次 ⏳

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

**验证步骤**：
1. 升级依赖
2. 运行 `npm run lint` 检查 ESLint
3. 运行 `npm run build` 检查构建
4. 启动应用验证功能

### Phase 2: 低风险运行时工具批次 ⏳

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

**验证步骤**：
1. 升级依赖
2. 启动应用验证基本功能
3. 测试窗口管理功能
4. 测试 URL 处理功能

### Phase 3a: cross-env 单包升级 ⏳

**包列表**：
- `cross-env`: 7.0.3 → 10.1.0

**风险评估**: 中
**原因**: 直接影响开发和启动命令，需要 Node 20+
**关联文件**: package.json:115, 116, 118 (watch, start, prod 脚本)

**验证步骤**：
1. 升级依赖
2. 运行 `npm run watch` 验证开发模式
3. 运行 `npm run start` 验证启动
4. 运行 `npm run prod` 验证生产模式

### Phase 3b: @fortawesome/fontawesome-free 单包升级 ⏳

**包列表**：
- `@fortawesome/fontawesome-free`: 6.4.0 → 7.2.0

**风险评估**: 中
**原因**: Major 版本升级，涉及全局 CSS 和图标 metadata
**关联文件**：
- scripts/generate-icon-metadata.mjs:10
- app/src/entry.preload.ts:5

**验证步骤**：
1. 升级依赖
2. 运行图标 metadata 生成脚本
3. 启动应用检查图标显示
4. 检查 CSS 样式是否正常

### Phase 3c: @sentry/cli 单包升级 ⏳

**包列表**：
- `@sentry/cli`: 2.18.1 → 3.3.0

**风险评估**: 中
**原因**: 只影响发布/符号上传链
**关联文件**：
- scripts/sentry-upload.mjs:5
- .github/workflows/build.yml:111

**验证步骤**：
1. 升级依赖
2. 本地构建验证
3. CI 流程验证（如需要）

### Phase 4: lru-cache 重构升级 ⏳

**包列表**：
- `lru-cache`: 6.0.0 → 11.2.6

**风险评估**: 中高
**原因**: API 变更，需要修改代码
**关联文件**: app/lib/lru.ts:1

**API 变更**：
- 旧: `LRU` / `maxAge`
- 新: `LRUCache` / `ttl`

**代码改动**：
需要修改 app/lib/lru.ts 的导入和使用方式

**验证步骤**：
1. 升级依赖
2. 修改 app/lib/lru.ts 代码
3. 启动应用验证文件路径解析
4. 测试缓存相关功能

## 明确冻结的包（Phase 5）

以下包本轮**不升级**，留到平台升级窗口：

- `ngx-toastr`: 16.2.0 → 20.0.5（需要 Angular 17+）
- `filesize`: 9.0.11 → 11.0.13（与 ngx-filesize 不兼容）
- `@sentry/electron`: 2.5.4 → 7.9.0（不支持 Electron 40）
- `@electron/notarize`: 1.2.4 → 3.1.1（需要 Node 22+）

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
