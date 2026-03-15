import { Injectable } from '@angular/core'
import { Agent as HttpAgent } from 'http'
import { Agent as HttpsAgent } from 'https'
import axios from 'axios'
import { HttpProxyAgent } from 'http-proxy-agent'
import * as HttpsProxyAgentModule from 'https-proxy-agent'
import { getRuntimeEnv } from 'tabby-core'
import { ConfigProviderService } from '../core/config-provider.service'
import { LoggerService } from '../core/logger.service'
import { ProxyConfig, DEFAULT_PROXY_CONFIG, ProxyTestResult } from '../../types/proxy.types'

/**
 * 代理服务
 * 提供统一的代理配置管理和 HTTP 代理支持
 */
@Injectable({ providedIn: 'root' })
export class ProxyService {
    constructor(
        private config: ConfigProviderService,
        private logger: LoggerService,
    ) {}

    /**
     * 获取代理配置
     */
    getProxyConfig(): ProxyConfig {
        const savedConfig = this.config.get<ProxyConfig>('proxy')
        return savedConfig ? { ...DEFAULT_PROXY_CONFIG, ...savedConfig } : { ...DEFAULT_PROXY_CONFIG }
    }

    /**
     * 检查是否应该绕过代理
     */
    shouldBypassProxy(url: string): boolean {
        const proxyConfig = this.getProxyConfig()
        if (!proxyConfig.enabled) {return true}

        const noProxy = proxyConfig.noProxy ?? []
        const hostname = this.extractHostname(url)

        return noProxy.some(pattern => {
            if (pattern.startsWith('*.')) {
                // 通配符匹配 *.local -> localhost, foo.local
                const suffix = pattern.slice(1)
                return hostname.endsWith(suffix) || hostname === suffix.slice(1)
            }
            return hostname === pattern || hostname.endsWith('.' + pattern)
        })
    }

    /**
     * 获取 HTTP/HTTPS Agent 用于 axios
     * 返回适用于 axios 的代理配置对象
     */
    getAxiosProxyConfig(url: string): { httpAgent?: HttpAgent; httpsAgent?: HttpsAgent } {
        const proxyConfig = this.getProxyConfig()

        if (!proxyConfig.enabled || this.shouldBypassProxy(url)) {
            return {}
        }

        const isHttps = url.startsWith('https://')
        const proxyUrl = isHttps
            ? (proxyConfig.httpsProxy ?? proxyConfig.httpProxy)
            : proxyConfig.httpProxy

        if (!proxyUrl) {
            return {}
        }

        const proxyTarget = this.applyProxyAuth(proxyUrl, proxyConfig)

        // 动态导入代理 agent
        if (isHttps) {
            return { httpsAgent: this.createHttpsProxyAgent(proxyTarget) }
        } else {
            return { httpAgent: this.createHttpProxyAgent(proxyTarget) }
        }
    }

    /**
     * 获取 fetch 使用的代理选项 (Electron 环境)
     * 注意：原生 fetch 不支持代理，需要使用 node-fetch 或 agent
     */
    getFetchProxyAgent(url: string): HttpsAgent | HttpAgent | undefined {
        const proxyConfig = this.getProxyConfig()

        if (!proxyConfig.enabled || this.shouldBypassProxy(url)) {
            return undefined
        }

        const isHttps = url.startsWith('https://')
        const proxyUrl = isHttps
            ? (proxyConfig.httpsProxy ?? proxyConfig.httpProxy)
            : proxyConfig.httpProxy

        if (!proxyUrl) {
            return undefined
        }

        const proxyTarget = this.applyProxyAuth(proxyUrl, proxyConfig)

        if (isHttps) {
            return this.createHttpsProxyAgent(proxyTarget)
        } else {
            return this.createHttpProxyAgent(proxyTarget)
        }
    }

    /**
     * 创建 HTTP 代理 Agent
     */
    private createHttpProxyAgent(proxyUrl: string): HttpAgent {
        try {
            return new HttpProxyAgent(proxyUrl) as unknown as HttpAgent
        } catch {
            return new HttpAgent()
        }
    }

