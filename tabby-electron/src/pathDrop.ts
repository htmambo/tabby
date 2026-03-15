import { Injectable } from '@angular/core'
import { TerminalDecorator, BaseTerminalTabComponent } from 'tabby-terminal'
import { getTabbyBridge } from '../../app/src/tabby-bridge'

/** @hidden */
@Injectable()
export class PathDropDecorator extends TerminalDecorator {
    private webUtils = getTabbyBridge().webUtils

    attach (terminal: BaseTerminalTabComponent<any>): void {
        const timer = setTimeout(() => {
            this.subscribeUntilDetached(terminal, terminal.frontend?.dragOver$.subscribe(event => {
                event.preventDefault()
            }))
            this.subscribeUntilDetached(terminal, terminal.frontend?.drop$.subscribe((event: DragEvent) => {
                for (const file of event.dataTransfer!.files as unknown as Iterable<File>) {
                    this.injectPath(terminal, this.webUtils.getPathForFile(file))
                }
                event.preventDefault()
            }))
        })
        if (typeof timer === 'object' && typeof timer.unref === 'function') {
            timer.unref()
        }
    }

    private injectPath (terminal: BaseTerminalTabComponent<any>, path: string) {
        if (path.includes(' ')) {
            path = `"${path}"`
        }
        path = path.replaceAll('\\', '\\\\')
        terminal.sendInput(path + ' ')
    }
}
