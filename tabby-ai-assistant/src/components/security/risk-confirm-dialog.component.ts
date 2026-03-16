import { Component, Input, Output, EventEmitter, ViewChild, ElementRef, HostListener } from '@angular/core'
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap'
import { focusElementLater, isPlainEscape } from 'tabby-core'
import { RiskLevel } from '../../types/security.types'

@Component({
    selector: 'app-risk-confirm-dialog',
    standalone: false,
    templateUrl: './risk-confirm-dialog.component.html',
    styleUrls: ['./risk-confirm-dialog.component.scss'],
})
export class RiskConfirmDialogComponent {
    @Input() command = ''
    @Input() explanation = ''
    @Input() riskLevel: RiskLevel = RiskLevel.MEDIUM
    @Input() suggestions: string[] = []
    @ViewChild('cancelButton', { static: true }) cancelButton: ElementRef<HTMLButtonElement>

    @Output() confirmed = new EventEmitter<boolean>()

    constructor(public activeModal: NgbActiveModal) { }

    ngOnInit(): void {
        focusElementLater(this.cancelButton)
    }

    @HostListener('keydown', ['$event'])
    onKeyDown(event: KeyboardEvent): void {
        if (!isPlainEscape(event)) {
            return
        }

        event.preventDefault()
        this.cancel()
    }

    /**
     * 确认执行
     */
    confirm(): void {
        this.confirmed.emit(true)
        this.activeModal.close(true)
    }

    /**
     * 取消执行
     */
    cancel(): void {
        this.confirmed.emit(false)
        this.activeModal.dismiss(false)
    }

    /**
     * 获取风险级别文本
     */
    getRiskLevelText(): string {
        switch (this.riskLevel) {
            case RiskLevel.LOW:
                return '低风险'
            case RiskLevel.MEDIUM:
                return '中风险'
            case RiskLevel.HIGH:
                return '高风险'
            case RiskLevel.CRITICAL:
                return '极风险'
            default:
                return '未知风险'
        }
    }

    /**
     * 获取风险级别颜色
     */
    getRiskLevelColor(): string {
        switch (this.riskLevel) {
            case RiskLevel.LOW:
                return 'var(--ai-risk-low)'
            case RiskLevel.MEDIUM:
                return 'var(--ai-risk-medium)'
            case RiskLevel.HIGH:
                return 'var(--ai-risk-high)'
            case RiskLevel.CRITICAL:
                return 'var(--ai-risk-critical)'
            default:
                return 'var(--ai-secondary)'
        }
    }

    /**
     * 获取风险级别图标
     */
    getRiskLevelIcon(): string {
        switch (this.riskLevel) {
            case RiskLevel.LOW:
                return 'fa fa-check-circle'
            case RiskLevel.MEDIUM:
                return 'fa fa-exclamation-triangle'
            case RiskLevel.HIGH:
                return 'fa fa-exclamation-circle'
            case RiskLevel.CRITICAL:
                return 'fa fa-ban'
            default:
                return 'fa fa-question-circle'
        }
    }

    /**
     * 是否为高风险
     */
    isHighRisk(): boolean {
        return this.riskLevel === RiskLevel.HIGH || this.riskLevel === RiskLevel.CRITICAL
    }

    trackSuggestion(_index: number, suggestion: string): string {
        return suggestion
    }
}
