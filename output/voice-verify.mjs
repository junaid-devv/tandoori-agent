import dotenv from 'dotenv';
import OpenAI from 'openai';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import { simpleCatalogOrder } from '../lib/agent/catalog-order.ts';
import { transcribeUrduVoice } from '../lib/voice-transcription.ts';
dotenv.config({path:'.env.local',quiet:true});
const db=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY);
const {data:msg}=await db.from('messages').select('metadata').eq('id','0533fa8a-3d72-485f-bef8-6f7f70efe2d0').single();
const {data:menu}=await db.from('menu_items').select('id,name,category,price,is_available').eq('branch_id','457cbcc8-5158-4859-9c55-066403461bf7');
const r=await fetch(process.env.EVOLUTION_API_BASE_URL.replace(/\/+$/,'')+'/chat/getBase64FromMediaMessage/'+encodeURIComponent(msg.metadata.whatsappTransport.instanceName),{method:'POST',headers:{apikey:process.env.EVOLUTION_API_KEY,'Content-Type':'application/json'},body:JSON.stringify({message:{key:msg.metadata.evolutionMessageKey},convertToMp4:false}),signal:AbortSignal.timeout(20000)});
assert.ok(r.ok);
const m=await r.json();const bytes=Buffer.from(m.base64.replace(/^data:[^,]+,/,''),'base64');
const client=new OpenAI({apiKey:process.env.GROQ_API_KEY,baseURL:'https://api.groq.com/openai/v1',timeout:12000,maxRetries:0});
const t=await transcribeUrduVoice(new File([bytes],'voice.ogg',{type:'audio/ogg'}),menu.map(i=>i.name),[{provider:'groq',model:'whisper-large-v3',transcribe:req=>client.audio.transcriptions.create(req)}]);
console.log('Actual customer audio with production helper:',JSON.stringify(t));
assert.match(t.text,/افغانی/);assert.match(t.text,/چکن/);assert.match(t.text,/پراٹھا|پراتا/);assert.doesNotMatch(t.text,/[\u0900-\u097f]/u);

const items=simpleCatalogOrder(t.text,menu); console.log('Catalog interpretation:',items); assert.equal(items.length,2);assert.match(items[0].query,/afghani.*wrap/);assert.match(items[1].query,/chicken.*paratha.*roll/);assert.ok(items.every(i=>i.qty===1));
