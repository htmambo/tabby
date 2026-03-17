# piz 功能迁移分析报告

**日期**: 2026-03-17
**分析对象**: [piz](https://github.com/AriesOxO/piz) → Tabby AI Assistant
**状态**: 分析完成

---

## 1. 项目概述

### 1.1 piz 项目简介

piz 是一个用 Rust 编写的命令行工具，能够将自然语言描述转换为 shell 命令。其核心功能是让用户通过自然语言描述意图，然后生成对应的命令并执行。

```
$ piz list all files larger than 100MB
  ➜ find . -size +100M -type f
  [Y] Execute  [n] Cancel  [e] Edit
```

### 1.2 Tabby AI Assistant 现状

Tabby AI Assistant 是 Tabby 终端的内置 AI 助手插件，使用 TypeScript/Angular 开发，已具备以下能力：

- 多 LLM 后端支持（OpenAI、Claude、Minimax、GLM、Ollama 等）
- MCP (Model Context Protocol) 集成
- 命令生成与解释
- 风险评估与安全验证
- 聊天历史持久化
- 终端工具调用（read/write terminal、async tasks）

---

## 2. 功能对比分析

### 2.1 功能矩阵

| 功能模块 | piz | Tabby AI Assistant | 差距分析 |
|---------|-----|-------------------|---------|
| **自然语言→命令** | ✅ 核心功能 | ✅ `CommandGeneratorService` | 相当 |
| **命令解释** | ✅ `piz -e <cmd>` | ✅ 已支持 | 相当 |
| **错误修复** | ✅ `piz fix` (重试3次) | ✅ `generateFixForError` | 需增强重试机制 |
| **多 LLM 后端** | ✅ 12+ 提供商 | ✅ 6+ 提供商 | 相当 |
| **安全检测** | ✅ 三层检测 | ✅ `RiskAssessmentService` | 需增强注入检测 |
| **历史记录** | ✅ SQLite 持久化 | ✅ `ChatHistoryService` | 相当 |
| **命令缓存** | ✅ SQLite + TTL + LRU | ❌ 无 | **需新增** |
| **多候选命令** | ✅ `-n` 参数 | ❌ 单一结果 | **需新增** |
| **Shell 集成** | ✅ `piz init` | ✅ 终端内置 | 形态不同 |
| **交互模式** | ✅ `piz chat` | ✅ 侧边栏聊天 | 相当 |
| **自更新** | ✅ `piz update` | ✅ electron-updater | 形态不同 |

### 2.2 架构差异

| 维度 | piz | Tabby AI Assistant |
|------|-----|-------------------|
| **运行环境** | 独立 CLI 进程 | Electron 插件 |
| **编程语言** | Rust | TypeScript/Angular |
| **数据存储** | SQLite (本地文件) | IndexedDB / 内存 |
| **UI 层** | TUI (终端界面) | GUI (Web 组件) |
| **集成方式** | Shell wrapper 函数 | 终端内置工具 |

---

## 3. 可迁移特性详细分析

### 3.1 🟢 高价值 - 命令缓存系统

**当前状态**: Tabby AI Assistant 无命令缓存机制，每次请求都调用 LLM API。

**piz 实现方式**:
- 使用 SQLite 存储命令缓存
- 支持 TTL (Time To Live) 过期机制
- 支持 LRU (Least Recently Used) 淘汰策略
- 缓存键：自然语言描述 + 上下文 hash

**迁移价值**:
- 减少重复 API 调用，降低成本
- 加速响应时间（从秒级降至毫秒级）
- 离线场景下可复用历史命令

**推荐实现**:
```typescript
interface CommandCache {
    id: string;
    naturalLanguage: string;    // 用户输入
    contextHash: string;        // 上下文指纹
    command: string;            // 生成的命令
    explanation: string;        // 命令说明
    confidence: number;         // 置信度
    provider: string;           // LLM 提供商
    model: string;              // 模型名称
    createdAt: Date;            // 创建时间
    lastAccessedAt: Date;       // 最后访问时间
    hitCount: number;           // 命中次数
    ttl: number;                // 过期时间（秒）
}

// 缓存配置
const CACHE_CONFIG = {
    maxSize: 500,               // 最大缓存条目数
    defaultTtl: 7 * 24 * 3600,  // 默认 7 天过期
    contextWeight: 0.3,         // 上下文相似度权重
}
```

**实现难度**: 低
**预计工作量**: 1-2 天

---

### 3.2 🟢 高价值 - 多候选命令生成

**当前状态**: `CommandGeneratorService` 只返回单个命令结果。

**piz 实现方式**:
- 通过 `-n` 参数指定候选数量
- LLM 一次性生成多个候选命令
- 用户可交互选择最合适的

**迁移价值**:
- 提升用户体验，提供更多选择
- 降低单一结果不准确的影响
- 适用于模糊需求场景

**推荐实现**:
```typescript
// 扩展 CommandResponse 类型
interface CommandResponse {
    command: string;              // 主推荐命令
    alternatives?: AlternativeCommand[];  // 替代方案
    explanation: string;
    confidence: number;
}

interface AlternativeCommand {
    command: string;
    explanation: string;
    confidence: number;
    tags?: string[];  // 如 'safer', 'faster', 'more-verbose'
}

// UI 扩展
// 在命令预览组件中显示多个候选
// 用户可点击选择或使用数字键快速选择
```

**实现难度**: 低
**预计工作量**: 1 天

---

### 3.3 🟢 高价值 - 命令注入检测增强

**当前状态**: `RiskAssessmentService` 已有基础危险模式检测，但缺乏注入攻击专项检测。

**piz 实现方式**:
- 三层安全检测：prompt 级拒绝、注入检测、危险命令分类
- 检测 base64 编码、反向 shell、环境变量泄露等

**迁移价值**:
- 增强安全性，防止命令注入攻击
- 覆盖更多攻击向量
- 提供更详细的安全警告

**推荐实现的检测规则**:
```typescript
// 注入检测模式
const INJECTION_PATTERNS = [
    // 命令替换
    { pattern: /\$\([^)]*\)/, description: '命令替换注入', severity: 'HIGH' },
    { pattern: /`[^`]*`/, description: '反引号命令执行', severity: 'HIGH' },

    // 编码绕过
    { pattern: /base64.*-d.*\|/, description: 'Base64 解码管道', severity: 'CRITICAL' },
    { pattern: /xxd.*-r.*\|/, description: '十六进制解码管道', severity: 'HIGH' },

    // 环境变量操作
    { pattern: /export\s+\w+=.*\$/, description: '环境变量注入', severity: 'MEDIUM' },
    { pattern: /env\s+-i/, description: '环境隔离绕过', severity: 'MEDIUM' },

    // 管道链攻击
    { pattern: /\|\s*sh\b/, description: '管道执行 shell', severity: 'HIGH' },
    { pattern: /\|\s*bash\b/, description: '管道执行 bash', severity: 'HIGH' },
    { pattern: /\|\s*curl.*\|/, description: 'curl 管道链', severity: 'CRITICAL' },

    // 远程执行
    { pattern: /curl.*\|\s*(sh|bash)/, description: '远程脚本执行', severity: 'CRITICAL' },
    { pattern: /wget.*\|\s*(sh|bash)/, description: '远程脚本执行', severity: 'CRITICAL' },

    // 系统配置修改
    { pattern: />\s*\/etc\//, description: '系统配置覆写', severity: 'CRITICAL' },
    { pattern: />\s*~\/\.ssh\//, description: 'SSH 配置覆写', severity: 'HIGH' },

    // 反向 shell 特征
    { pattern: /\/dev\/tcp\//, description: 'TCP 反向 shell', severity: 'CRITICAL' },
    { pattern: /nc\s+-[elp]/, description: 'Netcat 监听', severity: 'HIGH' },
    { pattern: /socat\s+.*fork/, description: 'Socat 反向 shell', severity: 'CRITICAL' },
]
```

**实现难度**: 低
**预计工作量**: 0.5 天

---

### 3.4 🟡 中等价值 - 自动修复重试机制

**当前状态**: `generateFixForError` 只尝试一次修复。

**piz 实现方式**:
- `piz fix` 命令自动诊断最后失败的命令
- 最多重试 3 次
- 每次重试基于新的错误信息调整

**迁移价值**:
- 提高复杂错误的修复成功率
- 自动化调试流程

**推荐实现**:
```typescript
interface FixAttempt {
    attempt: number;
    command: string;
    error: string;
    success: boolean;
}

async generateFixForError(
    error: TerminalError,
    options: { maxRetries?: number; autoExecute?: boolean } = {}
): Promise<CommandResponse> {
    const maxRetries = options.maxRetries ?? 3
    const attempts: FixAttempt[] = []

    for (let i = 0; i < maxRetries; i++) {
        const fix = await this.generateCommand({
            naturalLanguage: `修复错误（第 ${i + 1} 次尝试）：${error.message}`,
            context: this.buildErrorContext(error, attempts),
        })

        attempts.push({
            attempt: i + 1,
            command: fix.command,
            error: error.message,
            success: false,
        })

        if (options.autoExecute) {
            const result = await this.executeAndValidate(fix.command)
            if (result.success) {
                return { ...fix, attempts }
            }
            error = result.error  // 更新错误信息用于下次重试
        } else {
            return { ...fix, attempts }
        }
    }

    throw new Error(`Failed to fix after ${maxRetries} attempts`)
}
```

**实现难度**: 中
**预计工作量**: 1 天

---

### 3.5 🟡 中等价值 - 缓存淘汰策略

**当前状态**: 不适用（无缓存）。

**piz 实现方式**:
- TTL 过期：每个缓存条目有生存时间
- LRU 淘汰：基于访问频率和时间

**迁移价值**:
- 保持缓存新鲜度
- 控制内存占用
- 适应命令变更场景

**推荐实现**:
```typescript
class CommandCacheService {
    private cache: Map<string, CacheEntry>
    private accessOrder: LinkedList<string>  // LRU 队列

    // TTL 检查（定时任务）
    private startTtlChecker(): void {
        setInterval(() => this.evictExpired(), 60000)  // 每分钟检查
    }

    // LRU 淘汰
    private evictLru(): void {
        while (this.cache.size > this.config.maxSize) {
            const oldest = this.accessOrder.pop()
            if (oldest) this.cache.delete(oldest)
        }
    }

    // 访问时更新 LRU 顺序
    get(key: string): CacheEntry | null {
        const entry = this.cache.get(key)
        if (entry) {
            this.accessOrder.moveToFront(key)
            entry.hitCount++
            entry.lastAccessedAt = new Date()
        }
        return entry ?? null
    }
}
```

**实现难度**: 中
**预计工作量**: 1 天

---

## 4. 不适用特性

### 4.1 Shell 集成 (`piz init`)

**原因**: Tabby 是 GUI 终端，AI 助手作为插件直接内置，不需要通过 shell wrapper 函数实现集成。

### 4.2 独立 CLI 形态

**原因**: Tabby AI Assistant 作为插件运行在 Electron 环境中，不是独立的命令行程序。

### 4.3 自更新机制

**原因**: Tabby 已有 electron-updater 处理应用更新，插件更新由 Tabby 插件系统管理。

---

## 5. 迁移优先级建议

| 优先级 | 特性 | 价值 | 难度 | 工作量 |
|-------|------|-----|-----|-------|
| P0 | 命令注入检测增强 | 高 | 低 | 0.5 天 |
| P1 | 命令缓存系统 | 高 | 低 | 1-2 天 |
| P1 | 多候选命令生成 | 高 | 低 | 1 天 |
| P2 | 自动修复重试机制 | 中 | 中 | 1 天 |
| P2 | 缓存淘汰策略 | 中 | 中 | 1 天 |

**总计工作量**: 4.5-6 天

---

## 6. 风险评估

| 风险 | 可能性 | 影响 | 缓解措施 |
|-----|-------|-----|---------|
| 缓存命中率高导致过时命令 | 中 | 中 | TTL 过期 + 用户可手动刷新 |
| 多候选命令增加响应延迟 | 低 | 低 | 并行生成或流式返回 |
| 注入检测误报 | 低 | 中 | 提供白名单机制 |
| 重试机制可能执行危险操作 | 中 | 高 | 每次重试需用户确认 |

---

## 7. 结论

piz 的核心功能与 Tabby AI Assistant 已有高度重叠，迁移工作主要是**增量增强**而非从头实现。建议优先实现：

1. **命令缓存系统** - 直接提升性能和降低成本
2. **命令注入检测增强** - 提升安全性
3. **多候选命令生成** - 提升用户体验

整体迁移可行性评估为 **高**，风险为 **低**，预计总工作量 4.5-6 天可完成核心特性迁移。