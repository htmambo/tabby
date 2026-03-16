var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
/* eslint-disable @typescript-eslint/explicit-module-boundary-types */
import { NgModule } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';
import { ToastrModule } from 'ngx-toastr';
function patchZoneAwareRequestAnimationFrame() {
    const zone = window.Zone;
    const zoneSymbol = zone?.__symbol__?.('requestAnimationFrame');
    if (!zoneSymbol) {
        return;
    }
    const windowAny = window;
    const zoneRequestAnimationFrame = windowAny[zoneSymbol];
    if (typeof zoneRequestAnimationFrame === 'function') {
        window.requestAnimationFrame = zoneRequestAnimationFrame;
    }
}
export function getRootModule(plugins) {
    const imports = [
        BrowserModule,
        ...plugins,
        ToastrModule.forRoot({
            positionClass: 'toast-bottom-center',
            toastClass: 'toast',
            preventDuplicates: true,
            extendedTimeOut: 1000,
        }),
    ];
    const bootstrap = [
        ...plugins.filter(x => x.bootstrap).map(x => x.bootstrap),
    ];
    if (bootstrap.length === 0) {
        throw new Error('Did not find any bootstrap components. Are there any plugins installed?');
    }
    let RootModule = class RootModule {
        constructor() {
            patchZoneAwareRequestAnimationFrame();
        }
    };
    RootModule = __decorate([
        NgModule({
            imports,
            bootstrap,
        }),
        __metadata("design:paramtypes", [])
    ], RootModule);
    return RootModule;
}
//# sourceMappingURL=app.module.js.map