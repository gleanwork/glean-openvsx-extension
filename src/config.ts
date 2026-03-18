/**
 * config.ts
 *
 * This module is responsible for resolving the Glean MCP server configuration.
 * It determines the MCP server URL (and optional server name) that the extension
 * uses to connect to the Glean backend. Configuration can come from three sources,
 * checked in the following priority order:
 *
 *   1. An explicit extension setting (glean.mcpServerUrl) provided by the user.
 *   2. A system-level config file managed by MDM (Mobile Device Management),
 *      typically deployed by IT administrators.
 *   3. A user-level config file located in the user's home directory,
 *      useful for development or non-MDM environments.
 *
 * The module also provides a utility to determine which config file path
 * should be watched for live-reload / change-detection purposes.
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import type { GleanMdmConfig } from "./types";

/**
 * The fallback server name used when the config file does not specify one.
 * This name is used as the identifier for the MCP server registration
 * within the editor extension host.
 */
const DEFAULT_SERVER_NAME = "glean_default_mdm";

/**
 * Returns the platform-specific file path where MDM tooling is expected
 * to drop the Glean MCP configuration file at the system level.
 *
 * These paths are chosen so that:
 *   - On macOS ("darwin"): the file lives under /Library/Application Support/,
 *     which is a standard location for system-wide application data.
 *   - On Windows ("win32"): the file lives under %PROGRAMDATA% (typically
 *     C:\ProgramData), which is the Windows equivalent for shared app config.
 *   - On Linux and other platforms: the file lives under /etc/, following
 *     Unix conventions for system-wide configuration.
 *
 * Writing to these paths requires admin/root privileges, but they are
 * readable by all users on the system — making them suitable for
 * IT-managed deployments.
 *
 * @returns The absolute path to the system-level config file.
 */
function getSystemConfigPath(): string {
  switch (process.platform) {
    // macOS: use the system-wide Application Support directory
    case "darwin":
      return "/Library/Application Support/Glean MDM/mcp-config.json";

    // Windows: use %PROGRAMDATA%, falling back to C:\ProgramData if the
    // environment variable is not set (which would be unusual)
    case "win32":
      return path.join(
        process.env.PROGRAMDATA ?? "C:\\ProgramData",
        "Glean MDM",
        "mcp-config.json",
      );

    // Linux and other Unix-like platforms: use /etc/ as is conventional
    default:
      return "/etc/glean_mdm/mcp-config.json";
  }
}

/**
 * Returns the path to the user-level configuration file.
 *
 * This file is intended for non-MDM scenarios such as local development
 * or personal setups where the user manually provides their Glean MCP
 * server URL. It resides in the user's home directory under a hidden
 * ".glean_mdm" folder.
 *
 * @returns The absolute path to the user-level config file
 *          (e.g. ~/.glean_mdm/mcp-config.json).
 */
function getUserConfigPath(): string {
  return path.join(os.homedir(), ".glean_mdm", "mcp-config.json");
}

/**
 * Attempts to read and parse a JSON file from disk.
 *
 * This is a safe wrapper around fs.readFileSync + JSON.parse that catches
 * all errors (file not found, permission denied, malformed JSON, etc.)
 * and returns null instead of throwing. This makes it convenient for
 * "try to load config, fall through if it doesn't exist" patterns.
 *
 * @param filePath - The absolute path to the JSON file to read.
 * @returns The parsed JSON object if successful, or null if the file
 *          could not be read or parsed for any reason.
 */
function readJsonFile(filePath: string): Record<string, unknown> | null {
  try {
    // Read the file synchronously — this is acceptable here because config
    // resolution happens once at startup, not in a hot path.
    const content = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(content);
  } catch {
    // Return null for any failure: file not found, permission error,
    // invalid JSON, etc. The caller will handle the absence gracefully.
    return null;
  }
}

/**
 * Validates whether a given string is a well-formed URL.
 *
 * Uses the built-in URL constructor as a validator — if it can successfully
 * parse the string, the URL is considered valid. This catches obviously
 * malformed inputs like empty strings, plain words, or missing schemes.
 *
 * @param url - The string to validate as a URL.
 * @returns True if the string is a valid URL, false otherwise.
 */
