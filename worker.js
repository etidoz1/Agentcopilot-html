const DEFAULT_MODEL = "gemini-3.5-flash-lite";
function json(data,status=200,headers={}){return new Response(JSON.stringify(data),{status,headers:Object.assign({"Content-Type":"application/json; charset=utf-8"},headers)});}
function clean(v,n=500){return typeof v==="string"?v.trim().slice(0,n):"";}
function cleanExternalSnippet(value){
 let text=typeof value==="string"?value:"";
 text=text.replace(/<!--[\s\S]*?-->/g," ").replace(/<[^>]*>/g," ").replace(/&nbsp;|&#160;/gi," ").replace(/&amp;/gi,"&").replace(/&quot;/gi,'"').replace(/&#39;|&apos;/gi,"'").replace(/&lt;/gi,"<").replace(/&gt;/gi,">");
 const junk=[/property images coming soon/gi,/loading (?:development )?carousel/gi,/see more of this development/gi,/highlight/gi,/premium/gi,/just added/gi,/back to market/gi,/new home/gi,/outside space/gi,/extended warranties/gi,/\b\d+\s*\/\s*\d+\b/g,/\b\d+\s+results?\b/gi,/\[\.\.\.\]/g];
 for(const re of junk)text=text.replace(re," ");
 text=text.replace(/\s+/g," ").trim();
 if(!text||text.length<45||/^(?:houses?|homes?|properties?)\s+for\s+(?:sale|rent)\b/i.test(text))return "The source did not provide a clean property description. Open the original listing to review its details.";
 return text.slice(0,650);
}
function money(v){const n=Number(v);return Number.isFinite(n)&&n>0?n:null;}
function cors(origin,allowed){return origin&&allowed.includes(origin)?{"Access-Control-Allow-Origin":origin,"Access-Control-Allow-Methods":"GET, POST, PATCH, DELETE, OPTIONS","Access-Control-Allow-Headers":"Content-Type, Authorization","Access-Control-Max-Age":"86400","Vary":"Origin"}:{};}
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
  const signature=b64urlBytes(parts[2]),message=new TextEncoder().encode(parts[0]+"."+parts[1]);const valid=await crypto.subtle.verify("RSASSA-PKCS1-v1_5",key,signature,message);return valid?{uid:claims.sub,email:claims.email||"",token}:null;
 }catch(e){console.error("Firebase token verification failed",e);return null;}
}

async function userRole(user){
 const url="https://firestore.googleapis.com/v1/projects/agentcopilot-98817/databases/(default)/documents/users/"+encodeURIComponent(user.uid);
 try{const r=await fetch(url,{headers:{Authorization:"Bearer "+user.token}});if(!r.ok)return "user";const d=await r.json();return String(d.fields?.role?.stringValue||"user").toLowerCase();}catch{return "user";}
}
async function isAdmin(user){const role=await userRole(user);return role==="admin"||role==="owner";}
async function notify(env,userUid,type,title,message,link=""){await env.DB.prepare("INSERT INTO notifications (id,user_uid,type,title,message,link,created_at) VALUES (?,?,?,?,?,?,?)").bind(crypto.randomUUID(),userUid,type,title,message,link,new Date().toISOString()).run();await env.DB.prepare("DELETE FROM notifications WHERE user_uid=? AND id NOT IN (SELECT id FROM notifications WHERE user_uid=? ORDER BY created_at DESC,id DESC LIMIT 5)").bind(userUid,userUid).run();}

