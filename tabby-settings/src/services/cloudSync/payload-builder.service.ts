/**
 * Payload Builder Service
 *
 * Builds a SyncPayload from Tabby's ConfigService + ProfilesService,
 * and applies a SyncPayload back to them.
 *
 * Sync scope:
 *   - User profiles (from config.store.profiles)
 *   - Profile groups (from config.store.groups)
 *   - Custom group names (strings, not full groups)
 *   - A subset of settings (appearance, terminal, hotkeys, etc.)
 *   - Encrypted vault blob
 */

import { Injectable } from '@angular/core';
import { ConfigService } from 'tabby-core';
import type { Profile, ProfileGroup } from 'tabby-core';
import type { SyncPayload } from './domain/types';

/**
 * Settings subset synced across devices.
 * Only non-sensitive, user-preference settings are included.
 */
interface SyncedSettings {
  appearance?: {
    theme?: string;
    colorSchemeMode?: 'dark' | 'light' | 'system';
    fontSize?: number;
    fontFamily?: string;
    padding?: string;
    cursorStyle?: string;
    cursorBlink?: boolean;
  };
  terminal?: {
    bell?: string;
    scrollback?: number;
    background?: string;
    allowTransparency?: boolean;
  };
  hotkeys?: Record<string, string>;
  [key: string]: unknown;
}

/** @hidden */
@Injectable({ providedIn: 'root' })
export class CloudSyncPayloadBuilderService {
  constructor(
    private config: ConfigService,
  ) {}

  /**
   * Build a SyncPayload from current Tabby state.
   * Collects user profiles, groups, settings, and vault.
   */
  async buildPayload(): Promise<SyncPayload> {
    // User profiles only (not built-in)
    const profilesList = this.config.store.profiles ?? [];
    const hosts: Profile[] = profilesList.filter(
      (p: Profile) => p.type !== 'ssh' && p.type !== 'serial',
    );
    const keys: Profile[] = profilesList.filter(
      (p: Profile) => p.type === 'ssh',
    );

    // Profile groups
    const groups: ProfileGroup[] = this.config.store.groups ?? [];

    // Custom group IDs (strings that name groups but aren't full group objects)
    const customGroups: string[] = this.buildCustomGroups(profilesList, groups);

    // Settings subset
    const settings = this.buildSettings();

    // Vault (encrypted blob from existing vault system)
    const vault = this.config.store.vault ?? null;

    return {
      hosts,
      keys,
      groups,
      customGroups,
      settings,
      vault,
      syncedAt: Date.now(),
    };
  }

  /**
   * Apply a SyncPayload to Tabby state.
   * Merges the payload into the existing config.
   *
   * @param payload - The decrypted sync payload
   * @param replaceGroups - If true, replace all groups. If false, merge.
   * @param replaceSettings - If true, replace all settings. If false, merge.
   */
  async applyPayload(
    payload: SyncPayload,
    options?: { replaceGroups?: boolean; replaceSettings?: boolean },
  ): Promise<void> {
    const replaceGroups = options?.replaceGroups ?? false;
    const replaceSettings = options?.replaceSettings ?? false;

    // Merge profiles
    if (payload.hosts?.length !== undefined || payload.keys?.length !== undefined) {
      await this.applyProfiles(payload.hosts, payload.keys);
    }

    // Merge or replace groups
    if (payload.groups) {
      this.applyGroups(payload.groups, replaceGroups);
    }

    // Merge custom groups (no-op since customGroups is informational)
    // The actual group management is done through the groups array

    // Merge or replace settings
    if (payload.settings) {
      this.applySettings(payload.settings, replaceSettings);
    }

    // Apply vault if present
    if (payload.vault) {
      this.applyVault(payload.vault);
    }

    // Save
    await this.config.save();
  }

  // ==========================================================================
  // Private helpers
  // ==========================================================================

  /**
   * Build the subset of settings to sync.
   * Only includes user-facing preferences, not internal state.
   */
  private buildSettings(): SyncedSettings | undefined {
    const store = this.config.store as Record<string, unknown>;
    if (!store) return undefined;

    const synced: SyncedSettings = {};

    // Appearance settings
    const appearance = store.appearance as Record<string, unknown> | undefined;
    if (appearance) {
      synced.appearance = {
        theme: appearance.theme as string | undefined,
        colorSchemeMode: appearance.colorSchemeMode as 'dark' | 'light' | 'system' | undefined,
        fontSize: appearance.fontSize as number | undefined,
        fontFamily: appearance.fontFamily as string | undefined,
        padding: appearance.padding as string | undefined,
        cursorStyle: appearance.cursorStyle as string | undefined,
        cursorBlink: appearance.cursorBlink as boolean | undefined,
      };
      // Remove undefined keys
      Object.keys(synced.appearance).forEach(
        (k) => synced.appearance![k as keyof typeof synced.appearance] === undefined &&
          delete synced.appearance![k as keyof typeof synced.appearance],
      );
      if (Object.keys(synced.appearance!).length === 0) {
        delete synced.appearance;
      }
    }

    // Terminal settings
    const terminal = store.terminal as Record<string, unknown> | undefined;
    if (terminal) {
      synced.terminal = {
        bell: terminal.bell as string | undefined,
        scrollback: terminal.scrollback as number | undefined,
        background: terminal.background as string | undefined,
        allowTransparency: terminal.allowTransparency as boolean | undefined,
      };
      Object.keys(synced.terminal).forEach(
        (k) => synced.terminal![k as keyof typeof synced.terminal] === undefined &&
          delete synced.terminal![k as keyof typeof synced.terminal],
      );
      if (Object.keys(synced.terminal!).length === 0) {
        delete synced.terminal;
      }
    }

    // Hotkey profile
    if (store.hotkeys) {
      synced.hotkeys = store.hotkeys as Record<string, string>;
    }

    return Object.keys(synced).length > 0 ? synced : undefined;
  }

