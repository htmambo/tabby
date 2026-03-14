import { Injectable } from '@angular/core'
import { BehaviorSubject, Observable, Subject } from 'rxjs'

@Injectable({ providedIn: 'root' })
export class WorkspaceLayoutService {
    private royalSidebarTransitionToken = 0
    private royalSidebarTransitionActive = new BehaviorSubject(false)
    private royalSidebarTransitionCompleted = new Subject<number>()

    get royalSidebarTransitionActive$ (): Observable<boolean> {
        return this.royalSidebarTransitionActive
    }

    get royalSidebarTransitionCompleted$ (): Observable<number> {
        return this.royalSidebarTransitionCompleted
    }

    get isRoyalSidebarTransitionActive (): boolean {
        return this.royalSidebarTransitionActive.value
    }

    beginRoyalSidebarTransition (): number {
        const token = ++this.royalSidebarTransitionToken
        if (!this.royalSidebarTransitionActive.value) {
            this.royalSidebarTransitionActive.next(true)
        }
        return token
    }

    finishRoyalSidebarTransition (token: number): void {
        if (token !== this.royalSidebarTransitionToken || !this.royalSidebarTransitionActive.value) {
            return
        }
        this.royalSidebarTransitionActive.next(false)
        this.royalSidebarTransitionCompleted.next(token)
    }
}