const INTELLIGENCE_VERSION="1.0.0";
function intelligenceFieldType(key){
 const k=String(key||"").toLowerCase();
 if(/(?:phone|mobile|whatsapp|email|telephone|contact)/.test(k))return "contact";
 if(/(?:price|amount|budget|currency|fee|cost)/.test(k))return "price";
 if(/(?:location|address|city|state|country|region|postcode|postal)/.test(k))return "location";
 if(/(?:url|source|domain|link)/.test(k))return "source";
 if(/(?:availability|verified|checked|status)/.test(k))return "availability";
 if(/(?:image|photo|cover|gallery)/.test(k))return "media";
 if(/(?:bedroom|bathroom|size|sqm|condition|feature|purpose|property|title|description|type)/.test(k))return "property_detail";
 if(/(?:seller_name|buyer_name|name|uid|id)$/.test(k))return "identity";
 return "other";
}
function redactContactText(value){
 if(typeof value!=="string")return value;
 return value
  .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,"[contact protected]")
  // Protect phone numbers even when digits are grouped with spaces, brackets, dots or hyphens.
  .replace(/(?<![\w])\+?(?:[\s().-]*\d){10,15}(?![\w])/g,match=>{
   const digits=match.replace(/\D/g,"");
   return digits.length>=10&&digits.length<=15?"[contact protected]":match;
  });
}
function intelligenceProcessRecord(record){
 if(!record||typeof record!=="object"||Array.isArray(record))return record;
 const cleanRecord={},fieldTypes={};let protectedCount=0;
 for(const [key,raw] of Object.entries(record)){
  const type=intelligenceFieldType(key);fieldTypes[key]=type;
  if(type==="contact"){if(raw)protectedCount++;continue;}
  if(typeof raw==="string"&&type!=="source"&&type!=="media")cleanRecord[key]=redactContactText(raw);
  else if(Array.isArray(raw))cleanRecord[key]=(type==="media"||type==="source")?raw:raw.map(v=>typeof v==="string"?redactContactText(v):v);
  else cleanRecord[key]=raw;
 }
 cleanRecord.intelligence={engine:"AgentCoPilot Intelligence Engine",version:INTELLIGENCE_VERSION,processed:true,field_types:fieldTypes,protected_contact_fields:protectedCount};
 return cleanRecord;
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
 const r=await env.DB.prepare(sql).bind(...f.values,Math.min(Math.max(limit,1),40)).all();return (r.results||[]).map(({seller_phone,seller_email,...publicRow})=>intelligenceProcessRecord(publicRow));
}
async function aiSearch(env,text){
 const model=env.GEMINI_MODEL||DEFAULT_MODEL;
 const prompt="Convert this buyer property request into JSON only with keys purpose (sale|rent|null), country, city, state (or province/region), property_type, min_price, max_price, currency (ISO 4217 code such as USD, GBP, EUR, NGN, CAD, AUD, AED), bedrooms, features (array). Use null when unspecified. Interpret budgets in the currency stated or reasonably indicated by the location; never assume naira for other countries. Do not invent. Request: "+redactContactText(text);
 const r=await fetch("https://generativelanguage.googleapis.com/v1beta/models/"+encodeURIComponent(model)+":generateContent",{method:"POST",headers:{"Content-Type":"application/json","x-goog-api-key":env.GEMINI_API_KEY},body:JSON.stringify({contents:[{role:"user",parts:[{text:prompt}]}],generationConfig:{temperature:.1,responseMimeType:"application/json",maxOutputTokens:300}})});
 const p=await r.json();if(!r.ok)throw new Error("AI search is temporarily unavailable.");const raw=(p.candidates?.[0]?.content?.parts||[]).map(x=>x.text||"").join("").trim();const criteria=JSON.parse(raw);const params=new URLSearchParams();
 ["purpose","country","city","state","property_type","min_price","max_price","currency","bedrooms"].forEach(k=>{if(criteria[k]!==null&&criteria[k]!==undefined&&criteria[k]!=="")params.set(k,String(criteria[k]));});
 return {criteria,params};
}
function filterExtractedPropertyImages(images,pageUrl){
 const blocked=/(?:logo|icon|avatar|favicon|banner|header|footer|sprite|badge|floor.?plan|map|brochure|watermark|placeholder|no.?image|agent|agency|brand|social|share|cover|thumbnail)/i;
 const base=new URL(pageUrl);
 const out=[];
 for(const value of Array.isArray(images)?images:[]){
  if(typeof value!=="string")continue;
  try{
   const u=new URL(value,base.href),path=u.pathname.toLowerCase();
   if(u.protocol!=="https:"||blocked.test(path)||out.includes(u.href))continue;
   if(!/\.(?:jpe?g|png|webp|avif)(?:$)/i.test(path)&&!/(?:image|photo|gallery|media|property|listing|upload|cdn)/i.test(path))continue;
   out.push(u.href);
  }catch{}
  if(out.length>=6)break;
 }
 return redactContactText(out);
}
async function tavilyListingImages(env,items){
 const pending=items.filter(x=>!x.image_urls?.length&&x.url).slice(0,8);
 if(!pending.length||!env.TAVILY_API_KEY)return;
 try{
  const response=await fetch("https://api.tavily.com/extract",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({api_key:env.TAVILY_API_KEY,urls:pending.map(x=>x.url),extract_depth:"basic",include_images:true,include_usage:true}),signal:AbortSignal.timeout(30000)});
  if(!response.ok){console.warn("Tavily image extraction unavailable",response.status);return;}
  const payload=await response.json();
  for(const extracted of Array.isArray(payload.results)?payload.results:[]){
   const item=pending.find(x=>x.url===extracted.url);if(!item)continue;
   const images=filterExtractedPropertyImages(extracted.images,item.url);
   if(images.length){item.image_urls=images;item.image_url=images[0];item.image_attribution="Images extracted from the original property listing page by Tavily; confirm against source listing.";}
  }
  console.log("Tavily property image extraction",JSON.stringify({attempted:pending.length,withImages:pending.filter(x=>x.image_urls?.length).length,usage:payload.usage||null}));
 }catch(error){console.warn("Tavily property image extraction failed",error);}
}
async function listingPageImages(pageUrl){
 try{
  const page=new URL(pageUrl);if(page.protocol!=="https:")return [];
  const response=await fetch(page.href,{headers:{"Accept":"text/html,application/xhtml+xml","User-Agent":"Mozilla/5.0 (compatible; AgentCoPilotPropertyBot/1.0)"},redirect:"follow",signal:AbortSignal.timeout(7000)});
  const type=response.headers.get("content-type")||"";if(!response.ok||!type.toLowerCase().includes("html"))return [];
  const html=(await response.text()).slice(0,1500000),propertyImages=[];
  const blocked=/(?:logo|icon|avatar|favicon|banner|header|footer|sprite|badge|floor.?plan|map|brochure|watermark|placeholder|no.?image|agent|agency|brand|social|share|cover|thumbnail)/i;
  const add=(value)=>{if(typeof value!=="string")return;let u=value.trim().replace(/&amp;/gi,"&").replace(/&#38;/gi,"&");if(!u)return;try{const parsed=new URL(u,page.href),path=parsed.pathname.toLowerCase();if(parsed.protocol!=="https:"||blocked.test(path)||propertyImages.includes(parsed.href))return;propertyImages.push(parsed.href);}catch{}};
  const residentialTypes=["house","apartment","singlefamilyresidence","residence","realestatelisting","realestateproperty"];
  const visit=(node,depth=0)=>{
   if(!node||depth>14)return;
   if(Array.isArray(node)){node.slice(0,120).forEach(x=>visit(x,depth+1));return;}
   if(typeof node!=="object")return;
   const types=(Array.isArray(node["@type"])?node["@type"]:[node["@type"]]).filter(Boolean).map(x=>String(x).toLowerCase());
   if(types.some(t=>residentialTypes.includes(t))){
    const imgs=Array.isArray(node.image)?node.image:[node.image];
    for(const im of imgs){if(typeof im==="string")add(im);else if(im&&typeof im==="object")add(im.contentUrl||im.url||im.thumbnailUrl);}
   }
   for(const [key,value] of Object.entries(node))if(key!=="logo"&&key!=="image")visit(value,depth+1);
  };
  for(const block of html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)){
   try{const root=JSON.parse(block[1].replace(/^\s*<!--|-->\s*$/g,""));visit(root);}catch{}
  }
  // Deliberately do not use og:image or twitter:image: those usually represent the agency's banner or social preview, not the house.
  return propertyImages.slice(0,6);
 }catch(error){console.warn("Could not verify property-specific image metadata",pageUrl,error);return [];}
}
function isLikelyResidentialListing(item){
 const title=String(item.title||'').toLowerCase();
 const snippet=String(item.content||item.raw_content||'').toLowerCase().replace(/<[^>]*>/g,' ');
 let host='',path='';try{const u=new URL(item.url);host=u.hostname.toLowerCase().replace(/^www\./,'');path=u.pathname.toLowerCase();}catch{return false;}
 const text=title+' '+snippet.slice(0,5000)+' '+path;
 const rejectHost=/(^|\.)(mapquest|tripadvisor|yelp|booking\.com|hotels\.com|expedia|agoda|trivago|opentable|zomato|foursquare)\./i;
 if(rejectHost.test(host))return false;
 const reject= /\b(hotel|hotels|motel|hostel|guesthouse|guest house|resort|restaurant|cafe|coffee shop|bar|directions|mapquest|tripadvisor|booking\.com|hotel booking|check availability|room rates|accommodation provider|car rental|gas station|grocery|shopping)\b/i;
 const residential=/\b(house|houses|home|homes|apartment|apartments|flat|flats|condo|condominium|townhouse|bungalow|villa|duplex|penthouse|residential property|real estate|property)\b/i.test(text);
 const transaction=/\b(for sale|for rent|to rent|to buy|buying|renting|sale price|asking price|property listing|residential listing|estate agent|real estate agent|property portal|properties for sale|properties to rent|houses for sale|flats to rent)\b/i.test(text);
 const numericDetail=/\b\d+\s*(?:bed(?:room)?s?|bath(?:room)?s?)\b|(?:£|\$|€|₦)\s?\d|\b(?:USD|GBP|EUR|NGN)\s?\d/i.test(text);
 if(reject.test(title+' '+path))return false;
 if(!residential)return false;
 if(!transaction&&!numericDetail)return false;
 if(/\b(availability|directions|photos image \d+|terms of use|privacy policy|do not sell|advertisement)\b/i.test(title+' '+snippet.slice(0,700))&&!transaction)return false;
 return true;
}
async function externalPropertySearch(env,query,criteria){
 if(!env.TAVILY_API_KEY)throw new Error("Global property search is not configured yet.");
 const location=[criteria.city,criteria.state,criteria.country].filter(Boolean).join(", ");
 const intent=criteria.purpose==="rent"?"residential property homes apartments flats houses for rent estate agent listing":"residential property homes apartments flats houses for sale estate agent listing";
 const searchQuery=[query,intent,location,"individual residential property listing price bedrooms estate agency property portal"].filter(Boolean).join(" ").slice(0,900);
 const response=await fetch("https://api.tavily.com/search",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({api_key:env.TAVILY_API_KEY,query:searchQuery,topic:"general",search_depth:"advanced",max_results:15,include_answer:false,include_raw_content:false,exclude_domains:["mapquest.com","tripadvisor.com","yelp.com","booking.com","hotels.com","expedia.com","agoda.com","trivago.com","opentable.com","zomato.com"]})});
 const payload=await response.json().catch(()=>({}));
 if(!response.ok)throw new Error(response.status===401||response.status===403?"The global search key was rejected. Check the Tavily secret in Cloudflare.":"The global property search provider is temporarily unavailable.");
 const candidates=(Array.isArray(payload.results)?payload.results:[]).filter(x=>x&&typeof x.url==="string"&&/^https:\/\//i.test(x.url)&&typeof x.title==="string"&&isLikelyResidentialListing(x));
 const results=candidates.slice(0,8).map(x=>{
  const snippet=cleanExternalSnippet(x.content||"");let source="";try{source=new URL(x.url).hostname.replace(/^www\./,"");}catch{}
  return intelligenceProcessRecord({title:clean(x.title,220),url:x.url,snippet,source,image_urls:[],image_url:null,image_attribution:null,score:Number(x.score)||0,listing_status:"External residential result — verify availability and details with the original advertiser"});
 });
 await Promise.all(results.map(async item=>{const images=await listingPageImages(item.url);item.image_urls=images;item.image_url=images[0]||null;item.image_attribution=images.length?"Property-specific structured data from the original listing page":"unavailable";}));
 await tavilyListingImages(env,results);
 const max=Number(criteria.max_price),currency=String(criteria.currency||"").toUpperCase();
 const symbol=currency==="GBP"?"£":currency==="USD"?"\\$":currency==="EUR"?"€":currency==="NGN"?"₦":null;
 for(const item of results){item.budget_status="not_verified";item.criteria_currency=currency||null;if(!Number.isFinite(max)||max<=0||!symbol)continue;const text=item.title+" "+item.snippet;const matches=[...text.matchAll(new RegExp(symbol+"\\s*([0-9][0-9,]*(?:\\.[0-9]+)?)","g"))].map(m=>Number(m[1].replace(/,/g,""))).filter(Number.isFinite);if(matches.length===1){item.listing_price=matches[0];item.budget_status=matches[0]>max?"over_budget":"within_budget";}}
 return results;
}
async function listingCopy(env,prompt){
 const instruction="You are AgentCoPilot's real-estate listing writer. Use only seller-supplied facts. Never invent or infer features, condition, security, size, amenities, price, legal status or neighborhood claims. If input is not genuine property information, ask for valid details. Write concise, accurate copy only.";
 const safePrompt=redactContactText(prompt);
 const model=env.GEMINI_MODEL||DEFAULT_MODEL;
 const r=await fetch("https://generativelanguage.googleapis.com/v1beta/models/"+encodeURIComponent(model)+":generateContent",{method:"POST",headers:{"Content-Type":"application/json","x-goog-api-key":env.GEMINI_API_KEY},body:JSON.stringify({systemInstruction:{parts:[{text:instruction}]},contents:[{role:"user",parts:[{text:safePrompt}]}],generationConfig:{temperature:.25,topP:.8,maxOutputTokens:700}})});
 const p=await r.json();if(!r.ok)throw new Error(r.status===429?"The AI service is temporarily busy. Please try again shortly.":"The AI service could not complete this request.");const out=(p.candidates?.[0]?.content?.parts||[]).map(x=>x.text||"").join("").trim();if(!out)throw new Error("The AI returned an empty response.");return redactContactText(out);
}
async function agentAccessTable(env){await env.DB.prepare("CREATE TABLE IF NOT EXISTS agent_subscriptions (user_uid TEXT PRIMARY KEY,status TEXT NOT NULL,started_at TEXT NOT NULL,expires_at TEXT NOT NULL,last_reference TEXT NOT NULL,updated_at TEXT NOT NULL)").run();}
async function hasAgentAccess(env,uid){await agentAccessTable(env);const row=await env.DB.prepare("SELECT expires_at,status FROM agent_subscriptions WHERE user_uid=?").bind(uid).first();return !!row&&row.status==='active'&&Date.parse(row.expires_at)>Date.now();}
async function recheckExternalListings(env, limit=20){
 await env.DB.prepare("CREATE TABLE IF NOT EXISTS external_listing_verification (id TEXT PRIMARY KEY,url TEXT NOT NULL,title TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'unchecked',last_checked_at TEXT,next_check_at TEXT,check_count INTEGER NOT NULL DEFAULT 0,updated_at TEXT NOT NULL)").run();
 const now=new Date().toISOString();
 const due=await env.DB.prepare("SELECT id,url,title,check_count FROM external_listing_verification WHERE next_check_at IS NULL OR next_check_at<=? ORDER BY COALESCE(next_check_at,'') LIMIT ?").bind(now,limit).all();
 let checked=0;
 for(const item of (due.results||[])){
  let status='uncertain',delay=6*60*60*1000;
  try{
   const response=await fetch(item.url,{method:'GET',redirect:'follow',headers:{'User-Agent':'AgentCoPilot-ListingCheck/1.0 (+availability status check)','Range':'bytes=0-18000'},signal:AbortSignal.timeout(12000)});
   const finalUrl=response.url||item.url;
   if(response.status===404||response.status===410){status='removed';delay=7*24*60*60*1000;}
   else if(response.status===401||response.status===403||response.status===429||response.status>=500){status='uncertain';delay=24*60*60*1000;}
   else if(response.ok){
    const body=(await response.text()).slice(0,22000).toLowerCase();
    if(/\b(sold|rented|let agreed|property has been let|no longer available|listing withdrawn|property withdrawn|listing removed)\b/.test(body)){status='unavailable';delay=7*24*60*60*1000;}
    else {status='source_page_live_unconfirmed';delay=24*60*60*1000;}
   }else {status='uncertain';delay=24*60*60*1000;}
   if(finalUrl!==item.url)await env.DB.prepare("UPDATE external_listing_verification SET url=? WHERE id=?").bind(finalUrl,item.id).run();
  }catch(error){status='uncertain';delay=24*60*60*1000;}
  const checkedAt=new Date().toISOString(),nextAt=new Date(Date.now()+delay).toISOString();
  await env.DB.prepare("UPDATE external_listing_verification SET status=?,last_checked_at=?,next_check_at=?,check_count=check_count+1,updated_at=? WHERE id=?").bind(status,checkedAt,nextAt,checkedAt,item.id).run();checked++;
 }
 return {checked};
}
export default {async scheduled(controller,env,ctx){ctx.waitUntil(recheckExternalListings(env,20));},async fetch(request,env){
 const origin=request.headers.get("Origin")||"";const allowed=(env.ALLOWED_ORIGIN||"https://etidoz1.github.io").split(",").map(x=>x.trim()).filter(Boolean);const headers=cors(origin,allowed);if(request.method==="OPTIONS")return origin&&!allowed.includes(origin)?json({error:"Origin not allowed."},403):new Response(null,{status:204,headers});
 const url=new URL(request.url);if(url.pathname==="/health"&&request.method==="GET")return json({status:"ok",service:"AgentCoPilot property marketplace",database:!!env.DB,ai:!!env.GEMINI_API_KEY,global_search:!!env.TAVILY_API_KEY},200,headers);
 if(origin&&!allowed.includes(origin))return json({error:"Origin not allowed."},403,headers);
 try{
  if(url.pathname==="/api/properties"&&request.method==="GET"){const rows=await searchProperties(env,url.searchParams,Number(url.searchParams.get("limit")||24));return json({properties:rows},200,headers);}
  if(url.pathname==="/api/properties"&&request.method==="POST"){
   const user=await currentUser(request,env);if(!user)return json({error:"Please sign in again before publishing."},401,headers);const b=await request.json();
   const name=redactContactText(clean(b.seller_name,100)),phone=clean(b.seller_phone,40),purpose=clean(b.purpose,10).toLowerCase(),type=clean(b.property_type,80),title=redactContactText(clean(b.title,140)),description=redactContactText(clean(b.description,3000)),location=redactContactText(clean(b.location,240)),city=redactContactText(clean(b.city,100)),state=redactContactText(clean(b.state,100)),country=redactContactText(clean(b.country,100)),currency=clean(b.currency,3).toUpperCase(),price=money(b.price),photos=Array.isArray(b.photos)?b.photos.slice(0,5):[];
   if(!name||!phone||!["sale","rent"].includes(purpose)||!type||!title||!description||!location||!city||!country||! /^[A-Z]{3}$/.test(currency)||!price)return json({error:"Complete all required property and seller details."},400,headers);
   if(b.authority_confirmed!==true||b.contact_consent!==true)return json({error:"Confirm your authority to list and consent to public contact details."},400,headers);
   if(!photos.length)return json({error:"Upload at least one real property photograph."},400,headers);
   for(const photo of photos)if(typeof photo!=="string"||!/^data:image\/(jpeg|png|webp);base64,/.test(photo)||photo.length>430000)return json({error:"Each photo must be JPG, PNG or WebP and under approximately 300 KB after compression."},400,headers);
   const id=crypto.randomUUID(),now=new Date().toISOString(),features=Array.isArray(b.features)?b.features.map(x=>clean(x,100)).filter(Boolean).slice(0,20):[];
   const statements=[env.DB.prepare("INSERT INTO properties (id,seller_uid,seller_name,seller_phone,seller_email,purpose,property_type,title,description,location,city,state,country,price,currency,bedrooms,bathrooms,size_sqm,condition,features,status,created_at,updated_at,seller_authority_confirmed,contact_consent) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, ?,?,?,?,? ,'published',?,?,1,1)").bind(id,user.uid,name,phone,user.email,purpose,type,title,description,location,city,state,country,price,currency,Number(b.bedrooms)||null,Number(b.bathrooms)||null,Number(b.size_sqm)||null,clean(b.condition,80),JSON.stringify(features),now,now)];
   photos.forEach((photo,i)=>statements.push(env.DB.prepare("INSERT INTO property_images (id,property_id,image_data,mime_type,sort_order,created_at) VALUES (?,?,?,?,?,?)").bind(crypto.randomUUID(),id,photo,photo.slice(5,photo.indexOf(";")),i,now)));
   await env.DB.batch(statements);try{await notify(env,user.uid,"listing_created","Property published",title+" is now live on AgentCoPilot.","./ai-tools.html#seller-panel");}catch(e){console.error("Listing notification failed",e);}return json({success:true,property_id:id,message:"Your property has been published."},201,headers);
  }
  if(url.pathname==="/api/my/properties"&&request.method==="GET"){
   const user=await currentUser(request,env);if(!user)return json({error:"Please sign in."},401,headers);
   const rows=await env.DB.prepare("SELECT id,title,purpose,property_type,price,currency,city,country,status,created_at,updated_at FROM properties WHERE seller_uid=? AND status!='deleted' ORDER BY created_at DESC LIMIT 100").bind(user.uid).all();
   return json({properties:rows.results||[]},200,headers);
  }
  if(url.pathname.startsWith("/api/my/properties/")&&(request.method==="PATCH"||request.method==="DELETE")){
   const user=await currentUser(request,env);if(!user)return json({error:"Please sign in."},401,headers);
   const id=decodeURIComponent(url.pathname.split("/").pop()||"");if(!id)return json({error:"A property ID is required."},400,headers);
   const property=await env.DB.prepare("SELECT id,seller_uid,title,purpose,status FROM properties WHERE id=?").bind(id).first();
   if(!property||property.seller_uid!==user.uid)return json({error:"This listing was not found in your account."},404,headers);
   const now=new Date().toISOString();
   if(request.method==="PATCH"){
    const b=await request.json().catch(()=>({}));if(clean(b.status,20).toLowerCase()!=="sold")return json({error:"The only seller status action available here is Mark as sold."},400,headers);
    if(property.purpose!=="sale")return json({error:"Only property-for-sale listings can be marked as sold."},400,headers);
    if(property.status==="sold")return json({success:true,status:"sold",message:"This property is already marked as sold."},200,headers);
    if(property.status!=="published")return json({error:"Only a currently published listing can be marked as sold."},409,headers);
    await env.DB.prepare("UPDATE properties SET status='sold',updated_at=? WHERE id=? AND seller_uid=? AND status='published'").bind(now,id,user.uid).run();
    try{await notify(env,user.uid,"listing_sold","Property marked as sold",property.title+" is no longer available to buyers. You can now delete the listing while its transaction records remain available.","./ai-tools.html#seller-panel");}catch(e){console.error("Sold listing notification failed",e);}
    return json({success:true,status:"sold",message:"Property marked as sold and removed from buyer search. You can now delete the listing."},200,headers);
   }
   if(property.status!=="sold")return json({error:"Mark this property as sold before deleting its listing."},409,headers);
   await env.DB.prepare("UPDATE properties SET status='deleted',updated_at=? WHERE id=? AND seller_uid=? AND status='sold'").bind(now,id,user.uid).run();
   return json({success:true,status:"deleted",message:"Listing deleted from your dashboard and marketplace. Payment and transaction records have been preserved."},200,headers);
  }
  if(url.pathname==="/api/agent-access/status"&&request.method==="GET"){const user=await currentUser(request,env);if(!user)return json({error:"Please sign in."},401,headers);await agentAccessTable(env);const row=await env.DB.prepare("SELECT status,started_at,expires_at FROM agent_subscriptions WHERE user_uid=?").bind(user.uid).first();const active=!!row&&row.status==="active"&&Date.parse(row.expires_at)>Date.now();return json({active,expires_at:active?row.expires_at:null,days_remaining:active?Math.max(0,Math.ceil((Date.parse(row.expires_at)-Date.now())/86400000)):0},200,headers);}
   if(url.pathname.startsWith("/api/external-listings/")&&url.pathname.endsWith("/contact")&&request.method==="GET"){const user=await currentUser(request,env);if(!user)return json({error:"Sign in to access original listing contact pages."},401,headers);if(!await hasAgentAccess(env,user.uid))return json({error:"A paid 30-day Agent Access subscription is required.",subscription_required:true},402,headers);const id=decodeURIComponent(url.pathname.split("/").slice(-2)[0]||"");await env.DB.prepare("CREATE TABLE IF NOT EXISTS external_listing_cache (id TEXT PRIMARY KEY,user_uid TEXT NOT NULL,url TEXT NOT NULL,title TEXT NOT NULL,expires_at TEXT NOT NULL)").run();const item=await env.DB.prepare("SELECT url,title FROM external_listing_cache WHERE id=? AND user_uid=? AND expires_at>?").bind(id,user.uid,new Date().toISOString()).first();if(!item)return json({error:"This search result has expired. Search again to refresh it."},404,headers);return json({url:item.url,title:item.title},200,headers);}
   if(url.pathname.startsWith("/api/properties/")&&url.pathname.endsWith("/contact")&&request.method==="GET"){const user=await currentUser(request,env);if(!user)return json({error:"Sign in to access agent contacts."},401,headers);if(!await hasAgentAccess(env,user.uid))return json({error:"A paid 30-day Agent Access subscription is required.",subscription_required:true},402,headers);const id=decodeURIComponent(url.pathname.split("/").slice(-2)[0]||"");const row=await env.DB.prepare("SELECT id,seller_name,seller_phone,seller_email FROM properties WHERE id=? AND status='published'").bind(id).first();if(!row)return json({error:"Property not found."},404,headers);return json({contact:row},200,headers);}
   if(url.pathname.startsWith("/api/properties/")&&request.method==="GET"){
   const id=url.pathname.split("/").pop(),row=await env.DB.prepare("SELECT * FROM properties WHERE id=? AND status='published'").bind(id).first();if(!row)return json({error:"Property not found."},404,headers);
   const {seller_phone,seller_email,...publicProperty}=row;const imgs=await env.DB.prepare("SELECT id,image_data,mime_type,sort_order FROM property_images WHERE property_id=? ORDER BY sort_order").bind(id).all();return json({property:intelligenceProcessRecord(publicProperty),images:imgs.results||[]},200,headers);
  }
  if(url.pathname==="/api/ai-search"&&request.method==="POST"){
   const user=await currentUser(request,env);if(!user)return json({error:"Please sign in to search properties."},401,headers);const b=await request.json(),q=clean(b.query,1200);if(q.length<8)return json({error:"Describe the property you want in more detail."},400,headers);
   const parsed=await aiSearch(env,q);
   // Database-first policy: query AgentCoPilot before any external property search.
   const rows=await searchProperties(env,parsed.params,24);
   const features=Array.isArray(parsed.criteria.features)?parsed.criteria.features:[];
   const results=rows.map(row=>{let score=0;const reasons=[];if(parsed.criteria.city&&String(row.city||"").toLowerCase().includes(String(parsed.criteria.city).toLowerCase())){score+=30;reasons.push("Preferred location");}if(parsed.criteria.property_type&&String(row.property_type||"").toLowerCase().includes(String(parsed.criteria.property_type).toLowerCase())){score+=20;reasons.push("Property type");}if(parsed.criteria.bedrooms&&Number(row.bedrooms)>=Number(parsed.criteria.bedrooms)){score+=15;reasons.push("Bedroom requirement");}if(parsed.criteria.max_price&&parsed.criteria.currency&&row.currency===String(parsed.criteria.currency).toUpperCase()&&Number(row.price)<=Number(parsed.criteria.max_price)){score+=20;reasons.push("Within budget");}if(parsed.criteria.purpose&&row.purpose===parsed.criteria.purpose){score+=15;reasons.push("Sale/rent preference");}const fs=JSON.parse(row.features||"[]").map(x=>String(x).toLowerCase());features.forEach(f=>{if(fs.some(x=>x.includes(String(f).toLowerCase()))){score+=5;reasons.push("Feature: "+f);}});return Object.assign({},row,{match_score:Math.min(score,100),match_reasons:reasons});}).sort((a,b)=>b.match_score-a.match_score);
   const minimumInternalResults=5;let external=[],externalFallbackUsed=false,externalSearchStatus="not_needed";
   if(results.length<minimumInternalResults){externalFallbackUsed=true;externalSearchStatus="searching";try{const found=await externalPropertySearch(env,q,parsed.criteria);external=found.slice(0,Math.max(1,minimumInternalResults-results.length));externalSearchStatus="completed";}catch(error){externalSearchStatus="unavailable";console.warn("External fallback search unavailable; preserving AgentCoPilot results",error);}}
   if(external.length){await env.DB.prepare("CREATE TABLE IF NOT EXISTS external_listing_cache (id TEXT PRIMARY KEY,user_uid TEXT NOT NULL,url TEXT NOT NULL,title TEXT NOT NULL,expires_at TEXT NOT NULL)").run();const expiry=new Date(Date.now()+30*60*1000).toISOString();await env.DB.prepare("CREATE TABLE IF NOT EXISTS external_listing_verification (id TEXT PRIMARY KEY,url TEXT NOT NULL,title TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'unchecked',last_checked_at TEXT,next_check_at TEXT,check_count INTEGER NOT NULL DEFAULT 0,updated_at TEXT NOT NULL)").run();for(const item of external){const cacheId=crypto.randomUUID();await env.DB.prepare("INSERT INTO external_listing_cache (id,user_uid,url,title,expires_at) VALUES (?,?,?,?,?)").bind(cacheId,user.uid,item.url,item.title,expiry).run();const nowCheck=new Date().toISOString();await env.DB.prepare("INSERT INTO external_listing_verification (id,url,title,status,next_check_at,updated_at) VALUES (?,?,?,'unchecked',?,?)").bind(cacheId,item.url,item.title,nowCheck,nowCheck).run();item.id=cacheId;item.availability_status='source_page_live_unconfirmed';item.availability_label='Source found — availability not confirmed';item.last_checked_at=null;item.url=null;}}
    return json({criteria:parsed.criteria,properties:results,external_results:external,internal_count:results.length,external_count:external.length,minimum_internal_results:minimumInternalResults,external_fallback_used:externalFallbackUsed,external_search_status:externalSearchStatus,search_scope:externalFallbackUsed?"agentcopilot_first_then_external":"agentcopilot_database_only"},200,headers);
  }

   if(url.pathname==="/api/notifications"&&request.method==="GET"){
    const user=await currentUser(request,env);if(!user)return json({error:"Please sign in."},401,headers);
    await env.DB.prepare("DELETE FROM notifications WHERE user_uid=? AND id NOT IN (SELECT id FROM notifications WHERE user_uid=? ORDER BY created_at DESC,id DESC LIMIT 5)").bind(user.uid,user.uid).run();
    const rows=await env.DB.prepare("SELECT id,type,title,message,link,read_at,created_at FROM notifications WHERE user_uid=? ORDER BY created_at DESC,id DESC LIMIT 5").bind(user.uid).all();
    return json({notifications:rows.results||[],unread:(rows.results||[]).filter(x=>!x.read_at).length},200,headers);
   }
   if(url.pathname.startsWith("/api/notifications/")&&request.method==="PATCH"){
    const user=await currentUser(request,env);if(!user)return json({error:"Please sign in."},401,headers);
    const id=url.pathname.split("/").pop();const result=await env.DB.prepare("UPDATE notifications SET read_at=? WHERE id=? AND user_uid=?").bind(new Date().toISOString(),id,user.uid).run();
    return json({success:true,updated:result.meta?.changes||0},200,headers);
   }
   if(url.pathname==="/api/leads"&&request.method==="GET"){
    const user=await currentUser(request,env);if(!user)return json({error:"Please sign in."},401,headers);
    const admin=await isAdmin(user);const sql="SELECT l.*,p.title AS property_title,p.city,p.country,p.price,p.currency,p.seller_name FROM leads l LEFT JOIN properties p ON p.id=l.property_id "+(admin?"":"WHERE l.seller_uid=? OR l.buyer_uid=? ")+"ORDER BY l.created_at DESC LIMIT 100";
    const rows=admin?await env.DB.prepare(sql).all():await env.DB.prepare(sql).bind(user.uid,user.uid).all();return json({leads:(rows.results||[]).map(x=>({...x,can_update:admin||x.seller_uid===user.uid}))},200,headers);
   }
   if(url.pathname==="/api/leads"&&request.method==="POST"){
    const user=await currentUser(request,env);if(!user)return json({error:"Please sign in to send an enquiry."},401,headers);
    const b=await request.json(),propertyId=clean(b.property_id,80),name=clean(b.buyer_name,100)||clean(user.email.split("@")[0],80),phone=clean(b.buyer_phone,40),message=clean(b.message,1200);
    if(!propertyId||!message)return json({error:"Choose a property and include a short enquiry message."},400,headers);
    const property=await env.DB.prepare("SELECT id,seller_uid,seller_name,title FROM properties WHERE id=? AND status='published'").bind(propertyId).first();
    if(!property)return json({error:"This listing is no longer available on AgentCoPilot."},404,headers);
    if(property.seller_uid===user.uid)return json({error:"You cannot enquire about your own listing."},400,headers);
    const id=crypto.randomUUID(),now=new Date().toISOString();
    await env.DB.prepare("INSERT INTO leads (id,property_id,seller_uid,buyer_uid,buyer_name,buyer_email,buyer_phone,message,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?, 'new',?,?)").bind(id,property.id,property.seller_uid,user.uid,name,user.email,phone,message,now,now).run();
    await notify(env,property.seller_uid,"new_lead","New property enquiry",name+" is interested in "+property.title,"./leads.html");
    await notify(env,user.uid,"enquiry_sent","Enquiry sent","Your enquiry for "+property.title+" was sent to the seller.","./leads.html");
    return json({success:true,lead_id:id,message:"Your enquiry has been sent to the seller."},201,headers);
   }
   if(url.pathname.startsWith("/api/leads/")&&request.method==="PATCH"){
    const user=await currentUser(request,env);if(!user)return json({error:"Please sign in."},401,headers);
    const id=url.pathname.split("/").pop(),b=await request.json(),status=clean(b.status,20).toLowerCase();if(!["new","contacted","viewing","closed","lost"].includes(status))return json({error:"Invalid lead stage."},400,headers);
    const lead=await env.DB.prepare("SELECT * FROM leads WHERE id=?").bind(id).first();if(!lead)return json({error:"Enquiry not found."},404,headers);
    const admin=await isAdmin(user);if(lead.seller_uid!==user.uid&&!admin)return json({error:"Only the listing seller or an administrator can update this enquiry."},403,headers);
    await env.DB.prepare("UPDATE leads SET status=?,updated_at=? WHERE id=?").bind(status,new Date().toISOString(),id).run();
    await notify(env,lead.buyer_uid,"lead_update","Enquiry updated","The seller changed your enquiry status to "+status+".","./leads.html");return json({success:true,status},200,headers);
   }
   if(url.pathname==="/api/admin/overview"&&request.method==="GET"){
    const user=await currentUser(request,env);if(!user)return json({error:"Please sign in."},401,headers);if(!await isAdmin(user))return json({error:"Administrator access required."},403,headers);
    const [properties,sellers,leadCount,counts]=await Promise.all([
     env.DB.prepare("SELECT id,title,seller_name,seller_email,city,country,price,currency,purpose,status,created_at FROM properties ORDER BY created_at DESC LIMIT 100").all(),
     env.DB.prepare("SELECT seller_uid,seller_name,MAX(seller_email) AS seller_email,COUNT(*) AS listing_count FROM properties GROUP BY seller_uid ORDER BY MAX(created_at) DESC LIMIT 100").all(),
     env.DB.prepare("SELECT COUNT(*) AS total FROM leads").first(),
     env.DB.prepare("SELECT status,COUNT(*) AS total FROM properties GROUP BY status").all()
    ]);
    return json({properties:properties.results||[],sellers:sellers.results||[],lead_count:leadCount?.total||0,property_counts:counts.results||[]},200,headers);
   }
   if(url.pathname.startsWith("/api/admin/properties/")&&request.method==="PATCH"){
    const user=await currentUser(request,env);if(!user)return json({error:"Please sign in."},401,headers);if(!await isAdmin(user))return json({error:"Administrator access required."},403,headers);
    const id=url.pathname.split("/").pop(),b=await request.json(),status=clean(b.status,20).toLowerCase();if(!["published","paused","removed"].includes(status))return json({error:"Invalid listing status."},400,headers);
    const property=await env.DB.prepare("SELECT seller_uid,title FROM properties WHERE id=?").bind(id).first();if(!property)return json({error:"Listing not found."},404,headers);
    await env.DB.prepare("UPDATE properties SET status=?,updated_at=? WHERE id=?").bind(status,new Date().toISOString(),id).run();
    await notify(env,property.seller_uid,"listing_status","Listing status changed",property.title+" is now "+status+".","./ai-tools.html#seller-panel");return json({success:true,status},200,headers);
   }

  if(url.pathname.startsWith("/api/support")&&(request.method==="GET"||request.method==="POST"||request.method==="PATCH")){
    const user=await currentUser(request,env);if(!user)return json({error:"Please sign in to contact support."},401,headers);
    const admin=await isAdmin(user);const now=new Date().toISOString();
    await env.DB.prepare("CREATE TABLE IF NOT EXISTS support_threads (id TEXT PRIMARY KEY,user_uid TEXT NOT NULL,user_email TEXT NOT NULL,user_name TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'open',created_at TEXT NOT NULL,updated_at TEXT NOT NULL,last_message TEXT NOT NULL DEFAULT '')").run();
    await env.DB.prepare("CREATE TABLE IF NOT EXISTS support_messages (id TEXT PRIMARY KEY,thread_id TEXT NOT NULL,sender_uid TEXT NOT NULL,sender_role TEXT NOT NULL,message TEXT NOT NULL,created_at TEXT NOT NULL)").run();
    if(url.pathname==="/api/support"&&request.method==="GET"){
      if(admin){const rows=await env.DB.prepare("SELECT t.*, (SELECT COUNT(*) FROM support_messages m WHERE m.thread_id=t.id AND m.sender_role='user') AS user_message_count FROM support_threads t ORDER BY CASE t.status WHEN 'open' THEN 0 ELSE 1 END,t.updated_at DESC LIMIT 150").all();return json({threads:rows.results||[]},200,headers);}
      const thread=await env.DB.prepare("SELECT id,status,created_at,updated_at,last_message FROM support_threads WHERE user_uid=?").bind(user.uid).first();return json({thread:thread||null},200,headers);
    }
    if(url.pathname==="/api/support"&&request.method==="POST"){
      const b=await request.json(),message=clean(b.message,3000).trim();if(!message)return json({error:"Enter a message before sending."},400,headers);
      let threadId=clean(b.thread_id,80);let thread;
      if(admin){if(!threadId)return json({error:"Select a support conversation."},400,headers);thread=await env.DB.prepare("SELECT id,user_uid,status FROM support_threads WHERE id=?").bind(threadId).first();if(!thread)return json({error:"Conversation not found."},404,headers);}
      else{thread=await env.DB.prepare("SELECT id,user_uid,status FROM support_threads WHERE user_uid=?").bind(user.uid).first();if(!thread){threadId=crypto.randomUUID();const name=clean(user.email.split('@')[0],100)||'AgentCoPilot user';await env.DB.prepare("INSERT INTO support_threads (id,user_uid,user_email,user_name,status,created_at,updated_at,last_message) VALUES (?,?,?,?,'open',?,?,?)").bind(threadId,user.uid,user.email,name,now,now,message.slice(0,180)).run();thread={id:threadId,user_uid:user.uid,status:'open'};}else threadId=thread.id;if(thread.status==='resolved')await env.DB.prepare("UPDATE support_threads SET status='open' WHERE id=?").bind(threadId).run();}
      const mid=crypto.randomUUID();await env.DB.prepare("INSERT INTO support_messages (id,thread_id,sender_uid,sender_role,message,created_at) VALUES (?,?,?,?,?,?)").bind(mid,threadId,user.uid,admin?'admin':'user',message,now).run();await env.DB.prepare("UPDATE support_threads SET updated_at=?,last_message=?,status=? WHERE id=?").bind(now,message.slice(0,180),admin?'open':'open',threadId).run();
      if(admin)await notify(env,thread.user_uid,'support_reply','Support replied','The AgentCoPilot support team replied to your message.','./support.html');
      return json({success:true,thread_id:threadId,message_id:mid},201,headers);
    }
    const id=decodeURIComponent(url.pathname.split('/').pop()||'');if(!id||id==='support')return json({error:'Conversation ID required.'},400,headers);
    const thread=await env.DB.prepare("SELECT * FROM support_threads WHERE id=?").bind(id).first();if(!thread)return json({error:'Conversation not found.'},404,headers);if(!admin&&thread.user_uid!==user.uid)return json({error:'You cannot access this conversation.'},403,headers);
    if(request.method==='GET'){const rows=await env.DB.prepare("SELECT id,sender_role,message,created_at FROM support_messages WHERE thread_id=? ORDER BY created_at ASC LIMIT 500").bind(id).all();return json({thread:{id:thread.id,status:thread.status,user_name:thread.user_name,user_email:admin?thread.user_email:null},messages:rows.results||[]},200,headers);}
    if(request.method==='PATCH'){if(!admin)return json({error:'Administrator access required.'},403,headers);const b=await request.json(),status=clean(b.status,20);if(!['open','resolved'].includes(status))return json({error:'Invalid conversation status.'},400,headers);await env.DB.prepare("UPDATE support_threads SET status=?,updated_at=? WHERE id=?").bind(status,now,id).run();return json({success:true,status},200,headers);}
  }
  if(url.pathname==="/api/generate"&&request.method==="POST"){const user=await currentUser(request,env);if(!user)return json({error:"Please sign in to use listing generation."},401,headers);const b=await request.json(),prompt=clean(b.prompt,12000);if(!prompt)return json({error:"Please provide property information."},400,headers);return json({result:await listingCopy(env,prompt)},200,headers);}
  return json({error:"Not found."},404,headers);
 }catch(e){console.error("AgentCoPilot API error",e);return json({error:e.message||"The request could not be completed."},500,headers);}
}};
