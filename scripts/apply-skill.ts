#!/usr/bin/env tsx
/**
 * CLI entry point for applying skills via the skills-engine.
 * Usage:
 *   npx tsx scripts/apply-skill.ts <skill-dir>
 *   npx tsx scripts/apply-skill.ts --init
 */
import { applySkill, initSkillsSystem } from '../skills-engine/index.js';

const arg = process.argv[2];

if (!arg) {
  console.error('Usage: npx tsx scripts/apply-skill.ts <skill-dir>');
  console.error('       npx tsx scripts/apply-skill.ts --init');
  process.exit(1);
}

if (arg === '--init') {
  initSkillsSystem();
  process.exit(0);
}

const result = await applySkill(arg);

if (result.success) {
  console.log(`Skill "${result.skill}" v${result.version} applied successfully.`);
  if (result.untrackedChanges && result.untrackedChanges.length > 0) {
    console.log(`Note: drift detected in: ${result.untrackedChanges.join(', ')}`);
  }
} else {
  console.error(`Failed to apply skill "${result.skill}": ${result.error}`);
  if (result.mergeConflicts) {
    console.error(`Merge conflicts in: ${result.mergeConflicts.join(', ')}`);
  }
  process.exit(1);
}
