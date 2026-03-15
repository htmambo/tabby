import { PartialProfile, Profile } from './profileProvider'

export abstract class SFTPTabOpener {
    abstract openForProfile (profile: PartialProfile<Profile>): Promise<void>
}
