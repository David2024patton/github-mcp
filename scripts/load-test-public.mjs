#!/usr/bin/env node
// LAUNCH-1: runs the local-only load test of the public sign-in (tests/load/public-load.test.js) on a throwaway local PostgreSQL.
// Usage: node scripts/load-test-public.mjs [--people 50] [--at-once 10]
// It refuses to run against anything but the local fake service: a LOAD_TARGET_ORIGIN or --origin that is not the fake is an error.
import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
const flag = (name, fallback) => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : fallback; };
const origin = flag('origin', process.env.LOAD_TARGET_ORIGIN);
if (origin && origin !== 'https://connect.example.test') {
  console.error('Refusing: this load test only runs against the local fake service, never against ' + origin + '.');
  process.exit(2);
}
const people = flag('people', process.env.LOAD_PEOPLE ?? '50');
const atOnce = flag('at-once', process.env.LOAD_CONCURRENCY ?? '10');
if (!/^\d{1,3}$/.test(people) || !/^\d{1,2}$/.test(atOnce)) { console.error('--people and --at-once must be whole numbers.'); process.exit(2); }
const run = spawnSync('bash', ['scripts/local-postgres-test.sh', '--reporter=verbose'], {
  stdio: ['ignore', 'pipe', 'inherit'], encoding: 'utf8',
  env: { ...process.env, VITEST_CONFIG: 'vitest.load.config.js', LOAD_PEOPLE: people, LOAD_CONCURRENCY: atOnce, LOAD_TARGET_ORIGIN: '' }
});
const line = String(run.stdout ?? '').split('\n').find((l) => l.startsWith('LOAD-TEST-RESULT '));
if (line) console.log(JSON.stringify(JSON.parse(line.slice('LOAD-TEST-RESULT '.length)), null, 2));
else console.log(String(run.stdout ?? '').split('\n').slice(-30).join('\n'));
process.exit(run.status ?? 1);
