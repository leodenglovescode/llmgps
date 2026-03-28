import "server-only";

import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  randomUUID,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import {
  buildProxyUrl,
  defaultCustomEndpointConfig,
  defaultOllamaConfig,
  defaultRoutingPreferences,
  defaultProxyConfig,
  defaultWebSearchConfig,
  sanitizeCustomEndpointConfig,
  sanitizeLanguage,
  sanitizeOllamaConfig,
  sanitizeRoutingPreferences,
  sanitizeProxyConfig,
  sanitizeWebSearchConfig,
  type AppStatusPayload,
  type CustomEndpointConfig,
  type Language,
  type OllamaConfig,
  type ProxyConfig,
  type RoutingPreferencesPayload,
  type WebSearchConfig,
} from "@/lib/app-config";
import {
  buildConversationSummary,
  sanitizeConversationMessages,
  sanitizeGpsResponsePayload,
  type ConversationMessage,
  type ConversationRecord,
  type ConversationSummary,
} from "@/lib/chat-history";
import { PROVIDER_PRESETS, type ProviderId } from "@/lib/llm";

type PasswordRecord = {
  hash: string;
  salt: string;
};

type OwnerRecord = {
  apiKeys: Partial<Record<ProviderId, string>>;
  customEndpointConfig: CustomEndpointConfig;
  language: Language;
  ollamaConfig: OllamaConfig;
  password: PasswordRecord;
  proxyConfig: ProxyConfig;
  routingPreferences: RoutingPreferencesPayload;
  shouldPromptForApiKeys: boolean;
  username: string;
  webSearchConfig: WebSearchConfig;
};

type StoreRecord = {
  owner: OwnerRecord | null;
  sessionSecret: string;
};

type OwnerSecrets = {
  apiKeys: Partial<Record<ProviderId, string>>;
  customEndpointConfig?: CustomEndpointConfig;
  language?: Language;
  ollamaConfig: OllamaConfig;
  proxyConfig: ProxyConfig;
  routingPreferences: RoutingPreferencesPayload;
  sessionSecret: string;
  webSearchConfig: WebSearchConfig;
};

type OwnerRow = {
  password_hash: string;
  password_salt: string;
  secrets: string;
  should_prompt_for_api_keys: number;
  username: string;
};

type LegacyStoreFile = {
  owner?: {
    apiKeys?: Partial<Record<ProviderId, string>>;
    password?: PasswordRecord;
    proxyConfig?: Partial<ProxyConfig>;
    shouldPromptForApiKeys?: boolean;
    username?: string;
  } | null;
  sessionSecret?: string;
};

type SettingsUpdate = {
  apiKeys?: Partial<Record<ProviderId, string | null>>;
  customEndpointConfig?: CustomEndpointConfig;
  language?: Language;
  ollamaConfig?: Partial<OllamaConfig>;
  proxyConfig?: Partial<ProxyConfig>;
  routingPreferences?: Partial<RoutingPreferencesPayload>;
  webSearchConfig?: Partial<WebSearchConfig>;
};

type ConversationRow = {
  created_at: string;
  id: string;
  payload: string;
  updated_at: string;
};

type ConversationPayload = {
  lastRun: ConversationRecord["lastRun"];
  messages: ConversationMessage[];
  preview: string;
  title: string;
  compressedContext: ConversationRecord["compressedContext"];
  compressionHistory: ConversationRecord["compressionHistory"];
};

type StoragePaths = {
  databasePath: string;
  keyPath: string;
  legacyJsonPath: string | null;
};

const DEFAULT_DATABASE_FILE_NAME = ".llmgps-data.sqlite";
const DEFAULT_KEY_FILE_NAME = ".llmgps-data.key";
const DEFAULT_DOCKER_DATA_DIR = "/data";
const ENCRYPTION_ENVELOPE_VERSION = 1;
const SQLITE_USER_VERSION = 1;
const apiKeyProviderIds = new Set(
  PROVIDER_PRESETS.filter((provider) => provider.authStrategy === "api-key").map((provider) => provider.id),
);

