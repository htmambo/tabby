import { Component, Input, Output, EventEmitter } from '@angular/core'

@Component({
    selector: 'app-error-message',
    standalone: false,
    templateUrl: './error-message.component.html',
    styleUrls: ['./error-message.component.scss'],
})
export class ErrorMessageComponent {
    @Input() type: 'error' | 'warning' | 'info' | 'success' = 'error'
    @Input() title = ''
    @Input() message = ''
    @Input() details = ''
    @Input() dismissible = false

    @Output() dismissed = new EventEmitter<void>()

    getIconClass(): string {
        const icons: Record<string, string> = {
            error: 'icon-error',
            warning: 'icon-warning',
            info: 'icon-info',
            success: 'icon-success',
        }
        return icons[this.type] || 'icon-error'
    }

    onDismiss(): void {
        this.dismissed.emit()
    }
}
