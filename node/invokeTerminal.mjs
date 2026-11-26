import os from 'node:os';
import { spawn as spawnPty } from '@lydell/node-pty';

const terminalSessions = new Map();

export default function (instanceId, channel, args) {
  if (channel === 'terminal-start') {
    const current = terminalSessions.get(instanceId);
    if (current) {
      current.pty.kill();
      terminalSessions.delete(instanceId);
    }
    const shell = process.platform === 'win32' ? 'powershell.exe' : process.env.SHELL || 'bash';
    const pty = spawnPty(shell, [], {
      name: 'xterm-color',
      cols: 80,
      rows: 30,
      cwd: os.homedir(),
      env: { ...process.env, TERM: 'xterm-256color' },
      useConpty: process.platform === 'win32',
    });
    const session = { pty, output: [] };
    terminalSessions.set(instanceId, session);
    pty.onData((data) => {
      session.output.push(data);
      if (session.output.length > 2048) session.output.splice(0, session.output.length - 2048);
    });
    pty.onExit(({ exitCode }) => {
      session.output.push(`\r\n[process exited with code ${exitCode}]\r\n`);
      session.exited = true;
    });
    return { success: true };
  }
  const session = terminalSessions.get(instanceId);
  if (channel === 'terminal-input') {
    if (session && typeof args[0] === 'string') session.pty.write(args[0]);
    return { success: true };
  }
  if (channel === 'terminal-resize') {
    const { cols, rows } = args[0] || {};
    if (session && Number.isInteger(cols) && Number.isInteger(rows) && cols > 0 && rows > 0) {
      session.pty.resize(cols, rows);
    }
    return { success: true };
  }
  if (channel === 'terminal-poll') {
    const data = session ? session.output.splice(0) : [];
    if (session?.exited) terminalSessions.delete(instanceId);
    return { data };
  }
  if (channel === 'terminal-exit') {
    if (session) {
      terminalSessions.delete(instanceId);
      session.pty.kill();
    }
    return { success: true };
  }
  throw new Error(`Unsupported xterm channel ${channel}`);
}