let databasePromise: Promise<DatabaseSync> | null = null;
let encryptionSecretPromise: Promise<string> | null = null;

function isContainerizedRuntime() {
  return process.env.LLMGPS_CONTAINERIZED === "true";
}

function getLegacyLocalKeyPath() {
  return path.join(os.homedir(), ".llmgps", "llmgps-data.key");
}

function resolveStoragePaths(): StoragePaths {
  const configuredPath = process.env.LLMGPS_DATA_FILE?.trim();

  if (!configuredPath) {
    if (isContainerizedRuntime()) {
      return {
        databasePath: path.join(DEFAULT_DOCKER_DATA_DIR, DEFAULT_DATABASE_FILE_NAME),
        keyPath: path.join(DEFAULT_DOCKER_DATA_DIR, DEFAULT_KEY_FILE_NAME),
        legacyJsonPath: path.join(process.cwd(), ".llmgps-data.json"),
      };
    }

    return {
      databasePath: path.join(process.cwd(), DEFAULT_DATABASE_FILE_NAME),
      keyPath: path.join(process.cwd(), DEFAULT_KEY_FILE_NAME),
      legacyJsonPath: path.join(process.cwd(), ".llmgps-data.json"),
    };
  }

  const resolvedPath = path.isAbsolute(configuredPath)
    ? configuredPath
    : path.resolve(process.cwd(), configuredPath);

  if (resolvedPath.endsWith(".json")) {
    const parsed = path.parse(resolvedPath);
    return {
      databasePath: path.join(parsed.dir, `${parsed.name}.sqlite`),
      keyPath: path.join(parsed.dir, `${parsed.name}.key`),
      legacyJsonPath: resolvedPath,
    };
  }

  const parsed = path.parse(resolvedPath);
  const legacyBaseName = parsed.ext ? parsed.name : parsed.base;

  return {
    databasePath: resolvedPath,
    keyPath: path.join(parsed.dir, `${legacyBaseName}.key`),
    legacyJsonPath: path.join(parsed.dir, `${legacyBaseName}.json`),
  };
}

async function getEncryptionSecret() {
  if (!encryptionSecretPromise) {
    encryptionSecretPromise = loadEncryptionSecret();
  }

  return encryptionSecretPromise;
}

async function loadEncryptionSecret() {
  const configuredSecret = process.env.LLMGPS_DATA_KEY?.trim();
  if (configuredSecret) {
    return configuredSecret;
  }

  const configuredSecretFile = process.env.LLMGPS_DATA_KEY_FILE?.trim();
  if (configuredSecretFile) {
    const raw = await fs.readFile(configuredSecretFile, "utf8");
    const trimmed = raw.trim();

    if (!trimmed) {
      throw new Error(`Encryption key file is empty: ${configuredSecretFile}`);
    }

    return trimmed;
  }

  const { keyPath } = resolveStoragePaths();

  if (isContainerizedRuntime()) {
    throw new Error(
      "Containerized runs require LLMGPS_DATA_KEY or LLMGPS_DATA_KEY_FILE. Do not persist a generated key file next to the database in Docker.",
    );
  }

  try {
    const raw = await fs.readFile(keyPath, "utf8");
    const trimmed = raw.trim();

    if (!trimmed) {
      throw new Error(`Encryption key file is empty: ${keyPath}`);
    }

    return trimmed;
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError.code !== "ENOENT") {
      throw error;
    }
  }

  const generatedSecret = randomBytes(32).toString("hex");
  await fs.mkdir(path.dirname(keyPath), { recursive: true });
  await fs.writeFile(keyPath, `${generatedSecret}\n`, { encoding: "utf8", mode: 0o600 });
  return generatedSecret;
}

async function readOptionalKeyFile(filePath: string) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const trimmed = raw.trim();
    return trimmed || null;
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError.code === "ENOENT") {
      return null;
    }

    throw error;
  }
}