function isValidUrl(url: string): boolean {
  try {
    // The URL constructor will throw a TypeError if the string is not
    // a valid absolute URL (e.g. missing protocol, malformed syntax).
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

/**
 * Reads and parses a Glean MDM config from the given file path.
 *
 * The config file is expected to be a JSON object with at least a "url"
 * field (string). An optional "serverName" field can override the default
 * MCP server registration name.
 *
 * Example config file contents:
 *   {
 *     "url": "https://my-company.glean.com/mcp",
 *     "serverName": "my_custom_server_name"
 *   }
 *
 * @param filePath - The absolute path to the config file.
 * @returns A GleanMdmConfig object if the file exists and contains a valid
 *          "url" field, or null if the file is missing, unreadable, or
 *          does not contain the required fields.
 */
function configFromFile(filePath: string): GleanMdmConfig | null {
  const data = readJsonFile(filePath);

  // The config must exist and have a non-empty string "url" field
  // to be considered valid. Without a URL, there's nothing to connect to.
  if (!data || typeof data.url !== "string" || !data.url) {
    return null;
  }

  return {
    // Use the serverName from the file if it's a non-empty string,
    // otherwise fall back to the default name.
    serverName:
      typeof data.serverName === "string" && data.serverName
        ? data.serverName
        : DEFAULT_SERVER_NAME,
    url: data.url,
  };
}

/**
 * Type alias for a logging function used throughout config resolution.
 * This allows the caller to inject their own logger (e.g. an output channel
 * in VS Code) so that config resolution decisions are observable for
 * debugging purposes.
 */
export type LogFn = (message: string) => void;

/**
 * Resolves the Glean MCP server configuration by checking multiple sources
 * in a defined priority order. This is the main entry point for config
 * resolution used by the extension activation logic.
 *
 * Priority order:
 *   1. Extension setting (glean.mcpServerUrl) — highest priority, allows
 *      the user to explicitly override everything via the editor's settings UI.
 *   2. System-level config file — written by MDM/IT tooling, suitable for
 *      enterprise-wide deployments where admins push config to all machines.
 *   3. User-level config file (~/.glean_mdm/mcp-config.json) — lowest
 *      priority, intended for personal use or local development.
 *
 * At each level, the URL is validated before being accepted. If a config
 * source provides an invalid URL, it is skipped (with a log message) and
 * resolution continues to the next source.
 *
 * @param extensionUrl - The URL from the extension setting (glean.mcpServerUrl),
 *                       if configured. May be undefined or empty.
 * @param logger - An optional logging function for diagnostic output.
 *                 Each config source check logs its result (found, not found,
 *                 invalid URL, etc.) to aid in troubleshooting.
 * @returns A GleanMdmConfig if a valid configuration was found from any
 *          source, or null if no valid config is available.
 */
export function resolveConfig(
  extensionUrl?: string,
  logger?: LogFn,
): GleanMdmConfig | null {
  // Default to a no-op logger if none is provided, so we don't need
  // to guard every log call with a null check.
  const log = logger ?? (() => {});

  // --- Priority 1: Extension setting ---
  // Trim whitespace to handle accidental spaces in the settings UI.
  const trimmed = extensionUrl?.trim();
  if (trimmed) {
    if (!isValidUrl(trimmed)) {
      // The user provided a URL in settings, but it's malformed.
      // Log a warning and fall through to the next source.
      log(`Extension setting: invalid URL "${trimmed}", skipping`);
    } else {
      // Valid URL from extension settings — use it immediately.
      log(`Extension setting: url=${trimmed}`);
      return { serverName: DEFAULT_SERVER_NAME, url: trimmed };
    }
  } else {
    // No extension setting configured; proceed to file-based sources.
    log("Extension setting: not configured");
  }

  // --- Priority 2: System-level config file (MDM-managed) ---
  const systemPath = getSystemConfigPath();
  const systemConfig = configFromFile(systemPath);
  if (systemConfig) {
    if (!isValidUrl(systemConfig.url)) {
      // The system config file exists and has a URL, but it's invalid.
      // This likely indicates a misconfiguration in the MDM payload.
      log(
        `System config (${systemPath}): invalid URL "${systemConfig.url}", skipping`,
      );
    } else {
      // Valid system-level config found — use it.
      log(
        `System config (${systemPath}): serverName=${systemConfig.serverName}, url=${systemConfig.url}`,
      );
      return systemConfig;
    }
  } else {
    // System config file doesn't exist or couldn't be parsed.
    log(`System config (${systemPath}): not found`);
  }

  // --- Priority 3: User-level config file ---
  const userPath = getUserConfigPath();
  const userConfig = configFromFile(userPath);
  if (userConfig) {
    if (!isValidUrl(userConfig.url)) {
      // The user config file exists but has an invalid URL.
      log(
        `User config (${userPath}): invalid URL "${userConfig.url}", skipping`,
      );
    } else {
      // Valid user-level config found — use it.
      log(
        `User config (${userPath}): serverName=${userConfig.serverName}, url=${userConfig.url}`,
      );
      return userConfig;
    }
  } else {
    // User config file doesn't exist or couldn't be parsed.
    log(`User config (${userPath}): not found`);
  }

  // No valid configuration found from any source.
  return null;
}

/**
 * Determines which config file path should be watched for changes.
 *
 * This is used by the extension to set up a file system watcher so that
 * when the config file is updated (e.g. by an MDM push or manual edit),
 * the extension can automatically re-read the configuration and reconnect
 * to the MCP server without requiring a restart.
 *
 * The system-level config is preferred over the user-level config, matching
 * the priority order used in resolveConfig(). Only existing files are
 * returned — there's no point watching a path that doesn't exist yet.
 *
 * @returns The absolute path to the config file that should be watched,
 *          or null if neither the system nor user config file exists.
 */
export function getWatchablePath(): string | null {
  // Check system-level config first (higher priority)
  const systemPath = getSystemConfigPath();
  if (fs.existsSync(systemPath)) {
    return systemPath;
  }

  // Fall back to user-level config
  const userPath = getUserConfigPath();
  if (fs.existsSync(userPath)) {
    return userPath;
  }

  // Neither config file exists on disk
  return null;
}
