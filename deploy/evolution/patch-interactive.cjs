// Backport the interactive wire-format fix from evolution-foundation/evolution-api
// 2.4.0-rc1 to the pinned 2.3.7 image. No license/runtime changes are included.
// Source: src/api/integrations/channel/whatsapp/helpers/interactiveMessage.helper.ts
// and whatsapp.baileys.service.ts at tag 2.4.0-rc1 (Apache-2.0).
const fs = require('node:fs');
const assert = require('node:assert/strict');

const target = process.argv[2] || '/evolution/dist/main.js';
let source = fs.readFileSync(target, 'utf8');
const original = 'async sendMessage(e,t,o,i,n,r,a,c){e=e.toLowerCase();';
assert.equal(source.split(original).length - 1, 1, 'Unsupported Evolution bundle; refusing to patch');
// Detect only the existing interactive paths; all ordinary/media messages keep
// the upstream send implementation. Preserve protobuf Long/Buffer values.
const replacement = `async sendMessage(e,t,o,i,n,r,a,c){
  const interactive=t.viewOnceMessage?.message?.interactiveMessage||t.interactiveMessage;
  if(interactive||t.listMessage){
    e=e.toLowerCase();
    const content=interactive?{interactiveMessage:interactive}:{listMessage:{...t.listMessage,listType:1}};
    const biz=interactive
      ?{tag:'biz',attrs:{},content:[{tag:'interactive',attrs:{type:'native_flow',v:'1'},content:[{tag:'native_flow',attrs:{v:'9',name:'mixed'}}]}]}
      :{tag:'biz',attrs:{},content:[{tag:'list',attrs:{type:'product_list',v:'2'}}]};
    const built=(0,R.generateWAMessageFromContent)(e,content,{timestamp:new Date,userJid:this.instance.wuid,messageId:r||undefined,quoted:n});
    const id=await this.client.relayMessage(e,built.message,{messageId:built.key.id,additionalNodes:[biz]});
    built.key={...built.key,id,remoteJid:e,fromMe:true};
    return built;
  }
  e=e.toLowerCase();`;
source = source.replace(original, replacement);
fs.writeFileSync(target, source);
console.log('Applied pinned Evolution interactive rendering backport');