async function persistEncryptionSecret(secret: string) {
  const configuredSecret = process.env.LLMGPS_DATA_KEY?.trim();
  const configuredSecretFile = process.env.LLMGPS_DATA_KEY_FILE?.trim();

  if (configuredSecret || configuredSecretFile || isContainerizedRuntime()) {
    encryptionSecretPromise = Promise.resolve(secret);
    return;
  }

  const { keyPath } = resolveStoragePaths();
  await fs.mkdir(path.dirname(keyPath), { recursive: true });
  await fs.writeFile(keyPath, `${secret}\n`, { encoding: "utf8", mode: 0o600 });
  encryptionSecretPromise = Promise.resolve(secret);
}

async function getDecryptionSecrets() {
  const primarySecret = await getEncryptionSecret();
  const configuredSecret = process.env.LLMGPS_DATA_KEY?.trim();
  const configuredSecretFile = process.env.LLMGPS_DATA_KEY_FILE?.trim();

  if (configuredSecret || configuredSecretFile || isContainerizedRuntime()) {
    return [{ secret: primarySecret, source: "configured" as const }];
  }

  const legacySecret = await readOptionalKeyFile(getLegacyLocalKeyPath());
  if (!legacySecret || legacySecret === primarySecret) {
    return [{ secret: primarySecret, source: "primary" as const }];
  }

  return [
    { secret: primarySecret, source: "primary" as const },
    { secret: legacySecret, source: "legacy-local" as const },
  ];
}

async function getDatabase() {
  if (!databasePromise) {
    databasePromise = initializeDatabase();
  }

  return databasePromise;
}

