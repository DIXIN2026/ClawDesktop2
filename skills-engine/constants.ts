export const CLAWDESKTOP_DIR = '.clawdesktop';
export const STATE_FILE = 'state.yaml';
export const BASE_DIR = '.clawdesktop/base';
export const BACKUP_DIR = '.clawdesktop/backup';
export const LOCK_FILE = '.clawdesktop/lock';
export const CUSTOM_DIR = '.clawdesktop/custom';
export const SKILLS_SCHEMA_VERSION = '0.1.0';

// Top-level paths to include in base snapshot and upstream extraction.
// Add new entries here when new root-level directories/files need tracking.
export const BASE_INCLUDES = [
  'electron/',
  'src/',
  'package.json',
];

// Directories/files to always exclude from base snapshot
export const BASE_EXCLUDES = [
  'node_modules',
  '.clawdesktop',
  '.git',
  'dist',
  'dist-electron',
  'data',
  'logs',
];
