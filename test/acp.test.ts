import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { eventually } from './helpers.js';
import { tmpdir } from 'node:os';
import { AcpClient, KimiRunner } from '../server/acp.js';
import { discoverKimi } from '../server/resources.js';
import { config } from './helpers.js';
async function fixture(
  behavior: 'normal' | 'permission' | 'silent' | 'exit' | 'unsupported' | 'badthinking' = 'normal',
) {
  const dir = await mkdtemp(join(tmpdir(), 'agenthub-acp-'));
  const executable = join(dir, 'kimi'),
    log = join(dir, 'calls.jsonl');
  await writeFile(
    executable,
    `#!${process.execPath}
import {createInterface} from 'node:readline'; import {appendFileSync} from 'node:fs';
if (process.argv.includes('--version')) { console.log('kimi, version test'); process.exit(0); }
let options=[{id:'model',currentValue:'kimi-code/test',options:[{value:'kimi-code/test',name:'Test'},{value:'kimi-code/other',name:'Other'}]},{id:'thinking',currentValue:'high',options:[{value:'low',name:'Low'},{value:'high',name:'High'}]},{id:'mode',currentValue:'default',options:['plan','auto','default'].map(value=>({value,name:value}))}];
const send = value=>process.stdout.write(JSON.stringify({jsonrpc:'2.0',...value})+'\\n');
const finish=id=>{send({method:'session/update',params:{sessionId:'s',update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:'真实'}}}});send({method:'session/update',params:{sessionId:'s',update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:'结果'}}}});send({id,result:{stopReason:'end_turn'}});};
let promptId;
createInterface({input:process.stdin}).on('line',line=>{const m=JSON.parse(line);appendFileSync(${JSON.stringify(log)},JSON.stringify(m)+'\\n');
if(m.method==='initialize')return send({id:m.id,result:{protocolVersion:1,agentCapabilities:{loadSession:true},pid:process.pid}});
if(m.method==='session/new')return send({id:m.id,result:{sessionId:'s',configOptions:options}});
if(m.method==='session/set_config_option'){const o=options.find(o=>o.id===m.params.configId);if(${JSON.stringify(behavior)}!=='badthinking'||o.id!=='thinking')o.currentValue=m.params.value;if(${JSON.stringify(behavior)}==='unsupported'&&o.id==='model')options=options.filter(o=>o.id!=='thinking');return send({id:m.id,result:{configOptions:options}});}
if(m.method==='session/prompt'){promptId=m.id;if(${JSON.stringify(behavior)}==='exit')process.exit(3);if(${JSON.stringify(behavior)}==='silent')return;if(${JSON.stringify(behavior)}==='permission')return send({id:700,method:'session/request_permission',params:{sessionId:'s',options:[{optionId:'once',name:'Allow once'}]}});return finish(m.id);}
if(m.id===700&&m.result)return finish(promptId);
if(m.id!==undefined)return send({id:m.id,result:{}});
});
`,
    { mode: 0o755 },
  );
  return {
    dir,
    executable,
    calls: async () =>
      (await readFile(log, 'utf8'))
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line)),
    cleanup: () => rm(dir, { recursive: true, force: true }),
  };
}
const input = (executable: string, cwd: string, signal = new AbortController().signal) => ({
  executable,
  cwd,
  profile: config.profiles[0],
  mode: 'plan' as const,
  prompt: 'test',
  signal,
  onUpdate: () => {},
  onRequest: async () => ({}),
  onSession: () => {},
});
test('ACP 初始化、原生配置实际应用与流式输出拼接', async () => {
  const f = await fixture();
  try {
    const result = await new KimiRunner(2000).run(input(f.executable, f.dir));
    assert.equal(result, '真实结果');
    const calls = await f.calls();
    assert.deepEqual(
      calls
        .filter((m) => m.method === 'session/set_config_option')
        .map((m) => [m.params.configId, m.params.value]),
      [
        ['model', 'kimi-code/test'],
        ['thinking', 'high'],
        ['mode', 'default'],
      ],
    );
    assert.equal(calls[0].params.clientCapabilities.elicitation.form.constructor, Object);
  } finally {
    await f.cleanup();
  }
});
test('模型探测逐个切换模型，动态拿 thinking，不调用推理', async () => {
  const f = await fixture();
  try {
    const result = await discoverKimi(f.dir, f.executable);
    assert.equal(result.models.length, 2);
    assert.deepEqual(result.models[0].efforts, ['low', 'high']);
    assert.equal(result.version, 'kimi, version test');
    assert.ok(!(await f.calls()).some((m) => m.method === 'session/prompt'));
  } finally {
    await f.cleanup();
  }
});
test('双向权限请求正确返回原始 JSON-RPC ID', async () => {
  const f = await fixture('permission');
  try {
    const i = input(f.executable, f.dir);
    i.onRequest = async () => ({ outcome: { outcome: 'selected', optionId: 'once' } });
    assert.equal(await new KimiRunner(2000).run(i), '真实结果');
    const response = (await f.calls()).find((m) => m.id === 700);
    assert.equal(response.result.outcome.optionId, 'once');
  } finally {
    await f.cleanup();
  }
});
test('超时、进程退出和配置未应用明确失败', async () => {
  for (const behavior of ['silent', 'exit', 'unsupported', 'badthinking'] as const) {
    const f = await fixture(behavior);
    try {
      const i = input(f.executable, f.dir);
      if (behavior === 'badthinking') i.profile = { ...i.profile, thinking: 'low' };
      await assert.rejects(new KimiRunner(100).run(i), /超时|退出|不支持|未应用/);
    } finally {
      await f.cleanup();
    }
  }
});
test('取消会关闭 CLI，不等待整轮超时', async () => {
  const f = await fixture('silent');
  const controller = new AbortController();
  try {
    const running = new KimiRunner(20_000).run(input(f.executable, f.dir, controller.signal));
    setTimeout(() => controller.abort(), 150);
    await assert.rejects(running, /关闭|aborted/);
  } finally {
    await f.cleanup();
  }
});
test('不存在的 CLI 返回连接错误', async () => {
  const client = new AcpClient('/missing/agenthub-kimi', tmpdir(), 3000);
  try {
    await assert.rejects(client.initialize(), /ENOENT|关闭|退出/);
  } finally {
    client.close();
  }
});
test('服务进程被强制结束后，桥接进程自动清理 Kimi 子进程', async () => {
  const f = await fixture('silent'),
    record = join(f.dir, 'children.json'),
    parentFile = join(f.dir, 'parent.mjs');
  await writeFile(
    parentFile,
    `import {AcpClient} from ${JSON.stringify(pathToFileURL(resolve('server/acp.ts')).href)}; import {writeFile} from 'node:fs/promises'; const client=new AcpClient(${JSON.stringify(f.executable)},${JSON.stringify(f.dir)}); const result=await client.initialize(); await writeFile(${JSON.stringify(record)},JSON.stringify({cliPid:result.pid,bridgePid:client.child.pid}));`,
  );
  const parent = spawn(process.execPath, ['--import', 'tsx', parentFile], {
    stdio: 'ignore',
    cwd: resolve('.'),
  });
  let pids: { cliPid: number; bridgePid: number } | undefined;
  const alive = (pid: number) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };
  try {
    const end = Date.now() + 6000;
    while (!pids && Date.now() < end) {
      try {
        pids = JSON.parse(await readFile(record, 'utf8'));
      } catch {
        await new Promise((r) => setTimeout(r, 30));
      }
    }
    assert.ok(pids);
    assert.ok(alive(pids.cliPid));
    parent.kill('SIGKILL');
    await eventually(() => !alive(pids!.cliPid), 4000);
    await eventually(() => !alive(pids!.bridgePid), 4000);
  } finally {
    parent.kill('SIGKILL');
    await f.cleanup();
  }
});
