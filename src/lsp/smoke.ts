#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

type JsonRpc = { jsonrpc: '2.0'; id?: number; method?: string; params?: unknown; result?: unknown; error?: { code: number; message: string } };

type CommandDenial = { ok?: boolean; error?: string };

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

function encode(message: JsonRpc): string {
  const body = JSON.stringify(message);
  return `Content-Length: ${Buffer.byteLength(body, 'utf8')}\r\n\r\n${body}`;
}

async function main(): Promise<void> {
  const child = spawn(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'src/lsp/server.ts', '--stdio'], {
    cwd: process.cwd(),
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });

  let buffer = Buffer.alloc(0);
  const pending = new Map<number, (value: JsonRpc) => void>();
  const notifications: JsonRpc[] = [];
  let nextId = 1;

  child.stdout.on('data', (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (true) {
      const separator = buffer.indexOf('\r\n\r\n');
      if (separator < 0) return;
      const header = buffer.slice(0, separator).toString('utf-8');
      const match = /Content-Length: (\d+)/i.exec(header);
      if (!match) throw new Error(`Malformed LSP header: ${header}`);
      const length = Number(match[1]);
      const bodyStart = separator + 4;
      if (buffer.length < bodyStart + length) return;
      const body = buffer.slice(bodyStart, bodyStart + length).toString('utf-8');
      buffer = buffer.slice(bodyStart + length);
      const message = JSON.parse(body) as JsonRpc;
      if (typeof message.id === 'number' && pending.has(message.id)) {
        pending.get(message.id)!(message);
        pending.delete(message.id);
      } else {
        notifications.push(message);
      }
    }
  });

  let stderr = '';
  child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf-8'); });

  function send(method: string, params?: unknown): Promise<JsonRpc> {
    const id = nextId++;
    child.stdin.write(encode({ jsonrpc: '2.0', id, method, params }));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`Timed out waiting for ${method}`));
      }, 10_000);
      pending.set(id, (value) => {
        clearTimeout(timer);
        if (value.error) reject(new Error(`${method} error: ${value.error.message}`));
        else resolve(value);
      });
    });
  }

  function notify(method: string, params?: unknown): void {
    child.stdin.write(encode({ jsonrpc: '2.0', method, params }));
  }

  try {
    const initialize = await send('initialize', {
      processId: process.pid,
      rootUri: `file:///${process.cwd().replace(/\\/g, '/')}`,
      capabilities: {},
      workspaceFolders: null,
    });
    const initResult = initialize.result as { capabilities?: Record<string, unknown>; serverInfo?: { name?: string } };
    assert(initResult.serverInfo?.name === 'nova-agent-lsp', 'serverInfo name mismatch');
    assert(Boolean(initResult.capabilities?.hoverProvider), 'hoverProvider missing');
    assert(Boolean(initResult.capabilities?.completionProvider), 'completionProvider missing');
    assert(Boolean(initResult.capabilities?.documentSymbolProvider), 'documentSymbolProvider missing');
    assert(Boolean(initResult.capabilities?.workspaceSymbolProvider), 'workspaceSymbolProvider missing');
    const commands = (initResult.capabilities?.executeCommandProvider as { commands?: string[] } | undefined)?.commands ?? [];
    assert(commands.includes('nova.lsp.showToolMetadata'), 'read-only tool metadata command missing');
    assert(!commands.some((command) => /write|bash|shell/i.test(command)), 'write/shell command exposed by LSP');
    assert(!('workspaceEdit' in (initResult.capabilities ?? {})), 'WorkspaceEdit must not be advertised');
    notify('initialized', {});

    const uri = 'file:///nova-lsp-smoke.md';
    const text = ['# Nova LSP smoke', '', 'Use nova_tool_catalog and npm run lsp:smoke.', 'Never expose .nova/evals/raw/report.json or .env.'].join('\n');
    notify('textDocument/didOpen', { textDocument: { uri, languageId: 'markdown', version: 1, text } });
    await delay(200);

    const hover = await send('textDocument/hover', { textDocument: { uri }, position: { line: 2, character: 7 } });
    assert(JSON.stringify(hover.result).includes('nova_tool_catalog'), `hover did not include Nova metadata: ${JSON.stringify(hover.result)}`);

    const completion = await send('textDocument/completion', { textDocument: { uri }, position: { line: 2, character: 4 } });
    assert(JSON.stringify(completion.result).includes('nova_tool_catalog'), 'completion did not include Nova metadata');

    const docSymbols = await send('textDocument/documentSymbol', { textDocument: { uri } });
    assert(JSON.stringify(docSymbols.result).includes('nova_tool_catalog'), 'document symbols did not include opened doc metadata');

    const workspaceSymbols = await send('workspace/symbol', { query: 'lsp' });
    assert(JSON.stringify(workspaceSymbols.result).includes('lsp:smoke'), 'workspace symbols did not include LSP metadata');

    const commandResult = await send('workspace/executeCommand', { command: 'nova.lsp.explainPolicy', arguments: [] });
    assert(JSON.stringify(commandResult.result).includes('read-only'), 'policy command did not explain read-only mode');
    assert(JSON.stringify(commandResult.result).includes('raw .nova'), 'policy command did not mention raw artifact denial');

    for (const deniedCommand of ['nova.lsp.writeFile', 'nova.lsp.shell', 'nova.lsp.unknown']) {
      const deniedResult = await send('workspace/executeCommand', { command: deniedCommand, arguments: ['echo unsafe'] });
      const denial = deniedResult.result as CommandDenial;
      assert(denial.ok === false, `${deniedCommand} was not safely denied: ${JSON.stringify(deniedResult.result)}`);
      assert(/Unknown|non-read-only|Unsupported/i.test(denial.error ?? ''), `${deniedCommand} denial reason was unsafe: ${JSON.stringify(deniedResult.result)}`);
    }

    await delay(200);
    const diagnostics = notifications.filter((message) => message.method === 'textDocument/publishDiagnostics');
    assert(JSON.stringify(diagnostics).includes('Raw .nova traces/evals/reports are denied'), 'raw artifact diagnostic missing');
    assert(JSON.stringify(diagnostics).includes('Sensitive .env paths'), '.env diagnostic missing');

    await send('shutdown');
    notify('exit');
    await new Promise<void>((resolve) => child.once('exit', () => resolve()));
    assert(child.exitCode === 0 || child.exitCode === null, `LSP server exited with code ${child.exitCode}; stderr=${stderr}`);
    console.log(JSON.stringify({ ok: true, commands: commands.length, diagnostics: diagnostics.length }, null, 2));
  } finally {
    if (!child.killed && child.exitCode === null) child.kill();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
