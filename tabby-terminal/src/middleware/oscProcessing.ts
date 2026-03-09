import * as os from 'os'
import { Subject, Observable } from 'rxjs'
import { SessionMiddleware } from '../api/middleware'

const OSCPrefix = '\x1b]'
const OSCSuffixes = ['\x07', '\x1b\\']

export class OSCProcessor extends SessionMiddleware {
    get cwdReported$ (): Observable<string> { return this.cwdReported }

    private cwdReported = new Subject<string>()

    feedFromSession (data: Buffer): void {
        let startIndex = 0
        while (data.includes(OSCPrefix, startIndex)) {
            const si = startIndex
            if (!OSCSuffixes.some(s => data.includes(s, si))) {
                break
            }

            const params = data.subarray(data.indexOf(OSCPrefix, startIndex) + OSCPrefix.length)

            const [closesSuffix, closestSuffixIndex] = OSCSuffixes
                .map((suffix): [string, number] => [suffix, params.indexOf(suffix)])
                .filter(([_, index]) => index !== -1)
                .sort(([_, a], [__, b]) => a - b)[0]

            const oscString = params.subarray(0, closestSuffixIndex).toString()

            startIndex = data.indexOf(closesSuffix, startIndex) + closesSuffix.length

            const [oscCodeString, ...oscParams] = oscString.split(';')
            const oscCode = parseInt(oscCodeString)

            if (oscCode === 1337) {
                const paramString = oscParams.join(';')
                if (paramString.startsWith('CurrentDir=')) {
                    const reportedCWD = this.normalizeReportedCWD(paramString.split('=')[1])
                    if (reportedCWD) {
                        this.cwdReported.next(reportedCWD)
                    }
                } else {
                    console.debug('Unsupported OSC 1337 parameter:', paramString)
                }
            } else if (oscCode === 7) {
                const reportedCWD = this.parseOSC7CurrentDir(oscParams.join(';'))
                if (reportedCWD) {
                    this.cwdReported.next(reportedCWD)
                } else {
                    console.debug('Unsupported OSC 7 parameter:', oscParams.join(';'))
                }
            } else {
                continue
            }
        }
        super.feedFromSession(data)
    }

    close (): void {
        this.cwdReported.complete()
        super.close()
    }

    private normalizeReportedCWD (reportedCWD?: string): string|null {
        if (!reportedCWD) {
            return null
        }

        if (reportedCWD.startsWith('~')) {
            return os.homedir() + reportedCWD.substring(1)
        }

        return reportedCWD
    }

    private parseOSC7CurrentDir (uri: string): string|null {
        if (!uri.startsWith('file://')) {
            return null
        }

        try {
            return this.normalizeReportedCWD(decodeURIComponent(new URL(uri).pathname))
        } catch {
            return null
        }
    }
}
