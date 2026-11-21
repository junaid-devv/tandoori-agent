import dotenv from 'dotenv';
import OpenAI from 'openai';
import { createClient } from '@supabase/supabase-js';
dotenv.config({path:'.env.local',quiet:true});
const db=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY);
const {data:msg}=await db.from('messages').select('metadata').eq('id','0533fa8a-3d72-485f-bef8-6f7f70efe2d0').single();
const key=msg.metadata.evolutionMessageKey;
const instance=msg.metadata.whatsappTransport.instanceName;
console.log('Providers configured:',{groq:!!process.env.GROQ_API_KEY,openai:!!process.env.OPENAI_API_KEY,legacyGroq:process.env.DEEPSEEK_API_KEY?.startsWith('gsk_')||false});
try{
const r=await fetch(process.env.EVOLUTION_API_BASE_URL.replace(/\/+$/,'')+'/chat/getBase64FromMediaMessage/'+encodeURIComponent(instance),{method:'POST',headers:{apikey:process.env.EVOLUTION_API_KEY,'Content-Type':'application/json'},body:JSON.stringify({message:{key},convertToMp4:false}),signal:AbortSignal.timeout(20000)});
if(!r.ok){console.log('Media HTTP',r.status);process.exit(1);}
const m=await r.json();console.log('Media fields',Object.keys(m),'mime',m.mimetype);
const bytes=Buffer.from(m.base64.replace(/^data:[^,]+,/,''),'base64');console.log('Audio bytes',bytes.length,'header',bytes.subarray(0,8).toString('hex'));
for(const [provider,apiKey,baseURL,model] of [['groq',process.env.GROQ_API_KEY||(process.env.DEEPSEEK_API_KEY?.startsWith('gsk_')?process.env.DEEPSEEK_API_KEY:null),'https://api.groq.com/openai/v1','whisper-large-v3'],['openai',process.env.OPENAI_API_KEY,undefined,'whisper-1']]){
if(!apiKey)continue;
try{const c=new OpenAI({apiKey,baseURL,timeout:25000,maxRetries:0});const t=await c.audio.transcriptions.create({file:new File([bytes],'voice.ogg',{type:m.mimetype?.split(';')[0]||'audio/ogg'}),model,language:'ur',prompt:'پاکستانی ریسٹورنٹ کا آرڈر۔ ایک افغانی ریپ اور ایک چکن پراٹھا رول۔'});console.log(provider,'transcript:',t.text);}catch(e){console.log(provider,'error',{status:e.status,code:e.code,message:String(e.message).slice(0,500)});}
}
}catch(e){console.log('Diagnostic failure',e.message);process.exitCode=1;}