  /**
   * Build the list of custom group names (group IDs that aren't built-in).
   */
  private buildCustomGroups(
    profiles: Profile[],
    groups: ProfileGroup[],
  ): string[] {
    const groupIds = new Set(groups.map((g) => g.id));
    const customGroupIds = new Set<string>();

    for (const profile of profiles) {
      if (profile.group && !groupIds.has(profile.group)) {
        customGroupIds.add(profile.group);
      }
    }

    return [...customGroupIds];
  }

  /**
   * Apply profiles to the config store.
   * Merges with existing profiles by ID.
   */
  private async applyProfiles(hosts: Profile[] = [], keys: Profile[] = []): Promise<void> {
    const existing = (this.config.store.profiles ?? []) as Profile[];
    const merged = this.mergeProfilesById(existing, [...hosts, ...keys]);
    this.config.store.profiles = merged;
  }

  /**
   * Merge incoming profiles with existing ones, by ID.
   * Incoming profile wins on conflict (newer sync data).
   */
  private mergeProfilesById(
    existing: Profile[],
    incoming: Profile[],
  ): Profile[] {
    const byId = new Map<string, Profile>();

    // Add existing first
    for (const p of existing) {
      if (p.id) byId.set(p.id, p);
    }

    // Overlay incoming (wins on conflict)
    for (const p of incoming) {
      if (p.id) {
        const existingProfile = byId.get(p.id);
        if (existingProfile) {
          // Merge: keep existing for sensitive fields that shouldn't be overwritten
          byId.set(p.id, this.mergeProfile(existingProfile, p));
        } else {
          byId.set(p.id, p);
        }
      }
    }

    return [...byId.values()];
  }

  /**
   * Merge two profile objects. Sensitive fields from existing win.
   */
  private mergeProfile(existing: Profile, incoming: Profile): Profile {
    // Keep the existing profile's sensitive data (passwords, keys)
    // but take the non-sensitive fields from incoming
    return {
      ...incoming,
      // Preserve sensitive options from existing
      options: {
        ...incoming.options,
        // SSH-specific: keep existing auth credentials if incoming has none
        password: incoming.options?.password ?? existing.options?.password,
        privateKeys: (incoming.options?.privateKeys?.length ?? 0) > 0
          ? incoming.options.privateKeys
          : existing.options?.privateKeys,
      } as Profile['options'],
    };
  }

  /**
   * Apply groups to the config store.
   */
  private applyGroups(groups: ProfileGroup[], replace: boolean): void {
    if (replace) {
      this.config.store.groups = groups;
    } else {
      // Merge by ID
      const existing = (this.config.store.groups ?? []) as ProfileGroup[];
      const byId = new Map<string, ProfileGroup>();
      for (const g of existing) {
        byId.set(g.id, g);
      }
      for (const g of groups) {
        byId.set(g.id, g);
      }
      this.config.store.groups = [...byId.values()];
    }
  }

  /**
   * Apply settings to the config store.
   */
  private applySettings(settings: SyncedSettings, replace: boolean): void {
    if (replace) {
      if (settings.appearance) {
        this.config.store.appearance = {
          ...(this.config.store.appearance ?? {}),
          ...settings.appearance,
        };
      }
      if (settings.terminal) {
        this.config.store.terminal = {
          ...(this.config.store.terminal ?? {}),
          ...settings.terminal,
        };
      }
      if (settings.hotkeys) {
        this.config.store.hotkeys = settings.hotkeys;
      }
    } else {
      // Shallow merge: incoming wins
      if (settings.appearance) {
        this.config.store.appearance = {
          ...(this.config.store.appearance ?? {}),
          ...settings.appearance,
        };
      }
      if (settings.terminal) {
        this.config.store.terminal = {
          ...(this.config.store.terminal ?? {}),
          ...settings.terminal,
        };
      }
      if (settings.hotkeys) {
        this.config.store.hotkeys = {
          ...(this.config.store.hotkeys ?? {}),
          ...settings.hotkeys,
        };
      }
    }
  }

  /**
   * Apply vault data.
   */
  private applyVault(vault: unknown): void {
    this.config.store.vault = vault;
  }
}
