const DEFAULT_MODEL = "gemini-3.5-flash-lite";
function json(data,status=200,headers={}){return new Response(JSON.stringify(data),{status,headers:Object.assign({"Content-Type":"application/json; charset=utf-8"},headers)});}
function clean(v,n=500){return typeof v==="string"?v.trim().slice(0,n):"";}
function money(v){const n=Number(v);return Number.isFinite(n)&&n>0?n:null;}
function cors(origin,allowed){return origin&&allowed.includes(origin)?{"Access-Control-Allow-Origin":origin,"Access-Control-Allow-Methods":"GET, POST, OPTIONS","Access-Control-Allow-Headers":"Content-Type, Authorization","Access-Control-Max-Age":"86400","Vary":"Origin"}:{};}
async function currentUser(request,env){
 const token=(request.headers.get("Authorization")||"").replace(/^Bearer\s+/i,"").trim();if(!token||!env.FIREBASE_API_KEY)return null;
 const r=await fetch("https://identitytoolkit.googleapis.com/v1/accounts:lookup?key="+encodeURIComponent(env.FIREBASE_API_KEY),{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({idToken:token})});
 if(!r.ok)return null;const d=await r.json();const u=d.users&&d.users[0];return u&&u.localId?{uid:u.localId,email:u.email||""}:null;
}
function filters(params){
 const c=["p.status = 'published'"],v=[];const add=(sql,val)=>{c.push(sql);v.push(val);};
 const purpose=clean(params.get("purpose"),10).toLowerCase();if(purpose==="sale"||purpose==="rent")add("p.purpose = ?",purpose);
 const type=clean(params.get("property_type"),80);if(type)add("lower(p.property_type) LIKE ?","%"+type.toLowerCase()+"%");
 const city=clean(params.get("city"),100);if(city){c.push("(lower(p.city) LIKE ? OR lower(p.location) LIKE ?)");v.push("%"+city.toLowerCase()+"%","%"+city.toLowerCase()+"%");}
 const state=clean(params.get("state"),100);if(state)add("lower(p.state) LIKE ?","%"+state.toLowerCase()+"%");
 const min=money(params.get("min_price"));if(min)add("p.price >= ?",String(min));
 const max=money(params.get("max_price"));if(max)add("p.price <= ?",String(max));
 const beds=Number(params.get("bedrooms"));if(Number.isInteger(beds)&&beds>0)add("p.bedrooms >= ?",String(beds));
 return {where:c.join(" AND "),values:v};
}
async function searchProperties(env,params,limit=24){
 const f=filters(params);const sql="SELECT p.*,(SELECT i.image_data FROM property_images i WHERE i.property_id=p.id ORDER BY i.sort_order LIMIT 1) AS cover_image,(SELECT COUNT(*) FROM property_images i WHERE i.property_id=p.id) AS image_count FROM properties p WHERE "+f.where+" ORDER BY p.created_at DESC LIMIT ?";
 const r=await env.DB.prepare(sql).bind(...f.values,Math.min(Math.max(limit,1),40)).all();return r.results||[];
}
async function aiSearch(env,text){
 const model=env.GEMINI_MODEL||DEFAULT_MODEL;
 const prompt="Convert this buyer property request into JSON only with keys purpose (sale|rent|null), city, state, property_type, min_price, max_price, bedrooms, features (array). Use null when unspecified. Convert Nigerian million/billion wording into naira numbers. Do not invent. Request: "+text;
 const r=await fetch("https://generativelanguage.googleapis.com/v1beta/models/"+encodeURIComponent(model)+":generateContent",{method:"POST",headers:{"Content-Type":"application/json","x-goog-api-key":env.GEMINI_API_KEY},body:JSON.stringify({contents:[{role:"user",parts:[{text:prompt}]}],generationConfig:{temperature:.1,responseMimeType:"application/json",maxOutputTokens:300}})});
 const p=await r.json();if(!r.ok)throw new Error("AI search is temporarily unavailable.");const raw=(p.candidates?.[0]?.content?.parts||[]).map(x=>x.text||"").join("").trim();const criteria=JSON.parse(raw);const params=new URLSearchParams();
 ["purpose","city","state","property_type","min_price","max_price","bedrooms"].forEach(k=>{if(criteria[k]!==null&&criteria[k]!==undefined&&criteria[k]!=="")params.set(k,String(criteria[k]));});
 return {criteria,params};
}
async function listingCopy(env,prompt){
 const instruction="You are AgentCoPilot's real-estate listing writer. Use only seller-supplied facts. Never invent or infer features, condition, security, size, amenities, price, legal status or neighborhood claims. If input is not genuine property information, ask for valid details. Write concise, accurate copy only.";
 const model=env.GEMINI_MODEL||DEFAULT_MODEL;
 const r=await fetch("https://generativelanguage.googleapis.com/v1beta/models/"+encodeURIComponent(model)+":generateContent",{method:"POST",headers:{"Content-Type":"application/json","x-goog-api-key":env.GEMINI_API_KEY},body:JSON.stringify({systemInstruction:{parts:[{text:instruction}]},contents:[{role:"user",parts:[{text:prompt}]}],generationConfig:{temperature:.25,topP:.8,maxOutputTokens:700}})});
 const p=await r.json();if(!r.ok)throw new Error(r.status===429?"The AI service is temporarily busy. Please try again shortly.":"The AI service could not complete this request.");const out=(p.candidates?.[0]?.content?.parts||[]).map(x=>x.text||"").join("").trim();if(!out)throw new Error("The AI returned an empty response.");return out;
}
export default {async fetch(request,env){
 const origin=request.headers.get("Origin")||"";const allowed=(env.ALLOWED_ORIGIN||"https://etidoz1.github.io").split(",").map(x=>x.trim()).filter(Boolean);const headers=cors(origin,allowed);if(request.method==="OPTIONS")return origin&&!allowed.includes(origin)?json({error:"Origin not allowed."},403):new Response(null,{status:204,headers});
 const url=new URL(request.url);if(url.pathname==="/health"&&request.method==="GET")return json({status:"ok",service:"AgentCoPilot property marketplace",database:!!env.DB,ai:!!env.GEMINI_API_KEY,auth:!!env.FIREBASE_API_KEY},200,headers);
 if(origin&&!allowed.includes(origin))return json({error:"Origin not allowed."},403,headers);
 try{
  if(url.pathname==="/api/properties"&&request.method==="GET"){const rows=await searchProperties(env,url.searchParams,Number(url.searchParams.get("limit")||24));return json({properties:rows},200,headers);}
  if(url.pathname==="/api/properties"&&request.method==="POST"){
   const user=await currentUser(request,env);if(!user)return json({error:"Please sign in again before publishing."},401,headers);const b=await request.json();
   const name=clean(b.seller_name,100),phone=clean(b.seller_phone,40),purpose=clean(b.purpose,10).toLowerCase(),type=clean(b.property_type,80),title=clean(b.title,140),description=clean(b.description,3000),location=clean(b.location,240),city=clean(b.city,100),state=clean(b.state,100),price=money(b.price),photos=Array.isArray(b.photos)?b.photos.slice(0,5):[];
   if(!name||!phone||!["sale","rent"].includes(purpose)||!type||!title||!description||!location||!city||!state||!price)return json({error:"Complete all required property and seller details."},400,headers);
   if(b.authority_confirmed!==true||b.contact_consent!==true)return json({error:"Confirm your authority to list and consent to public contact details."},400,headers);
   if(!photos.length)return json({error:"Upload at least one real property photograph."},400,headers);
   for(const photo of photos)if(typeof photo!=="string"||!/^data:image\/(jpeg|png|webp);base64,/.test(photo)||photo.length>430000)return json({error:"Each photo must be JPG, PNG or WebP and under approximately 300 KB after compression."},400,headers);
   const id=crypto.randomUUID(),now=new Date().toISOString(),features=Array.isArray(b.features)?b.features.map(x=>clean(x,100)).filter(Boolean).slice(0,20):[];
   const statements=[env.DB.prepare("INSERT INTO properties (id,seller_uid,seller_name,seller_phone,seller_email,purpose,property_type,title,description,location,city,state,price,currency,bedrooms,bathrooms,size_sqm,condition,features,status,created_at,updated_at,seller_authority_confirmed,contact_consent) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'NGN',?,?,?,?,?,'published',?,?,1,1)").bind(id,user.uid,name,phone,user.email,purpose,type,title,description,location,city,state,price,Number(b.bedrooms)||null,Number(b.bathrooms)||null,Number(b.size_sqm)||null,clean(b.condition,80),JSON.stringify(features),now,now)];
   photos.forEach((photo,i)=>statements.push(env.DB.prepare("INSERT INTO property_images (id,property_id,image_data,mime_type,sort_order,created_at) VALUES (?,?,?,?,?,?)").bind(crypto.randomUUID(),id,photo,photo.slice(5,photo.indexOf(";")),i,now)));
   await env.DB.batch(statements);return json({success:true,property_id:id,message:"Your property has been published."},201,headers);
  }
  if(url.pathname.startsWith("/api/properties/")&&request.method==="GET"){
   const id=url.pathname.split("/").pop(),row=await env.DB.prepare("SELECT * FROM properties WHERE id=? AND status='published'").bind(id).first();if(!row)return json({error:"Property not found."},404,headers);
   const imgs=await env.DB.prepare("SELECT id,image_data,mime_type,sort_order FROM property_images WHERE property_id=? ORDER BY sort_order").bind(id).all();return json({property:row,images:imgs.results||[]},200,headers);
  }
  if(url.pathname==="/api/ai-search"&&request.method==="POST"){
   const user=await currentUser(request,env);if(!user)return json({error:"Please sign in to search properties."},401,headers);const b=await request.json(),q=clean(b.query,1200);if(q.length<8)return json({error:"Describe the property you want in more detail."},400,headers);
   const parsed=await aiSearch(env,q),rows=await searchProperties(env,parsed.params,24),features=Array.isArray(parsed.criteria.features)?parsed.criteria.features:[];
   const results=rows.map(row=>{let score=0;const reasons=[];if(parsed.criteria.city&&row.city.toLowerCase().includes(String(parsed.criteria.city).toLowerCase())){score+=30;reasons.push("Preferred location");}if(parsed.criteria.property_type&&row.property_type.toLowerCase().includes(String(parsed.criteria.property_type).toLowerCase())){score+=20;reasons.push("Property type");}if(parsed.criteria.bedrooms&&Number(row.bedrooms)>=Number(parsed.criteria.bedrooms)){score+=15;reasons.push("Bedroom requirement");}if(parsed.criteria.max_price&&row.price<=Number(parsed.criteria.max_price)){score+=20;reasons.push("Within budget");}if(parsed.criteria.purpose&&row.purpose===parsed.criteria.purpose){score+=15;reasons.push("Sale/rent preference");}const fs=JSON.parse(row.features||"[]").map(x=>x.toLowerCase());features.forEach(f=>{if(fs.some(x=>x.includes(String(f).toLowerCase()))){score+=5;reasons.push("Feature: "+f);}});return Object.assign({},row,{match_score:Math.min(score,100),match_reasons:reasons});}).sort((a,b)=>b.match_score-a.match_score);
   return json({criteria:parsed.criteria,properties:results},200,headers);
  }
  if(url.pathname==="/api/generate"&&request.method==="POST"){const b=await request.json(),prompt=clean(b.prompt,12000);if(!prompt)return json({error:"Please provide property information."},400,headers);return json({result:await listingCopy(env,prompt)},200,headers);}
  return json({error:"Not found."},404,headers);
 }catch(e){console.error("AgentCoPilot API error",e);return json({error:e.message||"The request could not be completed."},500,headers);}
}};
