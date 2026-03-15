declare module 'native-process-working-directory' {
    export function getWorkingDirectoryFromPID(pid: number): string | null
}
