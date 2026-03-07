import * as localPath from 'path'
import { PlatformService } from 'tabby-core'
import { SSHProfile } from './api'

export function resolveSFTPRemoteStartPath (profile: SSHProfile, fallbackPath?: string|null): string {
    const configuredPath = profile.options.sftpDefaultPath?.trim()
    if (configuredPath) {
        return configuredPath
    }
    return fallbackPath?.trim() ?? '/'
}

export async function resolveSFTPLocalStartPath (platform: PlatformService, profile: SSHProfile): Promise<string|null> {
    const configuredPath = profile.options.sftpLocalDefaultPath?.trim()
    const homeDirectory = await platform.getDefaultLocalDirectory()

    if (!configuredPath) {
        return homeDirectory
    }
    if (!homeDirectory) {
        return configuredPath
    }
    if (configuredPath === '~' || configuredPath === '${home}') {
        return homeDirectory
    }
    if (configuredPath.startsWith('~/') || configuredPath.startsWith('~\\')) {
        return localPath.join(homeDirectory, configuredPath.slice(2))
    }
    if (configuredPath.startsWith('${home}/') || configuredPath.startsWith('${home}\\')) {
        return localPath.join(homeDirectory, configuredPath.slice(8))
    }
    if (localPath.isAbsolute(configuredPath)) {
        return configuredPath
    }
    return localPath.join(homeDirectory, configuredPath)
}
