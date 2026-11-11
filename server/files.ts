import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export const DATA_DIR = join('public', 'data');
export const ARCHIVE_DIR = 'archive';

/** 임시 파일에 쓴 뒤 바꿔 끼워, 쓰는 도중 화면이 깨진 JSON을 읽지 않게 합니다. */
export function writeJsonAtomic(path: string, value: unknown, pretty = false): void {
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, `${JSON.stringify(value, null, pretty ? 2 : undefined)}\n`, 'utf8');
  renameSync(temp, path);
}

export function readRows<T>(root: string, file: string): T[] {
  const path = join(root, DATA_DIR, `${file}.json`);
  if (!existsSync(path)) return [];
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
  return Array.isArray(parsed) ? (parsed as T[]) : [];
}

export function writeRows(root: string, file: string, rows: unknown[]): void {
  writeJsonAtomic(join(root, DATA_DIR, `${file}.json`), rows);
}
