import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import type { GleanMdmConfig } from "./types";

const DEFAULT_SERVER_NAME = "glean_default_mdm";

/**
 * Platform-specific paths where MDM drops the config file.
 * System-level (requires admin/root to write, readable by all users).
 */
function getSystemConfigPath(): string {
  switch (process.platform) {
    case "darwin":
      return "/Library/Application Support/Glean MDM/mcp-config.json";
    case "win32":
      return path.join(
        process.env.PROGRAMDATA ?? "C:\\ProgramData",
        "Glean MDM",
        "mcp-config.json",
      );
    default:
      return "/etc/glean_mdm/mcp-config.json";
  }
}

/**
 * User-level config path (for non-MDM / dev scenarios).
 */
function getUserConfigPath(): string {
  return path.join(os.homedir(), ".glean_mdm", "mcp-config.json");
}

function readJsonFile(filePath: string): unknown {
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(content);
  } catch {
    return null;
  }
}

function isValidUrl(url: string): boolean {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

function configsFromFile(filePath: string, logger?: LogFn): GleanMdmConfig[] {
  const log = logger ?? (() => {});
  const data = readJsonFile(filePath);
  if (data === null || data === undefined) {
    return [];
  }

  const rawEntries: unknown[] = Array.isArray(data) ? data : [data];
  const configs: GleanMdmConfig[] = [];

  for (const entry of rawEntries) {
    if (typeof entry !== "object" || entry === null) {
      continue;
    }
    const obj = entry as Record<string, unknown>;
    if (typeof obj.url !== "string" || !obj.url) {
      continue;
    }
    if (!isValidUrl(obj.url)) {
      log(`${filePath}: invalid URL "${obj.url}", skipping`);
      continue;
    }
    configs.push({
      serverName:
        typeof obj.serverName === "string" && obj.serverName
          ? obj.serverName
          : DEFAULT_SERVER_NAME,
      url: obj.url,
    });
  }

  return configs;
}

export type LogFn = (message: string) => void;

/**
 * Resolve Glean MDM config using this priority:
 * 1. Extension setting (glean.mcpServerUrl)
 * 2. System-level config file (MDM-managed)
 * 3. User-level config file (~/.glean_mdm/mcp-config.json)
 *
 * Config files may contain a single object or an array of objects.
 * Returns all valid entries from the highest-priority source, or null.
 */
export function resolveConfig(
  extensionUrl?: string,
  logger?: LogFn,
): GleanMdmConfig[] | null {
  const log = logger ?? (() => {});

  const trimmed = extensionUrl?.trim();
  if (trimmed) {
    if (!isValidUrl(trimmed)) {
      log(`Extension setting: invalid URL "${trimmed}", skipping`);
    } else {
      log(`Extension setting: url=${trimmed}`);
      return [{ serverName: DEFAULT_SERVER_NAME, url: trimmed }];
    }
  } else {
    log("Extension setting: not configured");
  }

  const systemPath = getSystemConfigPath();
  const systemConfigs = configsFromFile(systemPath, logger);
  if (systemConfigs.length > 0) {
    for (const c of systemConfigs) {
      log(
        `System config (${systemPath}): serverName=${c.serverName}, url=${c.url}`,
      );
    }
    return systemConfigs;
  } else {
    log(`System config (${systemPath}): not found`);
  }

  const userPath = getUserConfigPath();
  const userConfigs = configsFromFile(userPath, logger);
  if (userConfigs.length > 0) {
    for (const c of userConfigs) {
      log(
        `User config (${userPath}): serverName=${c.serverName}, url=${c.url}`,
      );
    }
    return userConfigs;
  } else {
    log(`User config (${userPath}): not found`);
  }

  return null;
}
/**
 * Returns the path to watch for config file changes.
 * Prefers system config if it exists, else user config.
 */
export function getWatchablePath(): string | null {
  const systemPath = getSystemConfigPath();
  if (fs.existsSync(systemPath)) {
    return systemPath;
  }

  const userPath = getUserConfigPath();
  if (fs.existsSync(userPath)) {
    return userPath;
  }

  return null;
}
