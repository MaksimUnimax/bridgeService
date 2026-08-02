import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';

export const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

export function readSequentialSource(dir) {
  const base = path.join(ROOT, dir);
  const entries = fs.readdirSync(base)
    .filter((name) => /^part\d+\.js$/.test(name))
    .sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]));
  return entries.map((name) => fs.readFileSync(path.join(base, name), 'utf8')).join('\n');
}

export function readContentSource() { return readSequentialSource('content'); }
export function readPopupSource() { return readSequentialSource('popup'); }

export function loadRuntime() {
  const context = {
    console,
    URL,
    TextEncoder,
    TextDecoder,
    crypto: crypto.webcrypto,
    structuredClone,
    setTimeout,
    clearTimeout,
    Date,
  };
  context.globalThis = context;
  vm.createContext(context);
  for (const rel of ['shared/protocol.js', 'shared/model.js', 'shared/manual_controls.js']) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, rel), 'utf8'), context, { filename: rel });
  }
  return context;
}

export function baseRun(overrides = {}) {
  return {
    run_id: 'run-test',
    status: 'waiting_prompt',
    resume_status: null,
    pause_requested: false,
    pause_reason: null,
    pending_submission: null,
    current_job_id: null,
    manual_one_shot: false,
    pause_after_delivery: false,
    submission_origin: null,
    ...overrides,
  };
}

export function functionSource(text, name) {
  const patterns = [`async function ${name}(`, `function ${name}(`];
  const start = patterns.map((p) => text.indexOf(p)).find((v) => v >= 0);
  if (start === undefined) throw new Error(`Function ${name} not found`);
  const brace = text.indexOf('{', start);
  let depth = 0;
  for (let i = brace; i < text.length; i += 1) {
    if (text[i] === '{') depth += 1;
    else if (text[i] === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  throw new Error(`Function ${name} is incomplete`);
}

export function sha256(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

export class FakeBridge {
  constructor() {
    this.chainState = 'active';
    this.acceptedJobs = [];
    this.pauseCalls = 0;
    this.resumeCalls = 0;
    this.terminateCalls = 0;
  }
  pause() { this.pauseCalls += 1; this.chainState = 'paused'; }
  resume() { this.resumeCalls += 1; this.chainState = 'active'; }
  acceptJob(id) {
    if (this.chainState === 'paused') throw new Error('CHAIN_PAUSED');
    this.acceptedJobs.push(id);
    return { job_id: id };
  }
  terminate() { this.terminateCalls += 1; this.chainState = 'terminated'; }
}
