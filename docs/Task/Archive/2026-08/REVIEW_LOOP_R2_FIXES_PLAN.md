**Status**: ✅ Completed (completion time: 2026-08-21)

# 外部审核 Round 2 闭环任务

## 任务背景

分支 `fix/build-after-master-sync` 在 master 同步后已通过 3 次 commit（bd0e3ea8 / 822e0a92 / 4e018190）修复构建与运行问题。按规范使用外部审核 MCP（coding-bridge）对这 3 次提交进行 code review，得到首轮 verdict = NEEDS_CHANGES（9 项风险 R1–R9）。本任务负责按审核反馈闭环所有风险。

## Round 1 风险清单与处置

| # | 风险 | 处置方式 | 状态 |
|---|---|---|---|
| R1 | 70px macOS padding 缺平台守卫 | 代码审查证伪：scss 选择器 `.tab-bar-no-controls-overlay` 仅在 macOS 挂载（pug line 18） | ✅ 关闭 |
| R2 | profileTree 跨文件残留 | **本轮补丁 + typings 扩展清理** | ✅ 关闭 |
| R3 | xtermFrontend attach/detach 一致性 | 代码审查确认：bound instance fields + attachedHost 守卫 | ✅ 关闭 |
| R4 | tab-header 末尾 border-right 多余 1px | **本轮补丁**：添加 `&:last-child { border-right: 0 }` | ✅ 关闭 |
| R5 | `.tabs gap:1px` 影响拖拽 hit-test | 作者 trailer 声明运行时手测 Not-tested | ⚠️ 非阻塞保留 |
| R6 | app-builder-lib patch 删除 | 代码审查确认 26.15.3 已含上游 fix | ✅ 关闭 |
| R7 | `merge -s ours` 漏拣 | `git log --cherry-pick` 验证为空 | ✅ 关闭 |
| R8 | promiseIpc / electronDebug 残留 | grep 验证业务代码 0 命中 | ✅ 关闭 |
| R9 | `@npmcli/arborist` 类型声明 | lockfile 已包含，间接依赖 | ✅ 关闭 |

## 本轮变更内容

### 文件 1: tabby-core/src/components/tabHeader.component.scss (+4/-0)
在 `:host` 内部、`border-right: 1px solid var(--theme-bg);` 之后、`&.active` 之前插入：

```scss
&:last-child {
    border-right: 0;
}
```

**目的**：避免最右侧 tab 与右工具栏之间出现 1px 视觉缝隙。
**SCSS 嵌套**：与 `&.active` / `&.flex-width` / `&.vertical` 同层，无选择器特异性冲突。

### 文件 2: tabby-settings/src/components/windowSettingsTab.component.pug (+0/-9)
删除 8 行 `.form-line` 块（含 i18n label "Show profile sidebar" 与 description、"Displays a full tree of profiles in the sidebar"）：

```pug
-.form-line
-    .header
-        .title(translate) Show profile sidebar
-        .description(translate) Displays a full tree of profiles in the sidebar.
-    toggle(
-        [(ngModel)]='config.store.showProfileTree',
-        (ngModelChange)='saveConfiguration(false)'
-    )
```

**目的**：避免运行时访问已删除的 `configDefaults.showProfileTree` 默认值抛 TypeError。
**结构保持**：删除后 `h3.mt-4(translate) Docking` 直接相邻，无悬挂缩进。

### 文件 3: tabby-core/typings/components/profileTree.component.d.ts (删除)
删除前为 R2 残留扩展 —— 上次构建生成但源 `.ts` 已删除的孤儿类型声明。
**tsconfig.typings.json**: `exclude: ["typings"]` 保护目录，不会被重建覆盖。
**未 tracked**: 不在 git diff stat 中显示，但确实清理了磁盘残留。

## 验证证据

| 验证项 | 命令 / 结果 |
|---|---|
| R2 业务残留扫描 | `rg -n --hidden -g '!node_modules' -g '!dist' -g '!*.map' -g '!yarn.lock' 'ProfileTree\|profileTree\|showProfileTree\|profile-tree\|profile_tree' tabby-core tabby-settings tabby-terminal tabby-electron app` → ✅ 0 命中 |
| R2 i18n 孤儿键 | find 所有 `.po`/`.json` 并 grep 翻译字符串 → ✅ 0 命中 |
| R2 CSS 孤儿 | find 所有 `.scss`/`.css` 并 grep 选择器 → ✅ 0 命中 |
| R2 测试孤儿 | find 所有 `.spec.ts`/`.test.ts` 并 grep → ✅ 0 命中 |
| R4 SCSS 选择器语义 | 检查 `&:last-child` 嵌套层级与兄弟选择器一致性 → ✅ 无冲突 |
| 全量构建 | `yarn build` exit_code=0，15 bundles 全部成功，45.51s |
| typings 残留 | `ls tabby-core/typings/components/` → 19 个 `.d.ts`，无 profileTree 相关 |

## 外部审核闭环

- **Round 1**: NEEDS_CHANGES (9 risks)
- **Round 2**: **APPROVED（附残留风险）** — session 61a5a9aa-67cf-4d3d-bf5e-8c7565a47c5a

外部审核残留建议（非阻塞、合并后可跟进）：
- **P1.2**: `.tabs { gap:1px }` 与 `:host { border-right:1px }` 在中间 tab 视觉叠加为 2px，需 UI/视觉同学回归
- **P2.1**: 建议 `.gitignore` 收紧 `tabby-core/typings/**/*.d.ts`，避免下次删组件产生孤儿
- **R5**: 多 tab 拖拽 hit-test 在三平台手测覆盖

## 文件变更总结

```
tabby-core/src/components/tabHeader.component.scss            | 4 ++++
tabby-settings/src/components/windowSettingsTab.component.pug | 9 ---------
tabby-core/typings/components/profileTree.component.d.ts     | (deleted, untracked)
```

## 验收结果

- ✅ yarn build 通过
- ✅ 外部审核 MCP Round 2 verdict = APPROVED
- ✅ Patch A 全范围 grep 4 路扫描 0 命中
- ✅ 无新增构建错误或警告
- ✅ OMC trailer 在 commit message 中保留

## 备注

- 外部审核 MCP 在本会话初次不可用，本地交叉验证后 MCP 修复，成功完成 Round 2 闭环
- fallback chain (coding-bridge → kimi) 在 MCP 故障期间也未启用（fallback 工具同样不可用），按 CLAUDE.md §1.4 第三优先级完成本地验证
- R5（拖拽 hit-test）是唯一无法在 CI 中验证的边界，已在 commit trailer 显式声明
