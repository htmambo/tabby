import { Component, Input } from '@angular/core'
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap'

import { RecoveredTabEntry } from '../services/tabRecovery.service'

/** @hidden */
@Component({
    standalone: false,
    selector: 'startup-tabs-recovery-modal',
    templateUrl: './startupTabsRecoveryModal.component.pug',
    styleUrls: ['./startupTabsRecoveryModal.component.scss'],
})
export class StartupTabsRecoveryModalComponent {
    @Input() entries: RecoveredTabEntry[] = []

    selection: boolean[] = []

    constructor (
        public modalInstance: NgbActiveModal,
    ) { }

    ngOnInit (): void {
        this.selection = this.entries.map(() => true)
    }

    get hasSelection (): boolean {
        return this.selection.some(Boolean)
    }

    get selectedCount (): number {
        return this.selection.filter(Boolean).length
    }

    selectAll (): void {
        this.selection = this.selection.map(() => true)
    }

    clearAll (): void {
        this.selection = this.selection.map(() => false)
    }

    restore (): void {
        this.modalInstance.close(this.selection)
    }

    skip (): void {
        this.modalInstance.close(null)
    }
}
