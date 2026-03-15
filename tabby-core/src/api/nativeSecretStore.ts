interface RendererIPCBridge {
    invoke: <T = any>(channel: string, ...args: any[]) => Promise<T>
}

type BridgeWindow = Window & {
    tabbyBridge?: {
        ipc?: RendererIPCBridge
    }
}

function getBridgeIPC (): RendererIPCBridge | undefined {
    if (typeof window === 'undefined') {
        return undefined
    }
    return (window as BridgeWindow).tabbyBridge?.ipc
}

function getKeytar (): typeof import('keytar') {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('keytar')
}

export async function getNativeSecret (service: string, account: string): Promise<string | null> {
    const ipc = getBridgeIPC()
    if (ipc) {
        return ipc.invoke<string | null>('bridge:keytar:get-password', service, account)
    }

    return getKeytar().getPassword(service, account)
}

export async function setNativeSecret (service: string, account: string, password: string): Promise<void> {
    const ipc = getBridgeIPC()
    if (ipc) {
        await ipc.invoke('bridge:keytar:set-password', service, account, password)
        return
    }

    await getKeytar().setPassword(service, account, password)
}

export async function deleteNativeSecret (service: string, account: string): Promise<boolean> {
    const ipc = getBridgeIPC()
    if (ipc) {
        return ipc.invoke<boolean>('bridge:keytar:delete-password', service, account)
    }

    return getKeytar().deletePassword(service, account)
}
