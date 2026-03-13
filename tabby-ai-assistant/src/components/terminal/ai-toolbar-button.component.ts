import { Component, Input, OnInit, OnDestroy } from '@angular/core'
import { Subject } from 'rxjs'
import { takeUntil } from 'rxjs/operators'
import { AiSidebarService } from '../../services/chat/ai-sidebar.service'
import { TranslateService } from 'tabby-core'

/**
 * AI工具栏按钮组件
 * 在Tabby工具栏显示AI助手按钮
 */
@Component({
    selector: 'ai-toolbar-button',
    standalone: false,
    templateUrl: './ai-toolbar-button.component.html',
    styleUrls: ['./ai-toolbar-button.component.scss'],
})
export class AiToolbarButtonComponent implements OnInit, OnDestroy {
    @Input() label = 'AI Assistant'
    @Input() tooltip = 'Open AI Assistant'
    @Input() showLabel = true

    private destroy$ = new Subject<void>()

    constructor(
        private sidebarService: AiSidebarService,
        private translate: TranslateService,
    ) {
        this.label = this.translate.instant('AI Assistant')
        this.tooltip = this.translate.instant('Open AI Assistant')
    }

    ngOnInit(): void {
        this.translate.onLangChange.pipe(
            takeUntil(this.destroy$),
        ).subscribe(() => {
            this.label = this.translate.instant('AI Assistant')
            this.tooltip = this.translate.instant('Open AI Assistant')
        })
    }

    ngOnDestroy(): void {
        this.destroy$.next()
        this.destroy$.complete()
    }

    onClick(): void {
        this.sidebarService.toggle()
    }
}