async function initializeDatabase() {
  const { databasePath, legacyJsonPath } = resolveStoragePaths();
  await fs.mkdir(path.dirname(databasePath), { recursive: true });

  const database = new DatabaseSync(databasePath);
  await fs.chmod(databasePath, 0o600).catch((error) => {
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError.code !== "ENOENT") {
      throw error;
    }
  });

  database.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;
    PRAGMA foreign_keys = ON;
    PRAGMA secure_delete = ON;
    PRAGMA user_version = ${SQLITE_USER_VERSION};

    CREATE TABLE IF NOT EXISTS owner (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      password_salt TEXT NOT NULL,
      should_prompt_for_api_keys INTEGER NOT NULL DEFAULT 1,
      secrets TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      payload TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS conversations_updated_at_idx ON conversations(updated_at DESC);
  `);

  await migrateLegacyJsonStore(database, legacyJsonPath);

  return database;
}

function hashPassword(password: string, salt = randomBytes(16).toString("hex")) {
  const hash = scryptSync(password, salt, 64).toString("hex");
  return { hash, salt } satisfies PasswordRecord;
}

function verifyPassword(password: string, passwordRecord: PasswordRecord) {
  const computed = Buffer.from(scryptSync(password, passwordRecord.salt, 64).toString("hex"), "hex");
  const stored = Buffer.from(passwordRecord.hash, "hex");

  return computed.length === stored.length && timingSafeEqual(computed, stored);
}

function sanitizeApiKeys(input?: Partial<Record<ProviderId, string>> | null) {
  const next: Partial<Record<ProviderId, string>> = {};

  if (!input) {
    return next;
  }

  for (const [providerId, value] of Object.entries(input)) {
    if (!apiKeyProviderIds.has(providerId as ProviderId) || typeof value !== "string") {
      continue;
    }

    const trimmedValue = value.trim();
    if (trimmedValue) {
      next[providerId as ProviderId] = trimmedValue;
    }
  }

  return next;
}

function getConfiguredProviders(apiKeys: Partial<Record<ProviderId, string>>) {
  return PROVIDER_PRESETS.filter((provider) => {
    if (provider.id === "ollama") {
      return false;
    }

    return Boolean(apiKeys[provider.id]);
  }).map((provider) => provider.id);
}

function selectOwnerRow(database: DatabaseSync) {
  return database.prepare<OwnerRow>(`
    SELECT username, password_hash, password_salt, should_prompt_for_api_keys, secrets
    FROM owner
    WHERE id = 1
  `).get();
}

function runInTransaction<T>(database: DatabaseSync, callback: () => T) {
  database.exec("BEGIN IMMEDIATE");

  try {
    const result = callback();
    database.exec("COMMIT");
    return result;
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

async function encryptSecrets(secrets: OwnerSecrets) {
  const payload = {
    apiKeys: sanitizeApiKeys(secrets.apiKeys),
    customEndpointConfig: sanitizeCustomEndpointConfig(secrets.customEndpointConfig),
    language: sanitizeLanguage(secrets.language),
    ollamaConfig: sanitizeOllamaConfig(secrets.ollamaConfig),
    proxyConfig: sanitizeProxyConfig(secrets.proxyConfig),
    routingPreferences: sanitizeRoutingPreferences(secrets.routingPreferences),
    sessionSecret: secrets.sessionSecret,
    webSearchConfig: sanitizeWebSearchConfig(secrets.webSearchConfig),
  } satisfies OwnerSecrets;

  return encryptPayload(payload);
}

async function encryptPayload(payload: unknown) {
  const secret = await getEncryptionSecret();
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = scryptSync(secret, salt, 32);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const serializedPayload = JSON.stringify(payload);

  const ciphertext = Buffer.concat([cipher.update(serializedPayload, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return JSON.stringify({
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    salt: salt.toString("base64"),
    tag: tag.toString("base64"),
    version: ENCRYPTION_ENVELOPE_VERSION,
  });
}

async function decryptSecrets(rawEnvelope: string): Promise<OwnerSecrets> {
  const payload = (await decryptPayload(rawEnvelope)) as Partial<OwnerSecrets>;

  return {
    apiKeys: sanitizeApiKeys(payload.apiKeys),
    customEndpointConfig: sanitizeCustomEndpointConfig(payload.customEndpointConfig),
    language: sanitizeLanguage(payload.language),
    ollamaConfig: sanitizeOllamaConfig(payload.ollamaConfig),
    proxyConfig: sanitizeProxyConfig(payload.proxyConfig),
    routingPreferences: sanitizeRoutingPreferences(payload.routingPreferences),
    sessionSecret:
      typeof payload.sessionSecret === "string" && payload.sessionSecret.trim()
        ? payload.sessionSecret
        : randomBytes(32).toString("hex"),
    webSearchConfig: sanitizeWebSearchConfig(payload.webSearchConfig),
  };
}

async function decryptPayload(rawEnvelope: string) {
  const parsed = JSON.parse(rawEnvelope) as {
    ciphertext?: string;
    iv?: string;
    salt?: string;
    tag?: string;
    version?: number;
  };

  if (
    parsed.version !== ENCRYPTION_ENVELOPE_VERSION ||
    typeof parsed.ciphertext !== "string" ||
    typeof parsed.iv !== "string" ||
    typeof parsed.salt !== "string" ||
    typeof parsed.tag !== "string"
  ) {
    throw new Error("Stored secrets are not readable.");
  }

  let lastError: unknown = null;

  for (const candidate of await getDecryptionSecrets()) {
    try {
      const key = scryptSync(candidate.secret, Buffer.from(parsed.salt, "base64"), 32);
      const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(parsed.iv, "base64"));
      decipher.setAuthTag(Buffer.from(parsed.tag, "base64"));

      const decrypted = Buffer.concat([
        decipher.update(Buffer.from(parsed.ciphertext, "base64")),
        decipher.final(),
      ]).toString("utf8");

      if (candidate.source === "legacy-local") {
        await persistEncryptionSecret(candidate.secret);
      }

      return JSON.parse(decrypted) as unknown;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Stored secrets are not readable.");
}

async function readLegacyStore(legacyJsonPath: string) {
  try {
    const raw = await fs.readFile(legacyJsonPath, "utf8");
    const parsed = JSON.parse(raw) as LegacyStoreFile;

    return {
      owner: parsed.owner
        ? {
            apiKeys: sanitizeApiKeys(parsed.owner.apiKeys),
            customEndpointConfig: { ...defaultCustomEndpointConfig },
            language: "auto" as const,
            ollamaConfig: { ...defaultOllamaConfig },
            password: parsed.owner.password ?? { hash: "", salt: "" },
            proxyConfig: sanitizeProxyConfig(parsed.owner.proxyConfig),
            routingPreferences: {
              ...defaultRoutingPreferences,
              customModels: [],
              responderModels: [],
              synthesizerModel: null,
            },
            shouldPromptForApiKeys: Boolean(parsed.owner.shouldPromptForApiKeys),
            username: parsed.owner.username?.trim() ?? "",
            webSearchConfig: { ...defaultWebSearchConfig },
          }
        : null,
      sessionSecret:
        typeof parsed.sessionSecret === "string" && parsed.sessionSecret.trim()
          ? parsed.sessionSecret
          : randomBytes(32).toString("hex"),
    } satisfies StoreRecord;
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function migrateLegacyJsonStore(database: DatabaseSync, legacyJsonPath: string | null) {
  if (!legacyJsonPath || selectOwnerRow(database)) {
    return;
  }

  const legacyStore = await readLegacyStore(legacyJsonPath);
  const legacyOwner = legacyStore?.owner;

  if (!legacyOwner) {
    return;
  }

  const passwordHash = legacyOwner.password.hash?.trim() ?? "";
  const passwordSalt = legacyOwner.password.salt?.trim() ?? "";
  const username = legacyOwner.username.trim();

  if (!username || !passwordHash || !passwordSalt) {
    return;
  }

  const encryptedSecrets = await encryptSecrets({
    apiKeys: legacyOwner.apiKeys,
    ollamaConfig: defaultOllamaConfig,
    proxyConfig: legacyOwner.proxyConfig,
    routingPreferences: defaultRoutingPreferences,
    sessionSecret: legacyStore.sessionSecret,
    webSearchConfig: defaultWebSearchConfig,
  });
  const now = new Date().toISOString();

  runInTransaction(database, () => {
    database.prepare(`
      INSERT INTO owner (
        id,
        username,
        password_hash,
        password_salt,
        should_prompt_for_api_keys,
        secrets,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      1,
      username,
      passwordHash,
      passwordSalt,
      legacyOwner.shouldPromptForApiKeys ? 1 : 0,
      encryptedSecrets,
      now,
      now,
    );
  });
}

