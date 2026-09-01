#!/usr/bin/env node
/**
 * @capacitor-community/apple-sign-in@7 still pins capacitor-swift-pm to 7.x.
 * Capacitor 8 needs 8.x. Widen the range so Xcode can resolve both.
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = join(
  root,
  'node_modules',
  '@capacitor-community',
  'apple-sign-in',
  'Package.swift'
);
if (!existsSync(pkg)) {
  console.warn('apple-sign-in Package.swift not found; skip SPM patch');
  process.exit(0);
}
const src = readFileSync(pkg, 'utf8');
const next = src.replace(
  '.package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", from: "7.0.0")',
  '.package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", "7.0.0"..<"9.0.0")'
);
if (src === next) {
  console.log('apple-sign-in SPM pin already compatible (or unexpected format)');
} else {
  writeFileSync(pkg, next);
  console.log('Patched apple-sign-in Package.swift for Capacitor 8');
}
