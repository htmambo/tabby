/* eslint-disable @typescript-eslint/explicit-module-boundary-types */
import { Component, Input, HostBinding } from '@angular/core'
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms'

/** @hidden */
@Component({
    standalone: false,
    selector: 'checkbox',
    template: `
        <label class="form-check form-checkbox">
            <input
                type="checkbox"
                class="form-check-input"
                [checked]="!!model"
                [disabled]="disabled"
                (change)="onInputChange($event)"
                (blur)="markTouched()"
            >
            <span class="form-check-label">{{text}}</span>
        </label>
    `,
    providers: [
        { provide: NG_VALUE_ACCESSOR, useExisting: CheckboxComponent, multi: true },
    ],
})
export class CheckboxComponent implements ControlValueAccessor {
    @HostBinding('class.active') @Input() model: boolean
    @HostBinding('class.disabled') @Input() disabled: boolean
    @Input() text: string
    private onChange: (val: boolean) => void = () => undefined
    private onTouched: () => void = () => undefined

    onInputChange (event: Event): void {
        if (this.disabled) {
            return
        }

        this.model = (event.target as HTMLInputElement).checked
        this.onChange(this.model)
        this.markTouched()
    }

    markTouched (): void {
        this.onTouched()
    }

    writeValue (obj: any) {
        this.model = !!obj
    }

    registerOnChange (fn: any): void {
        this.onChange = fn
    }

    registerOnTouched (fn: any): void {
        this.onTouched = fn
    }

    setDisabledState (isDisabled: boolean) {
        this.disabled = isDisabled
    }
}