async function readStore() {
  const database = await getDatabase();
  const row = selectOwnerRow(database);

  if (!row) {
    return {
      owner: null,
      sessionSecret: randomBytes(32).toString("hex"),
    } satisfies StoreRecord;
  }

  const secrets = await decryptSecrets(row.secrets);

  return {
    owner: {
      apiKeys: sanitizeApiKeys(secrets.apiKeys),
      customEndpointConfig: sanitizeCustomEndpointConfig(secrets.customEndpointConfig),
      language: sanitizeLanguage(secrets.language),
      ollamaConfig: sanitizeOllamaConfig(secrets.ollamaConfig),
      password: {
        hash: row.password_hash,
        salt: row.password_salt,
      },
      proxyConfig: sanitizeProxyConfig(secrets.proxyConfig),
      routingPreferences: sanitizeRoutingPreferences(secrets.routingPreferences),
      shouldPromptForApiKeys: Boolean(row.should_prompt_for_api_keys),
      username: row.username,
      webSearchConfig: sanitizeWebSearchConfig(secrets.webSearchConfig),
    },
    sessionSecret: secrets.sessionSecret,
  } satisfies StoreRecord;
}

async function writeOwner(owner: OwnerRecord, sessionSecret: string) {
  const database = await getDatabase();
  const encryptedSecrets = await encryptSecrets({
    apiKeys: owner.apiKeys,
    customEndpointConfig: owner.customEndpointConfig,
    language: owner.language,
    ollamaConfig: owner.ollamaConfig,
    proxyConfig: owner.proxyConfig,
    routingPreferences: owner.routingPreferences,
    sessionSecret,
    webSearchConfig: owner.webSearchConfig,
  });
  const now = new Date().toISOString();

  runInTransaction(database, () => {
    database.prepare(`
      INSERT INTO owner (
        id,
        username,
        password_hash,
        password_salt,
        should_prompt_for_api_keys,
        secrets,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        username = excluded.username,
        password_hash = excluded.password_hash,
        password_salt = excluded.password_salt,
        should_prompt_for_api_keys = excluded.should_prompt_for_api_keys,
        secrets = excluded.secrets,
        updated_at = excluded.updated_at
    `).run(
      1,
      owner.username,
      owner.password.hash,
      owner.password.salt,
      owner.shouldPromptForApiKeys ? 1 : 0,
      encryptedSecrets,
      now,
      now,
    );
  });
}

