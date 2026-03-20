import { animate, state, style, transition, trigger } from '@angular/animations'
import { NgIf } from '@angular/common'
import { Component, NgZone, OnDestroy } from '@angular/core'
import { Subscription } from 'rxjs'
import { ToastPackage, ToastrService } from 'ngx-toastr'

@Component({
    selector: '[toast-component]',
    standalone: true,
    imports: [NgIf],
    template: `
        <button *ngIf="options.closeButton" (click)="remove()" type="button" class="toast-close-button" aria-label="Close">
            <span aria-hidden="true">&times;</span>
        </button>
        <div *ngIf="title" [class]="options.titleClass" [attr.aria-label]="title">
            {{ title }} <ng-container *ngIf="duplicatesCount">[{{ duplicatesCount + 1 }}]</ng-container>
        </div>
        <div *ngIf="message && options.enableHtml" role="alert" [class]="options.messageClass" [innerHTML]="message"></div>
        <div *ngIf="message && !options.enableHtml" role="alert" [class]="options.messageClass" [attr.aria-label]="message">
            {{ message }}
        </div>
        <div *ngIf="options.progressBar">
            <div class="toast-progress" [style.width]="width + '%'" ></div>
        </div>
    `,
    animations: [
        trigger('flyInOut', [
            state('inactive', style({ opacity: 0 })),
            state('active', style({ opacity: 1 })),
            state('removed', style({ opacity: 0 })),
            transition('inactive => active', animate('{{ easeTime }}ms {{ easing }}')),
            transition('active => removed', animate('{{ easeTime }}ms {{ easing }}')),
        ]),
    ],
    host: {
        '(click)': 'tapToast()',
        '(mouseenter)': 'stickAround()',
        '(mouseleave)': 'delayedHideToast()',
        '[class]': 'toastClasses',
        '[@flyInOut]': 'state',
    },
})
export class Angular21CompatibleToastComponent implements OnDestroy {
    width = -1
    toastClasses = ''
    state = {
        value: 'inactive',
        params: {
            easeTime: 0 as string | number,
            easing: 'ease-in',
        },
    }
    message: string | null | undefined
    title: string | undefined
    options: ToastPackage['config']
    duplicatesCount?: number
    originalTimeout: number
    hideTime = 0

    private timeout: ReturnType<typeof setTimeout> | null = null
    private intervalId: ReturnType<typeof setInterval> | null = null
    private readonly sub: Subscription
    private readonly sub1: Subscription
    private readonly sub2: Subscription
    private readonly sub3: Subscription

    constructor (
        private toastrService: ToastrService,
        private toastPackage: ToastPackage,
        private ngZone: NgZone,
    ) {
        this.message = toastPackage.message
        this.title = toastPackage.title
        this.options = toastPackage.config
        this.originalTimeout = toastPackage.config.timeOut
        this.toastClasses = `${toastPackage.toastType} ${toastPackage.config.toastClass}`
        this.state = {
            value: 'inactive',
            params: {
                easeTime: this.toastPackage.config.easeTime,
                easing: 'ease-in',
            },
        }
        this.sub = toastPackage.toastRef.afterActivate().subscribe(() => {
            this.activateToast()
        })
        this.sub1 = toastPackage.toastRef.manualClosed().subscribe(() => {
            this.remove()
        })
        this.sub2 = toastPackage.toastRef.timeoutReset().subscribe(() => {
            this.resetTimeout()
        })
        this.sub3 = toastPackage.toastRef.countDuplicate().subscribe(count => {
            this.duplicatesCount = count
        })
    }

    ngOnDestroy (): void {
        this.sub.unsubscribe()
        this.sub1.unsubscribe()
        this.sub2.unsubscribe()
        this.sub3.unsubscribe()
        if (this.intervalId) {
            clearInterval(this.intervalId)
            this.intervalId = null
        }
        if (this.timeout) {
            clearTimeout(this.timeout)
            this.timeout = null
        }
    }

    activateToast (): void {
        this.state = { ...this.state, value: 'active' }
        if (!(this.options.disableTimeOut === true || this.options.disableTimeOut === 'timeOut') && this.options.timeOut) {
            this.outsideTimeout(() => this.remove(), this.options.timeOut)
            this.hideTime = Date.now() + this.options.timeOut
            if (this.options.progressBar) {
                this.outsideInterval(() => this.updateProgress(), 10)
            }
        }
    }

    updateProgress (): void {
        if (this.width === 0 || this.width === 100 || !this.options.timeOut) {
            return
        }
        const remaining = this.hideTime - Date.now()
        this.width = (remaining / this.options.timeOut) * 100
        if (this.options.progressAnimation === 'increasing') {
            this.width = 100 - this.width
        }
        if (this.width <= 0) {
            this.width = 0
        }
        if (this.width >= 100) {
            this.width = 100
        }
    }

    resetTimeout (): void {
        this.clearTimers()
        this.state = { ...this.state, value: 'active' }
        this.outsideTimeout(() => this.remove(), this.originalTimeout)
        this.options.timeOut = this.originalTimeout
        this.hideTime = Date.now() + (this.options.timeOut || 0)
        this.width = -1
        if (this.options.progressBar) {
            this.outsideInterval(() => this.updateProgress(), 10)
        }
    }

    remove (): void {
        if (this.state.value === 'removed') {
            return
        }
        if (this.timeout) {
            clearTimeout(this.timeout)
            this.timeout = null
        }
        this.state = { ...this.state, value: 'removed' }
        this.outsideTimeout(() => this.toastrService.remove(this.toastPackage.toastId), +this.toastPackage.config.easeTime)
    }

    tapToast (): void {
        if (this.state.value === 'removed') {
            return
        }
        this.toastPackage.triggerTap()
        if (this.options.tapToDismiss) {
            this.remove()
        }
    }

    stickAround (): void {
        if (this.state.value === 'removed') {
            return
        }
        if (this.options.disableTimeOut !== 'extendedTimeOut') {
            if (this.timeout) {
                clearTimeout(this.timeout)
                this.timeout = null
            }
            this.options.timeOut = 0
            this.hideTime = 0
            if (this.intervalId) {
                clearInterval(this.intervalId)
                this.intervalId = null
            }
            this.width = 0
        }
    }

    delayedHideToast (): void {
        if (
            (this.options.disableTimeOut === true || this.options.disableTimeOut === 'extendedTimeOut') ||
            this.options.extendedTimeOut === 0 ||
            this.state.value === 'removed'
        ) {
            return
        }
        this.outsideTimeout(() => this.remove(), this.options.extendedTimeOut)
        this.options.timeOut = this.options.extendedTimeOut
        this.hideTime = Date.now() + (this.options.timeOut || 0)
        this.width = -1
        if (this.options.progressBar) {
            this.outsideInterval(() => this.updateProgress(), 10)
        }
    }

    private outsideTimeout (func: () => void, timeout: number): void {
        this.ngZone.runOutsideAngular(() => {
            this.timeout = setTimeout(() => this.runInsideAngular(func), timeout)
        })
    }

    private outsideInterval (func: () => void, timeout: number): void {
        this.ngZone.runOutsideAngular(() => {
            this.intervalId = setInterval(() => this.runInsideAngular(func), timeout)
        })
    }

    private runInsideAngular (func: () => void): void {
        if (NgZone.isInAngularZone()) {
            func()
            return
        }
        this.ngZone.run(func)
    }

    private clearTimers (): void {
        if (this.timeout) {
            clearTimeout(this.timeout)
            this.timeout = null
        }
        if (this.intervalId) {
            clearInterval(this.intervalId)
            this.intervalId = null
        }
    }
}
