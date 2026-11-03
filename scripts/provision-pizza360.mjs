// Uses this installation's environment. Never embeds service keys or passwords.
// Checkpoints under git-ignored scratch/ allow safe recovery after interruption.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
import OpenAI from "openai";
import { restaurant, items, notes } from "./pizza360-menu.mjs";

dotenv.config({ path: ".env.local", quiet: true });
const required = ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "NEXT_PUBLIC_SUPABASE_ANON_KEY"];
for (const key of required) if (!process.env[key]) throw new Error(`Missing ${key}`);
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const embedding = new OpenAI({ apiKey: process.env.MENU_EMBEDDING_API_KEY || process.env.OPENAI_API_KEY, baseURL: process.env.MENU_EMBEDDING_BASE_URL || process.env.OPENAI_BASE_URL || "https://api.openai.com/v1", maxRetries: 2, timeout: 90000 });
const model = process.env.MENU_EMBEDDING_MODEL || "text-embedding-3-small";
const dimensions = Number(process.env.MENU_EMBEDDING_DIMENSIONS) || 1536;
const statePath = path.resolve("scratch/pizza360-provisioning.json");
const imagePaths = process.argv.slice(2);
if (imagePaths.length !== 2 || imagePaths.some(p=>!fs.existsSync(p))) throw new Error("Supply the two original menu image paths.");
function checked(result) { if (result.error) throw new Error(result.error.message); return result.data; }
let state;
if (fs.existsSync(statePath)) state = JSON.parse(fs.readFileSync(statePath,"utf8"));
else {
  const existing = checked(await sb.from("restaurant_profiles").select("id").eq("slug",restaurant.slug));
  if (existing.length) throw new Error("Pizza 360 already exists; refusing to change an untracked tenant.");
  state = { projectUrl: process.env.NEXT_PUBLIC_SUPABASE_URL, email: "admin@pizza360.orderiq.local", password: `P360!${crypto.randomBytes(15).toString("base64url")}`, createdAt: new Date().toISOString() };
}
if (state.projectUrl !== process.env.NEXT_PUBLIC_SUPABASE_URL) throw new Error("Checkpoint belongs to a different database.");
function save() { fs.mkdirSync(path.dirname(statePath),{recursive:true}); fs.writeFileSync(statePath,JSON.stringify(state,null,2)); }
save();
const query = "crispy zinger chicken burger";
let queryVector = null;
try {
  const queryResponse = await embedding.embeddings.create({model,dimensions,input:[query]});
  queryVector = queryResponse.data[0].embedding;
  if (queryVector.length !== dimensions) throw new Error("Embedding dimension mismatch");
} catch (error) {
  if (error.status !== 402) throw error;
  console.log("Embedding provider has no credits. Completing account, menu and images; embeddings remain pending.");
}
console.log(`${items.length} menu variants validated.`);
const personality = `Friendly Pizza 360 & Fast Food ordering assistant. Respond in the customer's English, Urdu or Roman Urdu. Main phone ${restaurant.phone}; alternate ${restaurant.alternatePhone}. Open daily 4 PM to 5 AM, Asia/Karachi. Printed outlet contacts: Pak Colony 0345-3060934; Metroville 0313-0881360; Bufferzone 0340-1791360. Only Manghopir Road is configured as an ordering branch. Chinese Portion 1 and Portion 2 have unlabelled serving sizes: ask staff instead of inventing sizes. Delivery fees, service areas and deal flavour surcharges are unconfirmed: do not promise free delivery or invent terms.`;
if (!state.restaurantId) {
  const row = checked(await sb.from("restaurant_profiles").insert({ name:restaurant.name,slug:restaurant.slug,city:restaurant.city,dashboard_title:`${restaurant.name} Dashboard`,brand_color:"#DC2626",brand_hover_color:"#B91C1C",currency:"Rs.",timezone:"Asia/Karachi",branch_mode:"single",support_phone:restaurant.phone,delivery_phone:restaurant.phone,dine_in_phone:restaurant.alternatePhone,ai_personality:personality,menu_display_mode:"menu_pictures",menu_card_images:[],is_active:true,whatsapp_provider:"none" }).select("id").single());
  state.restaurantId = row.id; save();
}
if (!state.branchId) {
  const rows = checked(await sb.from("branches").select("id").eq("restaurant_id",state.restaurantId).eq("slug","pizza360-manghopir-road"));
  const row = rows[0] || checked(await sb.from("branches").insert({restaurant_id:state.restaurantId,slug:"pizza360-manghopir-road",name:"Manghopir Road",city:restaurant.city,address:restaurant.address,is_active:true}).select("id").single());
  state.branchId = row.id; save();
}
checked(await sb.from("restaurant_settings").upsert({branch_id:state.branchId,city:restaurant.city,opening_time:restaurant.hours.opening,closing_time:restaurant.hours.closing,timezone:"Asia/Karachi",phone_delivery:restaurant.phone,phone_dine_in:restaurant.alternatePhone,ai_personality:personality,is_accepting_orders:true},{onConflict:"branch_id"}));
if (!state.userId) {
  // Recover only a user explicitly created for this checkpoint's restaurant.
  const users = checked(await sb.auth.admin.listUsers({perPage:1000})).users;
  const existing = users.find(user=>user.email===state.email);
  if (existing && existing.app_metadata?.restaurant_id !== state.restaurantId) throw new Error("Login already exists and belongs to another setup.");
  const user = existing || checked(await sb.auth.admin.createUser({email:state.email,password:state.password,email_confirm:true,app_metadata:{restaurant_id:state.restaurantId},user_metadata:{full_name:"Pizza 360 Administrator"}})).user;
  state.userId=user.id; save();
}
checked(await sb.from("staff_profiles").upsert({user_id:state.userId,restaurant_id:state.restaurantId,full_name:"Pizza 360 Administrator",role:"admin",default_branch_id:state.branchId},{onConflict:"user_id"}));
checked(await sb.from("staff_branch_access").upsert({user_id:state.userId,branch_id:state.branchId},{onConflict:"user_id,branch_id"}));
console.log("Restaurant, branch, business hours and administrator access saved.");
const buckets = checked(await sb.storage.listBuckets());
if (!buckets.some(bucket=>bucket.id==="menu-assets")) checked(await sb.storage.createBucket("menu-assets",{public:true,fileSizeLimit:10485760,allowedMimeTypes:["image/jpeg","image/png","image/webp"]}));
state.imageUrls=[];
for (let i=0;i<imagePaths.length;i++) {
  const buffer=fs.readFileSync(imagePaths[i]);
  const key=`${state.restaurantId}/menu-cards/${crypto.createHash("sha256").update(buffer).digest("hex")}.jpg`;
  checked(await sb.storage.from("menu-assets").upload(key,buffer,{contentType:"image/jpeg",upsert:true}));
  const url=sb.storage.from("menu-assets").getPublicUrl(key).data.publicUrl;
  const response=await fetch(url);
  if (!response.ok || !Buffer.from(await response.arrayBuffer()).equals(buffer)) throw new Error(`Image ${i+1} verification failed`);
  state.imageUrls.push(url);
}
checked(await sb.from("restaurant_profiles").update({menu_card_images:state.imageUrls,menu_display_mode:"menu_pictures"}).eq("id",state.restaurantId)); save();
let stored=checked(await sb.from("menu_items").select("id,name,price,category,description").eq("branch_id",state.branchId));
const missing=items.filter(item=>!stored.some(row=>row.name===item.name));
if (missing.length) checked(await sb.from("menu_items").insert(missing.map(item=>({...item,branch_id:state.branchId,is_available:true,sort_order:items.indexOf(item)}))));
stored=checked(await sb.from("menu_items").select("id,name,price,category,description").eq("branch_id",state.branchId));
if (stored.length!==items.length || stored.some(row=>!items.some(item=>item.name===row.name&&item.price===Number(row.price)&&item.category===row.category&&item.description===row.description))) throw new Error("Stored menu differs from transcription");
const existingEmbeddings=checked(await sb.from("menu_item_embeddings").select("menu_item_id,embedding_model,embedding_source").eq("branch_id",state.branchId));
const source=item=>[item.name,item.category,item.description].filter(Boolean).join(" | ");
const pending=stored.filter(item=>!existingEmbeddings.some(row=>row.menu_item_id===item.id&&row.embedding_model===model&&row.embedding_source===source(item)));
for (let i=0;queryVector && i<pending.length;i+=20) {
  const batch=pending.slice(i,i+20);
  const response=await embedding.embeddings.create({model,dimensions,input:batch.map(source)});
  const vectors=new Map(response.data.map(row=>[row.index,row.embedding]));
  const rows=batch.map((item,index)=>{
    const vector=vectors.get(index);
    if (!vector || vector.length!==dimensions || vector.some(value=>!Number.isFinite(value))) throw new Error("Invalid embedding");
    return {menu_item_id:item.id,branch_id:state.branchId,embedding_model:model,embedding_source:source(item),embedding:`[${vector.join(",")}]`};
  });
  checked(await sb.from("menu_item_embeddings").upsert(rows,{onConflict:"menu_item_id"}));
  console.log(`Embeddings saved: ${Math.min(i+batch.length,pending.length)}/${pending.length}`);
}
const count=await sb.from("menu_item_embeddings").select("menu_item_id",{count:"exact",head:true}).eq("branch_id",state.branchId); checked(count);
if (queryVector && count.count!==items.length) throw new Error("Incomplete embeddings");
const matches=queryVector ? checked(await sb.rpc("match_menu_items_by_embedding",{branch_uuid:state.branchId,query_embedding:`[${queryVector.join(",")}]`,match_count:3,similarity_threshold:0.3})) : [];
if (queryVector && !matches?.some(row=>/zinger|burger/i.test(row.name))) throw new Error("Semantic search did not find a burger");
const anon=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
checked(await anon.auth.signInWithPassword({email:state.email,password:state.password}));
const visibleBranches=checked(await anon.from("branches").select("id,restaurant_id"));
if (visibleBranches.some(row=>row.id!==state.branchId)) throw new Error("Branch isolation failed");
const visibleProfiles=checked(await anon.from("restaurant_profiles").select("id"));
if (visibleProfiles.some(row=>row.id!==state.restaurantId)) throw new Error("Restaurant isolation failed");
const visibleMenu=checked(await anon.from("menu_items").select("id,branch_id"));
if (visibleMenu.some(item=>item.branch_id!==state.branchId)) throw new Error("Menu isolation failed");
// This installation can deny all direct authenticated reads: dashboard routes
// use a server client after loading the trusted staff profile and tenant scope.
const staff=checked(await sb.from("staff_profiles").select("restaurant_id,role,default_branch_id").eq("user_id",state.userId).single());
const allowed=checked(await sb.from("branches").select("id").eq("restaurant_id",staff.restaurant_id).eq("is_active",true));
if(staff.restaurant_id!==state.restaurantId||staff.role!=="admin"||staff.default_branch_id!==state.branchId||allowed.length!==1||allowed[0].id!==state.branchId) throw new Error("Dashboard staff scope failed");
checked(await anon.auth.signOut());
state.verifiedAt=new Date().toISOString();state.itemCount=items.length;state.embeddingCount=count.count;state.embeddingStatus=count.count===items.length?"complete":"blocked_provider_credits";state.notes=notes;state.semanticMatches=matches.map(row=>({name:row.name,similarity:row.similarity}));save();
fs.writeFileSync("scratch/pizza360-menu.json",JSON.stringify({restaurant,notes,items},null,2));
fs.writeFileSync("scratch/pizza360-login.txt",`Restaurant: ${restaurant.name}\nLogin: ${state.email}\nPassword: ${state.password}\nUse the existing OrderIQ app /login page. This login ID is not an email inbox.\nRestaurant ID: ${state.restaurantId}\nBranch: ${restaurant.address}\nMain phone: ${restaurant.phone}\nAlternate phone: ${restaurant.alternatePhone}\nHours: daily 4 PM to 5 AM (Karachi)\nMenu: ${items.length} variants, ${count.count} embeddings, ${state.imageUrls.length} original pictures\nWhatsApp: not connected\n\nNotes:\n${notes.join("\n")}\n`);
console.log(JSON.stringify({success:state.embeddingStatus==="complete",accountAndMenuSaved:true,embeddingStatus:state.embeddingStatus,restaurantId:state.restaurantId,branchId:state.branchId,login:state.email,menuItems:items.length,embeddings:count.count,images:state.imageUrls.length,semanticMatches:state.semanticMatches,loginAndIsolationVerified:true,credentialsFile:"scratch/pizza360-login.txt"},null,2));