export async function getAppStatus(username: string | null): Promise<AppStatusPayload> {
  const store = await readStore();
  const owner = store.owner;
  const authenticated = Boolean(owner && username && owner.username === username);
  const configuredProviders = owner ? getConfiguredProviders(owner.apiKeys) : [];

  if (owner?.ollamaConfig.enabled) {
    configuredProviders.push("ollama");
  }

  return {
    authenticated,
    configuredProviders,
    customEndpointConfig: authenticated ? owner?.customEndpointConfig ?? { ...defaultCustomEndpointConfig } : { ...defaultCustomEndpointConfig },
    initialized: Boolean(owner),
    language: authenticated ? owner?.language ?? "auto" : "auto",
    ollamaConfig: authenticated ? owner?.ollamaConfig ?? { ...defaultOllamaConfig } : { ...defaultOllamaConfig },
    proxyConfig: authenticated ? owner?.proxyConfig ?? { ...defaultProxyConfig } : { ...defaultProxyConfig },
    routingPreferences: authenticated
      ? owner?.routingPreferences ?? defaultRoutingPreferences
      : defaultRoutingPreferences,
    shouldPromptForApiKeys: authenticated ? Boolean(owner?.shouldPromptForApiKeys) : false,
    username: authenticated ? owner?.username ?? null : null,
    webSearchConfig: authenticated ? owner?.webSearchConfig ?? { ...defaultWebSearchConfig } : { ...defaultWebSearchConfig },
  };
}

export async function initializeOwner(username: string, password: string) {
  const normalizedUsername = username.trim();
  const normalizedPassword = password.trim();

  if (!normalizedUsername || !normalizedPassword) {
    throw new Error("Username and password are required.");
  }

  const store = await readStore();
  if (store.owner) {
    throw new Error("Owner setup has already been completed.");
  }

  await writeOwner(
    {
      apiKeys: {},
      customEndpointConfig: { ...defaultCustomEndpointConfig },
      language: "auto",
      ollamaConfig: { ...defaultOllamaConfig },
      password: hashPassword(normalizedPassword),
      proxyConfig: { ...defaultProxyConfig },
      routingPreferences: { ...defaultRoutingPreferences },
      shouldPromptForApiKeys: true,
      username: normalizedUsername,
      webSearchConfig: { ...defaultWebSearchConfig },
    },
    randomBytes(32).toString("hex"),
  );
}

export async function verifyOwnerLogin(username: string, password: string) {
  const store = await readStore();
  const owner = store.owner;

  if (!owner) {
    return false;
  }

  if (owner.username !== username.trim()) {
    return false;
  }

  return verifyPassword(password, owner.password);
}

export async function getSessionSecret() {
  const store = await readStore();
  return store.owner ? store.sessionSecret : randomBytes(32).toString("hex");
}

