const DEFAULT_MODEL = "gemini-3.5-flash-lite";
function json(data,status=200,headers={}){return new Response(JSON.stringify(data),{status,headers:Object.assign({"Content-Type":"application/json; charset=utf-8"},headers)});}
function clean(v,n=500){return typeof v==="string"?v.trim().slice(0,n):"";}
function money(v){const n=Number(v);return Number.isFinite(n)&&n>0?n:null;}
function cors(origin,allowed){return origin&&allowed.includes(origin)?{"Access-Control-Allow-Origin":origin,"Access-Control-Allow-Methods":"GET, POST, OPTIONS","Access-Control-Allow-Headers":"Content-Type, Authorization","Access-Control-Max-Age":"86400","Vary":"Origin"}:{};}
let firebaseCerts=null,firebaseCertExpires=0;
function b64urlBytes(value){const s=value.replace(/-/g,"+").replace(/_/g,"/");const padded=s+"=".repeat((4-s.length%4)%4);const raw=atob(padded);return Uint8Array.from(raw,c=>c.charCodeAt(0));}
function derNode(bytes,pos){const tag=bytes[pos++];let length=bytes[pos++];if(length&128){const count=length&127;length=0;for(let i=0;i<count;i++)length=(length<<8)|bytes[pos++];}const start=pos;return {tag,start,next:start+length};}
function certificateSpki(pem){const b64=pem.replace(/-----BEGIN CERTIFICATE-----|-----END CERTIFICATE-----|\s/g,"");const raw=atob(b64);const der=Uint8Array.from(raw,c=>c.charCodeAt(0));const root=derNode(der,0),tbs=derNode(der,root.start);let pos=tbs.start;let node=derNode(der,pos);if(node.tag===0xa0)pos=node.next;for(let i=0;i<5;i++)pos=derNode(der,pos).next;const spki=derNode(der,pos);return der.slice(pos,spki.next);}
async function currentUser(request,env){
 const token=(request.headers.get("Authorization")||"").replace(/^Bearer\s+/i,"").trim();if(!token)return null;
 try{
  const parts=token.split(".");if(parts.length!==3)return null;
  const header=JSON.parse(new TextDecoder().decode(b64urlBytes(parts[0]))),claims=JSON.parse(new TextDecoder().decode(b64urlBytes(parts[1])));
  const now=Math.floor(Date.now()/1000);if(header.alg!=="RS256"||!header.kid||claims.aud!=="agentcopilot-98817"||claims.iss!=="https://securetoken.google.com/agentcopilot-98817"||!claims.sub||claims.sub.length>128||!claims.exp||claims.exp<=now||claims.iat>now+60||!claims.auth_time)return null;
  if(!firebaseCerts||firebaseCertExpires<Date.now()){const r=await fetch("https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com");if(!r.ok)return null;firebaseCerts=await r.json();firebaseCertExpires=Date.now()+50*60*1000;}
  const pem=firebaseCerts[header.kid];if(!pem)return null;const spki=certificateSpki(pem);const key=await crypto.subtle.importKey("spki",spki,{name:"RSASSA-PKCS1-v1_5",hash:"SHA-256"},false,["verify"]);
  const signature=b64urlBytes(parts[2]),message=new TextEncoder().encode(parts[0]+"."+parts[1]);const valid=await crypto.subtle.verify("RSASSA-PKCS1-v1_5",key,signature,message);return valid?{uid:claims.sub,email:claims.email||""}:null;
 }catch(e){console.error("Firebase token verification failed",e);return null;}
}
function filters(params){
 const c=["p.status = 'published'"],v=[];const add=(sql,val)=>{c.push(sql);v.push(val);};
 const purpose=clean(params.get("purpose"),10).toLowerCase();if(purpose==="sale"||purpose==="rent")add("p.purpose = ?",purpose);
 const type=clean(params.get("property_type"),80);if(type)add("lower(p.property_type) LIKE ?","%"+type.toLowerCase()+"%");
 const city=clean(params.get("city"),100);if(city){c.push("(lower(p.city) LIKE ? OR lower(p.location) LIKE ?)");v.push("%"+city.toLowerCase()+"%","%"+city.toLowerCase()+"%");}
 const state=clean(params.get("state"),100);if(state)add("lower(p.state) LIKE ?","%"+state.toLowerCase()+"%");
 const country=clean(params.get("country"),100);if(country)add("lower(p.country) LIKE ?","%"+country.toLowerCase()+"%");
 const currency=clean(params.get("currency"),3).toUpperCase();if(currency)add("p.currency = ?",currency);
 const min=money(params.get("min_price"));if(min&&currency)add("p.price >= ?",String(min));
 const max=money(params.get("max_price"));if(max&&currency)add("p.price <= ?",String(max));
 const beds=Number(params.get("bedrooms"));if(Number.isInteger(beds)&&beds>0)add("p.bedrooms >= ?",String(beds));
 return {where:c.join(" AND "),values:v};
}
async function searchProperties(env,params,limit=24){
 const f=filters(params);const sql="SELECT p.*,(SELECT i.image_data FROM property_images i WHERE i.property_id=p.id ORDER BY i.sort_order LIMIT 1) AS cover_image,(SELECT COUNT(*) FROM property_images i WHERE i.property_id=p.id) AS image_count FROM properties p WHERE "+f.where+" ORDER BY p.created_at DESC LIMIT ?";
 const r=await env.DB.prepare(sql).bind(...f.values,Math.min(Math.max(limit,1),40)).all();return r.results||[];
}
async function aiSearch(env,text){
 const model=env.GEMINI_MODEL||DEFAULT_MODEL;
 const prompt="Convert this buyer property request into JSON only with keys purpose (sale|rent|null), country, city, state (or province/region), property_type, min_price, max_price, currency (ISO 4217 code such as USD, GBP, EUR, NGN, CAD, AUD, AED), bedrooms, features (array). Use null when unspecified. Interpret budgets in the currency stated or reasonably indicated by the location; never assume naira for other countries. Do not invent. Request: "+text;
 const r=await fetch("https://generativelanguage.googleapis.com/v1beta/models/"+encodeURIComponent(model)+":generateContent",{method:"POST",headers:{"Content-Type":"application/json","x-goog-api-key":env.GEMINI_API_KEY},body:JSON.stringify({contents:[{role:"user",parts:[{text:prompt}]}],generationConfig:{temperature:.1,responseMimeType:"application/json",maxOutputTokens:300}})});
 const p=await r.json();if(!r.ok)throw new Error("AI search is temporarily unavailable.");const raw=(p.candidates?.[0]?.content?.parts||[]).map(x=>x.text||"").join("").trim();const criteria=JSON.parse(raw);const params=new URLSearchParams();
 ["purpose","country","city","state","property_type","min_price","max_price","currency","bedrooms"].forEach(k=>{if(criteria[k]!==null&&criteria[k]!==undefined&&criteria[k]!=="")params.set(k,String(criteria[k]));});
 return {criteria,params};
}
async function externalPropertySearch(env,query,criteria){
 if(!env.TAVILY_API_KEY)throw new Error("Global property search is not configured yet.");
 const location=[criteria.city,criteria.state,criteria.country].filter(Boolean).join(", ");
 const intent=criteria.purpose==="rent"?"property for rent rental listing":"property for sale real estate listing";
 const searchQuery=[query,intent,location,"actual property listing asking price property photographs"].filter(Boolean).join(" ").slice(0,900);
 const response=await fetch("https://api.tavily.com/search",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({api_key:env.TAVILY_API_KEY,query:searchQuery,topic:"general",search_depth:"basic",max_results:8,include_answer:false,include_images:true,include_image_descriptions:true,include_raw_content:true})});
 const payload=await response.json().catch(()=>({}));
 if(!response.ok)throw new Error(response.status===401||response.status===403?"The global search key was rejected. Check the Tavily secret in Cloudflare.":"The global property search provider is temporarily unavailable.");
 const results=(Array.isArray(payload.results)?payload.results:[]).filter(x=>x&&typeof x.url==="string"&&/^https:\/\//i.test(x.url)&&typeof x.title==="string").slice(0,8).map(x=>{
   const raw=typeof x.raw_content==="string"?x.raw_content:"";const snippet=clean(x.content||raw,900);
   let source="";try{source=new URL(x.url).hostname.replace(/^www\./,"");}catch{}
   // Never use generic search-image results. Photos must come from this listing page itself.
   return {title:clean(x.title,220),url:x.url,snippet,source,image_urls:[],image_url:null,score:Number(x.score)||0,listing_status:"External listing — verify availability and details with the original advertiser"};
  });
  // Extract photos directly from each individual listing URL; leave the gallery empty if none are found.
  const needs=results;
  if(needs.length){
   try{
    const ex=await fetch("https://api.tavily.com/extract",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({api_key:env.TAVILY_API_KEY,urls:needs.map(x=>x.url),extract_depth:"basic",include_images:true})});
    if(ex.ok){
     const ep=await ex.json();
     const byUrl=new Map((Array.isArray(ep.results)?ep.results:[]).filter(x=>x&&typeof x.url==="string").map(x=>[x.url,Array.isArray(x.images)?[...new Set(x.images.map(im=>typeof im==="string"?im:im&&im.url).filter(u=>typeof u==="string"&&/^https:\/\//i.test(u)))].slice(0,6):[]]));
     for(const item of needs){const found=byUrl.get(item.url)||[];item.image_urls=found;item.image_url=found[0]||null;}
    }
   }catch(err){console.warn("Listing-page image extraction failed; leaving images empty",err);}
  }
 // Only classify a price when the source gives one unambiguous amount in the requested currency.
 const max=Number(criteria.max_price),currency=String(criteria.currency||"").toUpperCase();
 const symbol=currency==="GBP"?"£":currency==="USD"?"\\$":currency==="EUR"?"€":currency==="NGN"?"₦":null;
 for(const item of results){
  item.budget_status="not_verified";item.criteria_currency=currency||null;
  if(!Number.isFinite(max)||max<=0||!symbol)continue;
  const text=item.title+" "+item.snippet;
  const matches=[...text.matchAll(new RegExp(symbol+"\\s*([0-9][0-9,]*(?:\\.[0-9]+)?)","g"))].map(m=>Number(m[1].replace(/,/g,""))).filter(Number.isFinite);
  if(matches.length===1){item.listing_price=matches[0];item.budget_status=matches[0]>max?"over_budget":"within_budget";}
 }
 return results;
}
async function listingCopy(env,prompt){
 const instruction="You are AgentCoPilot's real-estate listing writer. Use only seller-supplied facts. Never invent or infer features, condition, security, size, amenities, price, legal status or neighborhood claims. If input is not genuine property information, ask for valid details. Write concise, accurate copy only.";
 const model=env.GEMINI_MODEL||DEFAULT_MODEL;
 const r=await fetch("https://generativelanguage.googleapis.com/v1beta/models/"+encodeURIComponent(model)+":generateContent",{method:"POST",headers:{"Content-Type":"application/json","x-goog-api-key":env.GEMINI_API_KEY},body:JSON.stringify({systemInstruction:{parts:[{text:instruction}]},contents:[{role:"user",parts:[{text:prompt}]}],generationConfig:{temperature:.25,topP:.8,maxOutputTokens:700}})});
 const p=await r.json();if(!r.ok)throw new Error(r.status===429?"The AI service is temporarily busy. Please try again shortly.":"The AI service could not complete this request.");const out=(p.candidates?.[0]?.content?.parts||[]).map(x=>x.text||"").join("").trim();if(!out)throw new Error("The AI returned an empty response.");return out;
}
export default {async fetch(request,env){
 const origin=request.headers.get("Origin")||"";const allowed=(env.ALLOWED_ORIGIN||"https://etidoz1.github.io").split(",").map(x=>x.trim()).filter(Boolean);const headers=cors(origin,allowed);if(request.method==="OPTIONS")return origin&&!allowed.includes(origin)?json({error:"Origin not allowed."},403):new Response(null,{status:204,headers});
 const url=new URL(request.url);if(url.pathname==="/health"&&request.method==="GET")return json({status:"ok",service:"AgentCoPilot property marketplace",database:!!env.DB,ai:!!env.GEMINI_API_KEY,global_search:!!env.TAVILY_API_KEY},200,headers);
 if(origin&&!allowed.includes(origin))return json({error:"Origin not allowed."},403,headers);
 try{
  if(url.pathname==="/api/properties"&&request.method==="GET"){const rows=await searchProperties(env,url.searchParams,Number(url.searchParams.get("limit")||24));return json({properties:rows},200,headers);}
  if(url.pathname==="/api/properties"&&request.method==="POST"){
   const user=await currentUser(request,env);if(!user)return json({error:"Please sign in again before publishing."},401,headers);const b=await request.json();
   const name=clean(b.seller_name,100),phone=clean(b.seller_phone,40),purpose=clean(b.purpose,10).toLowerCase(),type=clean(b.property_type,80),title=clean(b.title,140),description=clean(b.description,3000),location=clean(b.location,240),city=clean(b.city,100),state=clean(b.state,100),country=clean(b.country,100),currency=clean(b.currency,3).toUpperCase(),price=money(b.price),photos=Array.isArray(b.photos)?b.photos.slice(0,5):[];
   if(!name||!phone||!["sale","rent"].includes(purpose)||!type||!title||!description||!location||!city||!country||! /^[A-Z]{3}$/.test(currency)||!price)return json({error:"Complete all required property and seller details."},400,headers);
   if(b.authority_confirmed!==true||b.contact_consent!==true)return json({error:"Confirm your authority to list and consent to public contact details."},400,headers);
   if(!photos.length)return json({error:"Upload at least one real property photograph."},400,headers);
   for(const photo of photos)if(typeof photo!=="string"||!/^data:image\/(jpeg|png|webp);base64,/.test(photo)||photo.length>430000)return json({error:"Each photo must be JPG, PNG or WebP and under approximately 300 KB after compression."},400,headers);
   const id=crypto.randomUUID(),now=new Date().toISOString(),features=Array.isArray(b.features)?b.features.map(x=>clean(x,100)).filter(Boolean).slice(0,20):[];
   const statements=[env.DB.prepare("INSERT INTO properties (id,seller_uid,seller_name,seller_phone,seller_email,purpose,property_type,title,description,location,city,state,country,price,currency,bedrooms,bathrooms,size_sqm,condition,features,status,created_at,updated_at,seller_authority_confirmed,contact_consent) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, ?,?,?,?,? ,'published',?,?,1,1)").bind(id,user.uid,name,phone,user.email,purpose,type,title,description,location,city,state,country,price,currency,Number(b.bedrooms)||null,Number(b.bathrooms)||null,Number(b.size_sqm)||null,clean(b.condition,80),JSON.stringify(features),now,now)];
   photos.forEach((photo,i)=>statements.push(env.DB.prepare("INSERT INTO property_images (id,property_id,image_data,mime_type,sort_order,created_at) VALUES (?,?,?,?,?,?)").bind(crypto.randomUUID(),id,photo,photo.slice(5,photo.indexOf(";")),i,now)));
   await env.DB.batch(statements);return json({success:true,property_id:id,message:"Your property has been published."},201,headers);
  }
  if(url.pathname.startsWith("/api/properties/")&&request.method==="GET"){
   const id=url.pathname.split("/").pop(),row=await env.DB.prepare("SELECT * FROM properties WHERE id=? AND status='published'").bind(id).first();if(!row)return json({error:"Property not found."},404,headers);
   const imgs=await env.DB.prepare("SELECT id,image_data,mime_type,sort_order FROM property_images WHERE property_id=? ORDER BY sort_order").bind(id).all();return json({property:row,images:imgs.results||[]},200,headers);
  }
  if(url.pathname==="/api/ai-search"&&request.method==="POST"){
   const user=await currentUser(request,env);if(!user)return json({error:"Please sign in to search properties."},401,headers);const b=await request.json(),q=clean(b.query,1200);if(q.length<8)return json({error:"Describe the property you want in more detail."},400,headers);
   const parsed=await aiSearch(env,q);const [rows,external]=await Promise.all([searchProperties(env,parsed.params,24),externalPropertySearch(env,q,parsed.criteria)]);const features=Array.isArray(parsed.criteria.features)?parsed.criteria.features:[];
   const results=rows.map(row=>{let score=0;const reasons=[];if(parsed.criteria.city&&row.city.toLowerCase().includes(String(parsed.criteria.city).toLowerCase())){score+=30;reasons.push("Preferred location");}if(parsed.criteria.property_type&&row.property_type.toLowerCase().includes(String(parsed.criteria.property_type).toLowerCase())){score+=20;reasons.push("Property type");}if(parsed.criteria.bedrooms&&Number(row.bedrooms)>=Number(parsed.criteria.bedrooms)){score+=15;reasons.push("Bedroom requirement");}if(parsed.criteria.max_price&&parsed.criteria.currency&&row.currency===String(parsed.criteria.currency).toUpperCase()&&row.price<=Number(parsed.criteria.max_price)){score+=20;reasons.push("Within budget");}if(parsed.criteria.purpose&&row.purpose===parsed.criteria.purpose){score+=15;reasons.push("Sale/rent preference");}const fs=JSON.parse(row.features||"[]").map(x=>x.toLowerCase());features.forEach(f=>{if(fs.some(x=>x.includes(String(f).toLowerCase()))){score+=5;reasons.push("Feature: "+f);}});return Object.assign({},row,{match_score:Math.min(score,100),match_reasons:reasons});}).sort((a,b)=>b.match_score-a.match_score);
   return json({criteria:parsed.criteria,properties:results,external_results:external,search_scope:"global_web_and_agentcopilot"},200,headers);
  }
  if(url.pathname==="/api/generate"&&request.method==="POST"){const b=await request.json(),prompt=clean(b.prompt,12000);if(!prompt)return json({error:"Please provide property information."},400,headers);return json({result:await listingCopy(env,prompt)},200,headers);}
  return json({error:"Not found."},404,headers);
 }catch(e){console.error("AgentCoPilot API error",e);return json({error:e.message||"The request could not be completed."},500,headers);}
}};
