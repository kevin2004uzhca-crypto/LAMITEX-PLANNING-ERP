const fs=require('node:fs');const path=require('node:path');const net=require('node:net');const assert=require('node:assert/strict');const {spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');const results=[];
function run(args=[],env={}){return spawnSync(process.execPath,['scripts/erp-launcher.cjs',...args],{cwd:root,env:{...process.env,...env},encoding:'utf8',timeout:180000,windowsHide:true});}
function state(){return JSON.parse(fs.readFileSync(path.join(root,'.erp/server.json'),'utf8'));}
function record(name,detail){results.push({name,result:'PASS',detail});console.log(`PASS: ${name}`);}
(async()=>{
 const before=state(); const repeat=run(['--no-browser']);assert.equal(repeat.status,0,repeat.stderr);assert.equal(state().childPid,before.childPid);record('Second launch reuses same process','Same child PID; no duplicate server.');
 const invalid=run(['--no-browser'],{NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:''});assert.notEqual(invalid.status,0);assert.match(invalid.stderr,/no esta configurada/);record('Missing configuration has a clear error','No environment value printed.');
 const unrelated=net.createServer(s=>s.end('HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok'));await new Promise(r=>unrelated.listen(0,'localhost',r));
 const occupied=unrelated.address().port;const conflict=run(['--no-browser'],{ERP_PORT:String(occupied)});assert.notEqual(conflict.status,0);assert.match(conflict.stderr,/ocupado/);assert.equal(state().childPid,before.childPid);record('Foreign port is not killed or silently changed','Unrelated listener and ERP stay alive.');await new Promise(r=>unrelated.close(r));
 const stop=run(['--stop']);assert.equal(stop.status,0,stop.stderr);assert.equal(fs.existsSync(path.join(root,'.erp/server.json')),false);record('Stop targets the launcher-owned instance','Supervisor removed its own state after child exit.');
 const restarted=run(['--no-browser']);assert.equal(restarted.status,0,restarted.stderr);assert.match(restarted.stdout,/No se requiere instalacion/);assert.notEqual(state().instance,before.instance);record('Fresh restart without npm ci','New instance, reused dependencies, HTTP ready.');
 for(const route of ['/','/pilot','/products','/materials','/imports','/settings']){const r=await fetch(`http://localhost:${state().port}${route}`,{redirect:'manual'});assert.equal(r.status,307,route);assert.equal(r.headers.get('location'),'/login');}
 record('Unauthenticated ERP routes redirect to login','No pilot or business data returned to anonymous requests.');
 fs.writeFileSync(path.join(root,'reports/launcher-checks.json'),JSON.stringify({date:new Date().toISOString(),results},null,2));
})().catch(e=>{console.error(e.message);process.exitCode=1;});
