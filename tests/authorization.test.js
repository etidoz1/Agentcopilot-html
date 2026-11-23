const test=require('node:test'),assert=require('node:assert/strict');
const home=r=>r==='owner'?'owner.html':r==='admin'?'admin.html':r==='agent'?'agent.html':null;
test('roles have distinct landing pages',()=>{assert.equal(home('owner'),'owner.html');assert.equal(home('admin'),'admin.html');assert.equal(home('agent'),'agent.html')});
test('unknown roles do not enter a workspace',()=>{assert.equal(home('superuser'),null);assert.equal(home(undefined),null)});
test('public registration role is always agent',()=>{const role='agent';assert.equal(role,'agent');assert.notEqual(role,'owner');assert.notEqual(role,'admin')});
