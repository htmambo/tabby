/* eslint-disable @typescript-eslint/explicit-module-boundary-types */
import { Component } from '@angular/core'
import { Observable, OperatorFunction, debounceTime, distinctUntilChanged, map } from 'rxjs'
import { FullyDefined, HostAppService, Platform, ProfileSettingsComponent } from 'tabby-core'
import { SerialPortInfo, BAUD_RATES, SerialProfile } from '../api'
import { SerialService } from '../services/serial.service'
import { SerialProfilesService } from '../profiles'

/** @hidden */
@Component({
    standalone: false,
    templateUrl: './serialProfileSettings.component.pug',
})
export class SerialProfileSettingsComponent implements ProfileSettingsComponent<SerialProfile, SerialProfilesService> {
    profile: FullyDefined<SerialProfile>
    foundPorts: SerialPortInfo[]
    Platform = Platform

    constructor (
        private serial: SerialService,
        public hostApp: HostAppService,
    ) { }

    portsAutocomplete: OperatorFunction<string, string[]> = (text$: Observable<string>) => text$.pipe(map(() => {
        return this.foundPorts.map(x => x.name)
    }))

    baudratesAutocomplete: OperatorFunction<string, Array<number | null>> = (text$: Observable<string>) => text$.pipe(
        debounceTime(200),
        distinctUntilChanged(),
        map((q: string) => [
            null,
            ...BAUD_RATES.filter(x => !q || x.toString().startsWith(q)),
        ]),
    )

    portsFormatter = (port: string | null) => {
        const p = this.foundPorts.find(x => x.name === port)
        if (p?.description) {
            return `${port} (${p.description})`
        }
        return port
    }

    async ngOnInit () {
        this.foundPorts = await this.serial.listPorts()
    }
}