    /**
     * 创建 HTTPS 代理 Agent
     */
    private createHttpsProxyAgent(proxyUrl: string): HttpsAgent {
        try {
            const ProxyAgentCtor = this.resolveHttpsProxyAgentCtor()
            return new ProxyAgentCtor(proxyUrl)
        } catch {
            return new HttpsAgent()
        }
    }

    /**
     * 构建代理选项
     */
    private applyProxyAuth(proxyUrl: string, proxyConfig: ProxyConfig): string {
        if (!proxyConfig.auth?.username) {
            return proxyUrl
        }
        try {
            const url = new URL(proxyUrl)
            if (!url.username) {
                url.username = proxyConfig.auth.username
            }
            if (!url.password && proxyConfig.auth.password !== undefined) {
                url.password = proxyConfig.auth.password
            }
            return url.toString()
        } catch {
            return proxyUrl
        }
    }

    private resolveHttpsProxyAgentCtor(): new (proxy: string | URL) => HttpsAgent {
        const moduleAny = HttpsProxyAgentModule as unknown as {
            HttpsProxyAgent?: new (proxy: string | URL) => HttpsAgent
            default?: new (proxy: string | URL) => HttpsAgent
        }
        return moduleAny.HttpsProxyAgent ?? moduleAny.default ?? (HttpsProxyAgentModule as unknown as new (proxy: string | URL) => HttpsAgent)
    }

    /**
     * 提取主机名
     */
    private extractHostname(url: string): string {
        try {
            return new URL(url).hostname
        } catch {
            return url
        }
    }

    /**
     * 验证代理配置
     */
    validateProxyUrl(proxyUrl: string): { valid: boolean; message: string } {
        if (!proxyUrl || proxyUrl.trim() === '') {
            return { valid: true, message: '' }
        }
        try {
            const url = new URL(proxyUrl)
            const validProtocols = ['http:', 'https:', 'socks5:', 'socks4:']

            if (!validProtocols.includes(url.protocol)) {
                return {
                    valid: false,
                    message: `不支持的协议: ${url.protocol}。支持: http, https, socks5`,
                }
            }
            return { valid: true, message: '代理地址格式正确' }
        } catch {
            return { valid: false, message: '无效的代理地址格式' }
        }
    }

    /**
     * 测试代理连接
     */
    async testProxyConnection(proxyUrl: string): Promise<ProxyTestResult> {
        const testUrl = 'https://api.openai.com/v1/models'
        const startTime = Date.now()

        try {
            const agent = this.createHttpsProxyAgent(proxyUrl)
            const response = await axios.get(testUrl, {
                httpsAgent: agent,
                proxy: false,
                timeout: 10000,
                validateStatus: () => true,
            })
            const latency = Date.now() - startTime

            return {
                success: response.status < 500,
                message: `连接成功 (${response.status})`,
                latency,
            }
        } catch (error) {
            return {
                success: false,
                message: `测试失败: ${error instanceof Error ? error.message : String(error)}`,
            }
        }
    }

    /**
     * 从环境变量导入代理配置
     */
    importFromEnv(): ProxyConfig {
        const httpProxy = getRuntimeEnv('HTTP_PROXY') ?? getRuntimeEnv('http_proxy') ?? ''
        const httpsProxy = getRuntimeEnv('HTTPS_PROXY') ?? getRuntimeEnv('https_proxy') ?? ''
        const noProxy = getRuntimeEnv('NO_PROXY') ?? getRuntimeEnv('no_proxy') ?? ''

        const proxyConfig: ProxyConfig = {
            enabled: !!(httpProxy || httpsProxy),
            httpProxy,
            httpsProxy,
            noProxy: noProxy.split(',').map(s => s.trim()).filter(s => s),
            auth: undefined,
        }

        this.logger.info('Proxy config imported from environment', { proxyConfig })
        return proxyConfig
    }

    /**
     * 保存代理配置
     */
    saveProxyConfig(config: ProxyConfig): void {
        this.config.set('proxy', config)
        this.logger.info('Proxy configuration saved', { enabled: config.enabled })
    }
}
