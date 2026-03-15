/* eslint-disable @typescript-eslint/explicit-module-boundary-types */
import { Component, Output, Input } from '@angular/core'
import { Subject } from 'rxjs'
import { getRuntimePlatform } from 'tabby-core'

/** @hidden */
@Component({
    standalone: false,
    selector: 'environment-editor',
    templateUrl: './environmentEditor.component.pug',
    styleUrls: ['./environmentEditor.component.scss'],
})
export class EnvironmentEditorComponent {
    @Output() modelChange = new Subject<Record<string, string>>()
    vars: { key: string, value: string }[] = []
    private cachedModel: Record<string, string> = {}

    @Input() get model (): Record<string, string> {
        return this.cachedModel
    }

    set model (value: Record<string, string> | null | undefined) {
        const normalizedValue = value ?? {}
        this.vars = Object.entries(normalizedValue).map(([k, v]) => ({ key: k, value: v }))
        this.cachedModel = this.getModel()
    }

    getModel (): Record<string, string> {
        const model: Record<string, string> = {}
        for (const pair of this.vars) {
            model[pair.key] = pair.value
        }
        return model
    }

    emitUpdate () {
        this.cachedModel = this.getModel()
        this.modelChange.next(this.cachedModel)
    }

    addEnvironmentVar () {
        this.vars.push({ key: '', value: '' })
    }

    removeEnvironmentVar (key: string) {
        this.vars = this.vars.filter(x => x.key !== key)
        this.emitUpdate()
    }

    shouldShowExample (): boolean {
        return !this.vars.find(v => v.key.toLowerCase() === 'path')
    }

    addExample (): void {
        const value = getRuntimePlatform() === 'win32' ? 'C:\\Program Files\\Custom:%PATH%' : '/opt/custom:$PATH'
        this.vars.push({ key: 'PATH', value })
        this.emitUpdate()
    }
}
