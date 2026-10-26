// Types for the Personal Vault file library. The implementation is JavaScript in
// index.mjs; this file exists so a TypeScript consumer does not have to treat
// every Vault call as `any`, which would defeat the point of a single access
// layer — an untyped boundary lets a route pass the wrong shape and only fail
// at runtime, in front of the user.

export interface VaultEntry {
  /** Path relative to the Vault root, always with forward slashes. */
  path: string;
  kind: 'file' | 'folder';
  sizeBytes: number;
  modifiedAt: string;
  changedAt: string;
}

export interface VaultFile extends VaultEntry {
  content: string;
}

export interface VaultBinary extends VaultEntry {
  content: Buffer;
}

export interface VaultAttachmentInput {
  name?: string;
  dataBase64?: string;
  dataUrl?: string;
  alt?: string;
  caption?: string;
}

export interface VaultAttachment {
  markdownPath: string;
  assetPath: string;
  sizeBytes: number;
}

export interface VaultCaptureResult {
  capturePath: string;
  path: string;
  title: string;
  assetCount: number;
  assets: VaultAttachment[];
}

export interface VaultMoveResult {
  from: string;
  to: string;
  assetsFrom?: string;
  assetsTo?: string;
}

export interface VaultSearchMatch {
  path: string;
  preview: string;
}

export interface CreateVaultOptions {
  /** Absolute path to the Vault folder. Required. */
  root: string;
  /** IANA zone used for capture folder names. Defaults to Australia/Sydney. */
  timeZone?: string;
}

export interface Vault {
  /** The resolved absolute root, after symlink resolution. */
  readonly root: string;
  readonly timeZone: string;

  cleanPath(relative?: string): string;
  fullPath(relative?: string): string;
  resolvePath(relative?: string): string;
  relativePath(absolutePath: string): string;
  isTextFile(relative: string): boolean;
  safeFileName(name: string): string;
  today(): string;

  info(relative?: string): Promise<VaultEntry>;
  list(relative?: string, recursive?: boolean, limit?: number): Promise<VaultEntry[]>;
  readText(relative: string): Promise<VaultFile>;
  readBinary(relative: string): Promise<VaultBinary>;
  writeText(relative: string, content: string, overwrite?: boolean): Promise<VaultFile>;
  appendText(relative: string, content: string): Promise<{ path: string; sizeBytes: number; modifiedAt: string }>;
  exists(relative: string): Promise<boolean>;
  ensureFolder(relative?: string): Promise<{ path: string; kind: 'folder' }>;

  move(fromRelative: string, toRelative: string): Promise<VaultMoveResult>;
  archivePath(relative: string): string;
  archive(relative: string): Promise<VaultMoveResult>;
  restore(relative: string): Promise<VaultMoveResult>;

  search(query: string, limit?: number): Promise<VaultSearchMatch[]>;

  attach(markdownPath: string, name: string, dataBase64: string): Promise<VaultAttachment>;

  capturePath(title: string): Promise<string>;
  captureNote(input: {
    input: string;
    title?: string;
    projectId?: string;
    intent?: string;
    attachments?: VaultAttachmentInput[];
  }): Promise<VaultCaptureResult>;
  captureAsset(input: {
    capturePath: string;
    attachments: VaultAttachmentInput[];
  }): Promise<{ capturePath: string; assetCount: number; assets: VaultAttachment[] }>;
}

export declare function createVault(options: CreateVaultOptions): Vault;