export async function saveOwnerSettings(update: SettingsUpdate) {
  const store = await readStore();
  const owner = store.owner;

  if (!owner) {
    throw new Error("Owner setup is not complete.");
  }

  if (update.apiKeys) {
    const apiKeys = { ...owner.apiKeys };
    for (const provider of PROVIDER_PRESETS.filter((entry) => entry.authStrategy === "api-key")) {
      if (!(provider.id in update.apiKeys)) {
        continue;
      }

      const rawValue = update.apiKeys[provider.id];
      const trimmedValue = typeof rawValue === "string" ? rawValue.trim() : "";

      if (!trimmedValue) {
        delete apiKeys[provider.id];
      } else {
        apiKeys[provider.id] = trimmedValue;
      }
    }
    owner.apiKeys = apiKeys;
  }

  if (update.proxyConfig) {
    owner.proxyConfig = sanitizeProxyConfig({
      ...owner.proxyConfig,
      ...update.proxyConfig,
    });
  }

  if (update.ollamaConfig) {
    owner.ollamaConfig = sanitizeOllamaConfig({
      ...owner.ollamaConfig,
      ...update.ollamaConfig,
    });
  }

  if (update.routingPreferences) {
    owner.routingPreferences = sanitizeRoutingPreferences(update.routingPreferences);
  }

  if (update.webSearchConfig) {
    owner.webSearchConfig = sanitizeWebSearchConfig({
      ...owner.webSearchConfig,
      ...update.webSearchConfig,
    });
  }

  if (update.language !== undefined) {
    owner.language = sanitizeLanguage(update.language);
  }

  if (update.customEndpointConfig !== undefined) {
    owner.customEndpointConfig = sanitizeCustomEndpointConfig(update.customEndpointConfig);
  }

  await writeOwner(owner, store.sessionSecret);

  return {
    configuredProviders: [
      ...getConfiguredProviders(owner.apiKeys),
      ...(owner.ollamaConfig.enabled ? (["ollama"] as const) : []),
    ],
    ollamaConfig: owner.ollamaConfig,
    proxyConfig: owner.proxyConfig,
  };
}

export async function completeApiKeyPrompt() {
  const store = await readStore();
  if (!store.owner) {
    throw new Error("Owner setup is not complete.");
  }

  store.owner.shouldPromptForApiKeys = false;
  await writeOwner(store.owner, store.sessionSecret);
}

export async function getExecutionSettings() {
  const store = await readStore();
  if (!store.owner) {
    throw new Error("Owner setup is not complete.");
  }

  return {
    apiKeys: store.owner.apiKeys,
    customEndpointBaseUrl: store.owner.customEndpointConfig.baseUrl,
    ollamaBaseUrl: store.owner.ollamaConfig.enabled
      ? store.owner.ollamaConfig.baseUrl.trim() || defaultOllamaConfig.baseUrl
      : undefined,
    ollamaBypassProxy: store.owner.ollamaConfig.bypassProxy,
    proxyUrl: buildProxyUrl(store.owner.proxyConfig),
    webSearchConfig: store.owner.webSearchConfig,
  };
}

function selectConversationRow(database: DatabaseSync, conversationId: string) {
  return database.prepare<ConversationRow>(`
    SELECT id, payload, created_at, updated_at
    FROM conversations
    WHERE id = ?
  `).get(conversationId);
}

function selectConversationRows(database: DatabaseSync) {
  return database.prepare<ConversationRow>(`
    SELECT id, payload, created_at, updated_at
    FROM conversations
    ORDER BY updated_at DESC
  `).all();
}

function sanitizeConversationId(input?: string | null) {
  if (!input) {
    return null;
  }

  const trimmed = input.trim();
  return trimmed || null;
}

function buildConversationTitle(messages: ConversationMessage[]) {
  const firstUserMessage = messages.find((message) => message.role === "user" && !message.isOpinion);
  const base = firstUserMessage?.content || messages.find((message) => !message.isOpinion)?.content || "Untitled chat";
  return base.replace(/\s+/g, " ").slice(0, 72).trim() || "Untitled chat";
}

