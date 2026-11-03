import assert from 'node:assert/strict';
import { transcribeUrduVoice, voiceTranscriptionOptions, UrduVoiceTranscriptionError, URDU_VOICE_FALLBACK } from '../lib/voice-transcription.ts';
const file = new File(['fixture'], 'voice.ogg', {type:'audio/ogg'});
const expected='ایک افغانی ریپ اور ایک چکن پراٹھا رول۔';
for (const language of ['english','roman_urdu','pashto']) assert.equal(voiceTranscriptionOptions(language,[]).language,'ur');
assert.ok(voiceTranscriptionOptions('english',Array(100).fill('Afghani Wrap Chicken Paratha')).prompt.length<600);
let calls=[];
const primary={provider:'groq',model:'whisper-large-v3',transcribe:async(req)=>{calls.push(req);return {text:expected};}};
let result=await transcribeUrduVoice(file,['Afghani Wrap','Chicken Paratha'],[primary]);
assert.equal(result.text,expected);assert.equal(result.attempts,1);assert.equal(calls[0].language,'ur');assert.equal(calls[0].file,file);
for(const failure of ['', 'एक अफगानी रैप', 'temporary']){
 let attempt=0;
 result=await transcribeUrduVoice(file,[],[{...primary,transcribe:async(req)=>{assert.equal(req.language,'ur');if(attempt++===0){if(failure==='temporary')throw Object.assign(new Error('secret provider body'),{status:429});return {text:failure};}return {text:expected};}}]);
 assert.equal(result.text,expected);assert.equal(result.attempts,2);
}
let secondaryCalls=0;
result=await transcribeUrduVoice(file,[],[{...primary,transcribe:async()=>{throw Object.assign(new Error('quota'),{status:429});}},{provider:'openai',model:'whisper-1',transcribe:async()=>{secondaryCalls++;return {text:expected};}}]);
assert.equal(result.provider,'openai');assert.equal(secondaryCalls,1);
await assert.rejects(()=>transcribeUrduVoice(file,[],[{...primary,transcribe:async()=>{throw Object.assign(new Error('sensitive'),{status:503});}}]),error=>error instanceof UrduVoiceTranscriptionError&&error.attempts.length===2&&error.attempts.every(a=>a.status===503&&a.reason==='provider_error')&&!JSON.stringify(error.attempts).includes('sensitive'));
assert.match(URDU_VOICE_FALLBACK,/Maaf kijiye.*Dobara voice note/);assert.doesNotMatch(URDU_VOICE_FALLBACK,/Got your|Please type|[\u0900-\u097f]/u);
console.log('PASS: Urdu forced after English greeting; short vocabulary; exact two-item transcript; empty/Hindi/transient recovery; secondary provider; bounded failure; Roman Urdu fallback.');
