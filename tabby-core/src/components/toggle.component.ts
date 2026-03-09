import { Component } from '@angular/core'
import { NG_VALUE_ACCESSOR } from '@angular/forms'
import { CheckboxComponent } from './checkbox.component'

/** @hidden */
@Component({
    standalone: false,
    selector: 'toggle',
    template: `
    <label class="form-check form-switch">
      <input
        type="checkbox"
        class="form-check-input"
        [checked]="!!model"
        [disabled]="disabled"
        (change)="onInputChange($event)"
        (blur)="markTouched()"
      >
      <span class="form-check-label"></span>
    </label>
    `,
    styleUrls: ['./toggle.component.scss'],
    providers: [
        { provide: NG_VALUE_ACCESSOR, useExisting: ToggleComponent, multi: true },
    ],
})
export class ToggleComponent extends CheckboxComponent {
}