function buildConversationPreview(messages: ConversationMessage[]) {
  const visibleMessages = messages.filter((message) => !message.isOpinion);
  const lastMessage = visibleMessages[visibleMessages.length - 1];
  return (lastMessage?.content || "").replace(/\s+/g, " ").slice(0, 140).trim();
}

function sanitizeConversationPayload(payload: Partial<ConversationPayload>) {
  const messages = sanitizeConversationMessages(payload.messages);
  const compressedContext = typeof payload.compressedContext === "string" ? payload.compressedContext : null;
  const compressionHistory = Array.isArray(payload.compressionHistory)
    ? (payload.compressionHistory as unknown[]).filter(
        (entry): entry is ConversationRecord["compressionHistory"][number] =>
          typeof entry === "object" &&
          entry !== null &&
          typeof (entry as Record<string, unknown>).roundNumber === "number",
      )
    : [];

  return {
    compressedContext,
    compressionHistory,
    lastRun: sanitizeGpsResponsePayload(payload.lastRun),
    messages,
    preview: buildConversationPreview(messages),
    title: buildConversationTitle(messages),
  } satisfies ConversationPayload;
}

async function hydrateConversation(row: ConversationRow): Promise<ConversationRecord> {
  const payload = sanitizeConversationPayload(
    (await decryptPayload(row.payload)) as Partial<ConversationPayload>,
  );

  return {
    id: row.id,
    title: payload.title,
    preview: payload.preview,
    messages: payload.messages,
    lastRun: payload.lastRun,
    compressedContext: payload.compressedContext,
    compressionHistory: payload.compressionHistory,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listConversationHistory(): Promise<ConversationSummary[]> {
  const database = await getDatabase();
  const rows = selectConversationRows(database);
  const conversations = await Promise.all(rows.map((row) => hydrateConversation(row)));
  return conversations.map((conversation) => buildConversationSummary(conversation));
}

export async function getConversationHistory(conversationId: string) {
  const database = await getDatabase();
  const row = selectConversationRow(database, conversationId);

  if (!row) {
    return null;
  }

  return hydrateConversation(row);
}

export async function saveConversationHistory(input: {
  compressedContext?: string | null;
  compressionHistory?: ConversationRecord["compressionHistory"];
  conversationId?: string | null;
  lastRun?: ConversationRecord["lastRun"];
  messages: ConversationMessage[];
}) {
  const payload = sanitizeConversationPayload({
    compressedContext: input.compressedContext ?? null,
    compressionHistory: input.compressionHistory ?? [],
    lastRun: input.lastRun,
    messages: input.messages,
  });

  if (payload.messages.length === 0) {
    throw new Error("Cannot save an empty conversation.");
  }

  const database = await getDatabase();
  const requestedId = sanitizeConversationId(input.conversationId);
  const existingRow = requestedId ? selectConversationRow(database, requestedId) : null;
  const conversationId = existingRow?.id || requestedId || randomUUID();
  const createdAt = existingRow?.created_at || new Date().toISOString();
  const updatedAt = new Date().toISOString();
  const encryptedPayload = await encryptPayload(payload);

  runInTransaction(database, () => {
    database.prepare(`
      INSERT INTO conversations (id, payload, created_at, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        payload = excluded.payload,
        updated_at = excluded.updated_at
    `).run(conversationId, encryptedPayload, createdAt, updatedAt);
  });

  return {
    id: conversationId,
    title: payload.title,
    preview: payload.preview,
    messages: payload.messages,
    lastRun: payload.lastRun,
    compressedContext: payload.compressedContext,
    compressionHistory: payload.compressionHistory,
    createdAt,
    updatedAt,
  } satisfies ConversationRecord;
}

export async function deleteConversationHistory(conversationId: string) {
  const database = await getDatabase();
  database.prepare(`DELETE FROM conversations WHERE id = ?`).run(conversationId);
}
