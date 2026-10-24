import test from 'node:test';
import assert from 'node:assert/strict';
import { openCommand, openFile } from '../src/open.js';

const tricky = 'C:\Users\a b\reports & "x" ^ %PATH% (1)\report.html';

test('open: the path is a single argv element, never a shell string (Windows, mac, Linux)', () => {
  assert.deepEqual(openCommand(tricky, 'win32'), { cmd: 'explorer.exe', args: [tricky] });
  assert.deepEqual(openCommand('/tmp/a&b/report.html', 'darwin'), { cmd: 'open', args: ['/tmp/a&b/report.html'] });
  assert.deepEqual(openCommand('/tmp/a&b/report.html', 'linux'), { cmd: 'xdg-open', args: ['/tmp/a&b/report.html'] });
});

test('open: no cmd.exe, no "start", shell disabled', () => {
  let call;
  const exec = (cmd, args, opts) => { call = { cmd, args, opts }; return { unref() {} }; };
  const r = openFile(tricky, { platform: 'win32', exec });
  assert.equal(call.cmd, 'explorer.exe');
  assert.notEqual(call.cmd, 'cmd');
  assert.ok(!call.args.includes('/c') && !call.args.includes('start'));
  assert.deepEqual(call.args, [tricky]);
  assert.equal(call.opts.shell, false);
  assert.equal(r.args[0], tricky);
});

test('open: never throws', () => {
  assert.equal(openFile('x', { platform: 'linux', exec: () => { throw new Error('boom'); } }), null);
});
