# 终端工具栏拖拽句柄清理计划

**状态**: ✅ 已完成 (完成时间: 2026-03-13)
**优先级**: P2
**负责人**: AI Assistant

---

## 任务目标和背景

`tabby-terminal/src/components/terminalToolbar.component.ts` 中的 `shouldShowDragHandle` 是一个恒定返回 `false` 的 getter，模板中对应的拖拽句柄永远不会渲染。当前分支为 `refactor/remove-split-feature`，说明该逻辑是移除 split 功能后的遗留代码。

## 现状分析

1. `shouldShowDragHandle` 仅被模板引用一次，且恒定返回 `false`
2. 拖拽句柄元素永远不会渲染
3. `onTabDragStart` 和 `onTabDragEnd` 仅服务于该元素，属于死代码
4. `.drag-handle` 样式无实际用途
5. `AppService` 注入仅服务于上述拖拽逻辑，可一并清理

## 子任务分解

### 任务 1：清理组件死代码 ✅
**状态**: ✅ 已完成

**实际改动**：
1. 删除 `shouldShowDragHandle` getter
2. 删除拖拽开始/结束方法
3. 删除不再使用的 `AppService` 注入与导入

**验收结果**：
- ✅ 组件中不再保留永远不可达的拖拽逻辑
- ✅ 无新增 TypeScript 错误

### 任务 2：清理模板和样式 ✅
**状态**: ✅ 已完成

**实际改动**：
1. 删除模板中的拖拽句柄元素
2. 删除不再使用的 `.drag-handle` 样式

**验收结果**：
- ✅ 模板运行行为与修改前一致
- ✅ 无未使用样式残留

### 任务 3：验证与归档 ✅
**状态**: ✅ 已完成

**实际改动**：
1. 对相关 TS、Pug、SCSS 文件执行错误检查
2. 只读复核改动完整性
3. 归档文档到 `Archive/2026-03/`
4. 更新 `docs/Task/README.md` 索引

**验收结果**：
- ✅ 相关文件无新增错误
- ✅ 任务文档已归档，索引已更新

## 风险评估和结论

- 风险：可能仍存在外部依赖拖拽方法名
- 验证结果：模板与组件内已无引用，未发现遗漏

## 实施结果总结

本次优化将一个“永远返回 false 的伪方法”上升为彻底的死代码清理，删除了不可达模板、无效方法、无用依赖和样式，保持现有界面行为不变，并与当前分支移除 split feature 的方向保持一致。
