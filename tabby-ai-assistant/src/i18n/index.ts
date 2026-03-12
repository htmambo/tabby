/**
 * 翻译服务
 */
import { Injectable } from '@angular/core'
import { BehaviorSubject, Observable } from 'rxjs'
import { TranslationKeys, SupportedLanguage, LanguageConfig } from './types'
import { zhCN } from './translations/zh-CN'
import { enUS } from './translations/en-US'
import { jaJP } from './translations/ja-JP'
import { ConfigProviderService } from '../services/core/config-provider.service'

const translations: Record<SupportedLanguage, TranslationKeys> = {
    'zh-CN': zhCN,
    'en-US': enUS,
    'ja-JP': jaJP,
}

// 语言配置
export const languageConfigs: LanguageConfig[] = [
    { code: 'zh-CN', label: '简体中文', flag: '🇨🇳' },
    { code: 'en-US', label: 'English', flag: '🇺🇸' },
]

// 导出类型
export { TranslationKeys, SupportedLanguage, LanguageConfig } from './types'

@Injectable({
    providedIn: 'root',
})
export class TranslateService {
    private currentLang$ = new BehaviorSubject<SupportedLanguage>('zh-CN')
    private currentTranslation$ = new BehaviorSubject<TranslationKeys>(zhCN)

    constructor(private config: ConfigProviderService) {
        // 加载保存的语言设置
        const savedLang = this.config.get<string>('language', 'zh-CN') as SupportedLanguage
        this.setLanguage(savedLang || 'zh-CN')
    }

    /**
     * 获取当前语言
     */
    get currentLanguage(): SupportedLanguage {
        return this.currentLang$.value
    }

    /**
     * 监听语言变化
     */
    get language$(): Observable<SupportedLanguage> {
        return this.currentLang$.asObservable()
    }

    /**
     * 获取翻译对象
     */
    get t(): TranslationKeys {
        return this.currentTranslation$.value
    }

    /**
     * 监听翻译变化
     */
    get translation$(): Observable<TranslationKeys> {
        return this.currentTranslation$.asObservable()
    }

    /**
     * 获取所有语言配置
     */
    get languages(): LanguageConfig[] {
        return languageConfigs
    }

    /**
     * 设置语言
     */
    setLanguage(lang: SupportedLanguage): void {
        if (translations[lang]) {
            this.currentLang$.next(lang)
            this.currentTranslation$.next(translations[lang])
            this.config.set('language', lang)
        }
    }

    /**
     * 获取翻译 - 支持插值
     * 例如: translate('general.providerCount', { count: 3 })
     */
    translate(key: string, params?: Record<string, any>): string {
        const keys = key.split('.')
        let value: any = this.currentTranslation$.value

        for (const k of keys) {
            if (value && typeof value === 'object' && k in value) {
                value = value[k]
            } else {
                return key // 找不到翻译，返回 key
            }
        }

        if (typeof value !== 'string') {
            return key
        }

        // 处理插值 {count} -> 实际值
        if (params) {
            return value.replace(/\{(\w+)\}/g, (match, paramKey) => {
                return params[paramKey]?.toString() || match
            })
        }

        return value
    }

    /**
     * 简写方法
     */
    _(key: string, params?: Record<string, any>): string {
        return this.translate(key, params)
    }

    /**
     * 获取指定语言的翻译
     */
    getTranslationForLang(lang: SupportedLanguage): TranslationKeys {
        return translations[lang] || translations['zh-CN']
    }
}
