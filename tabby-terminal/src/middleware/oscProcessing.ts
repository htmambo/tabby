import * as os from 'os'
import { Subject, Observable } from 'rxjs'
import { SessionMiddleware } from '../api/middleware'

const OSCPrefix = '\x1b]'
const OSCSuffixes = ['\x07', '\x1b\\']

export class OSCProcessor extends SessionMiddleware {
    get cwdReported$ (): Observable<string> { return this.cwdReported }

    private cwdReported = new Subject<string>()
    private buffer: Buffer | null = null

    feedFromSession (data: Buffer): void {
        // Prepend any buffered data from previous chunks
        if (this.buffer) {
            data = Buffer.concat([this.buffer, data])
            this.buffer = null
        }

        let startIndex = 0
        const processedData: Buffer[] = []

        while (startIndex < data.length) {
            const prefixIndex = data.indexOf(OSCPrefix, startIndex)

            if (prefixIndex === -1) {
                // No more OSC sequences, pass remaining data
                if (startIndex < data.length) {
                    processedData.push(data.subarray(startIndex))
                }
                break
            }

            // Pass data before this OSC sequence
            if (prefixIndex > startIndex) {
                processedData.push(data.subarray(startIndex, prefixIndex))
            }

            // Look for suffix after the prefix
            const suffixSearchStart = prefixIndex + OSCPrefix.length
            let foundSuffix: [Buffer, number] | null = null

            for (const suffix of OSCSuffixes) {
                const suffixIndex = data.indexOf(suffix, suffixSearchStart)
                if (suffixIndex !== -1) {
                    if (!foundSuffix || suffixIndex < foundSuffix[1]) {
                        foundSuffix = [suffix, suffixIndex]
                    }
                }
            }

            if (!foundSuffix) {
                // No suffix found - buffer the rest and wait for next chunk
                this.buffer = data.subarray(prefixIndex)
                break
            }

            // Extract OSC string (between prefix and suffix)
            const oscString = data.subarray(suffixSearchStart, foundSuffix[1]).toString()
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
            }

            // Move past this OSC sequence
            startIndex = foundSuffix[1] + foundSuffix[0].length
        }

        // Pass through all processed data
        if (processedData.length > 0) {
            super.feedFromSession(Buffer.concat(processedData))
        }
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
