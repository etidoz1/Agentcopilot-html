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
function cors(origin,allowed){return origin&&allowed.includes(origin)?{"Access-Control-Allow-Origin":origin,"Access-Control-Allow-Methods":"GET, POST, PUT, PATCH, OPTIONS","Access-Control-Allow-Headers":"Content-Type, Authorization","Access-Control-Max-Age":"86400","Vary":"Origin"}:{};}
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
async function paymentTables(env){
 await env.DB.prepare("CREATE TABLE IF NOT EXISTS payment_settings (id INTEGER PRIMARY KEY CHECK(id=1), provider TEXT NOT NULL, mode TEXT NOT NULL, public_key TEXT NOT NULL, secret_cipher TEXT NOT NULL, webhook_cipher TEXT NOT NULL, updated_by TEXT NOT NULL, updated_at TEXT NOT NULL)").run();
 await env.DB.prepare("CREATE TABLE IF NOT EXISTS payment_pricing (id INTEGER PRIMARY KEY CHECK(id=1), currency TEXT NOT NULL, viewing_fee_mode TEXT NOT NULL, viewing_fee_amount REAL NOT NULL DEFAULT 0, deposit_mode TEXT NOT NULL, deposit_amount REAL NOT NULL DEFAULT 0, updated_by TEXT NOT NULL, updated_at TEXT NOT NULL)").run();
 await env.DB.prepare("CREATE TABLE IF NOT EXISTS bookings (id TEXT PRIMARY KEY, property_id TEXT NOT NULL, buyer_uid TEXT NOT NULL, seller_uid TEXT NOT NULL, booking_type TEXT NOT NULL, requested_for TEXT, payment_reference TEXT, status TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)").run();
 await env.DB.prepare("CREATE TABLE IF NOT EXISTS payment_transactions (id TEXT PRIMARY KEY, reference TEXT NOT NULL UNIQUE, provider TEXT NOT NULL, mode TEXT NOT NULL, payment_type TEXT NOT NULL, booking_id TEXT NOT NULL, property_id TEXT NOT NULL, buyer_uid TEXT NOT NULL, seller_uid TEXT NOT NULL, amount REAL NOT NULL, amount_minor INTEGER NOT NULL, currency TEXT NOT NULL, secret_cipher TEXT NOT NULL, webhook_cipher TEXT NOT NULL, provider_transaction_id TEXT, status TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, verified_at TEXT)").run();
}
async function paymentPricingTable(env){
 await env.DB.prepare("CREATE TABLE IF NOT EXISTS payment_pricing (id INTEGER PRIMARY KEY CHECK(id=1), currency TEXT NOT NULL, viewing_fee_mode TEXT NOT NULL, viewing_fee_amount REAL NOT NULL DEFAULT 0, deposit_mode TEXT NOT NULL, deposit_amount REAL NOT NULL DEFAULT 0, updated_by TEXT NOT NULL, updated_at TEXT NOT NULL)").run();
}
function paymentCryptoKey(env){
 const raw=String(env.PAYMENT_ENCRYPTION_KEY||"");if(!raw)throw new Error("Payment encryption is not configured on this deployment.");
 let bytes;try{const clean=raw.replace(/-/g,"+").replace(/_/g,"/");const bin=atob(clean+"=".repeat((4-clean.length%4)%4));bytes=Uint8Array.from(bin,c=>c.charCodeAt(0));}catch{throw new Error("Payment encryption key is invalid. Configure a base64-encoded 32-byte key.");}
 if(bytes.length!==32)throw new Error("Payment encryption key must decode to exactly 32 bytes.");return crypto.subtle.importKey("raw",bytes,{name:"AES-GCM"},false,["encrypt","decrypt"]);
}
async function encryptPaymentSecret(value,env){const iv=crypto.getRandomValues(new Uint8Array(12)),key=await paymentCryptoKey(env),cipher=await crypto.subtle.encrypt({name:"AES-GCM",iv},key,new TextEncoder().encode(value));return btoa(String.fromCharCode(...iv,...new Uint8Array(cipher)));}
async function decryptPaymentSecret(value,env){const raw=Uint8Array.from(atob(value),c=>c.charCodeAt(0)),iv=raw.slice(0,12),cipher=raw.slice(12),key=await paymentCryptoKey(env),plain=await crypto.subtle.decrypt({name:"AES-GCM",iv},key,cipher);return new TextDecoder().decode(plain);}
function currencyDigits(currency){return ["JPY","KRW","XAF","XOF","UGX","RWF","BIF","GNF","KMF","VND"].includes(currency)?0:["BHD","KWD","OMR","JOD","TND"].includes(currency)?3:2;}
function amountMinor(amount,currency){return Math.round(Number(amount)*Math.pow(10,currencyDigits(currency)));}
function safeEqual(a,b){if(typeof a!=="string"||typeof b!=="string"||a.length!==b.length)return false;let diff=0;for(let i=0;i<a.length;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i);return diff===0;}
async function hmacHex(secret,message,hash="SHA-512"){const key=await crypto.subtle.importKey("raw",new TextEncoder().encode(secret),{name:"HMAC",hash},false,["sign"]);const sig=await crypto.subtle.sign("HMAC",key,new TextEncoder().encode(message));return [...new Uint8Array(sig)].map(x=>x.toString(16).padStart(2,"0")).join("");}
async function hmacBase64(secret,message){const key=await crypto.subtle.importKey("raw",new TextEncoder().encode(secret),{name:"HMAC",hash:"SHA-256"},false,["sign"]);const sig=await crypto.subtle.sign("HMAC",key,new TextEncoder().encode(message));return btoa(String.fromCharCode(...new Uint8Array(sig)));}
async function markPaymentSuccessful(env,tx,providerTransactionId){
 const now=new Date().toISOString();const changed=await env.DB.prepare("UPDATE payment_transactions SET status='success',provider_transaction_id=COALESCE(?,provider_transaction_id),updated_at=?,verified_at=? WHERE reference=? AND status!='success'").bind(providerTransactionId||null,now,now,tx.reference).run();
 if(!(changed.meta?.changes>0))return false;
 await env.DB.prepare("UPDATE bookings SET status='paid',updated_at=? WHERE id=? AND status='awaiting_payment'").bind(now,tx.booking_id).run();
 const p=await env.DB.prepare("SELECT title FROM properties WHERE id=?").bind(tx.property_id).first();const title=p?.title||"your property booking";
 try{await notify(env,tx.buyer_uid,"payment_success","Payment confirmed","Your payment for "+title+" was confirmed.","./leads.html");}catch(e){console.error("Buyer payment notification failed",e);}
 try{await notify(env,tx.seller_uid,"booking_payment","Customer payment received","A customer payment was confirmed for "+title+". Contact the customer to coordinate next steps.","./leads.html");}catch(e){console.error("Seller payment notification failed",e);}
 return true;
}
async function verifyPaymentRecord(env,tx,providerTransactionId){
 const secret=await decryptPaymentSecret(tx.secret_cipher,env);let data=null;
 if(tx.provider==="paystack"){
  const response=await fetch("https://api.paystack.co/transaction/verify/"+encodeURIComponent(tx.reference),{headers:{Authorization:"Bearer "+secret}});const payload=await response.json().catch(()=>({}));if(!response.ok||payload.status!==true)throw new Error("Paystack could not verify this transaction.");data=payload.data;
  if(data?.status!=="success"||data.reference!==tx.reference||Number(data.amount)!==Number(tx.amount_minor)||String(data.currency).toUpperCase()!==tx.currency||String(data.domain).toLowerCase()!==(tx.mode==="test"?"test":"live"))throw new Error("Paystack verification did not match the expected amount, currency, reference, environment, or status.");
 }else{
  if(!providerTransactionId)throw new Error("Flutterwave transaction ID is required for verification.");
  const response=await fetch("https://api.flutterwave.com/v3/transactions/"+encodeURIComponent(providerTransactionId)+"/verify",{headers:{Authorization:"Bearer "+secret}});const payload=await response.json().catch(()=>({}));if(!response.ok||payload.status!=="success")throw new Error("Flutterwave could not verify this transaction.");data=payload.data;
  if(data?.status!=="successful"||data.tx_ref!==tx.reference||amountMinor(data.amount,tx.currency)!==Number(tx.amount_minor)||String(data.currency).toUpperCase()!==tx.currency)throw new Error("Flutterwave verification did not match the expected amount, currency, reference, or status.");
 }
 await markPaymentSuccessful(env,tx,String(data.id||providerTransactionId||""));return {success:true,status:"success",reference:tx.reference,amount:tx.amount,currency:tx.currency};
}
async function createPaymentCheckout(env,user,b,headers){
 await paymentTables(env);const propertyId=clean(b.property_id,80),paymentType=clean(b.payment_type,30).toLowerCase();if(!propertyId||!["viewing_fee","booking_deposit"].includes(paymentType))return json({error:"Choose a valid property and payment type."},400,headers);
 const property=await env.DB.prepare("SELECT id,seller_uid,title,price,currency,status FROM properties WHERE id=? AND status='published'").bind(propertyId).first();if(!property)return json({error:"This AgentCoPilot listing is no longer available."},404,headers);if(property.seller_uid===user.uid)return json({error:"You cannot pay to view or reserve your own listing."},400,headers);
 const pricing=await env.DB.prepare("SELECT * FROM payment_pricing WHERE id=1").first();if(!pricing)return json({error:"The owner has not configured viewing fees and booking deposits."},409,headers);if(String(property.currency).toUpperCase()!==pricing.currency)return json({error:"This listing uses "+property.currency+" but the owner accepts "+pricing.currency+". Payments are not available for this listing until its currency matches; no automatic conversion is applied."},409,headers);
 let amount=0;if(paymentType==="viewing_fee"){if(pricing.viewing_fee_mode==="fixed")amount=Number(pricing.viewing_fee_amount);else amount=0;}else{if(pricing.deposit_mode==="fixed")amount=Number(pricing.deposit_amount);else if(pricing.deposit_mode==="percentage")amount=Number(property.price)*Number(pricing.deposit_amount)/100;else amount=0;}
 const digits=currencyDigits(pricing.currency),factor=Math.pow(10,digits);amount=Math.round(amount*factor)/factor;const bookingId=crypto.randomUUID(),now=new Date().toISOString(),requestedFor=clean(b.requested_for,100);
 if(amount<=0){await env.DB.prepare("INSERT INTO bookings (id,property_id,buyer_uid,seller_uid,booking_type,requested_for,payment_reference,status,created_at,updated_at) VALUES (?,?,?,?,?,?,NULL,'requested',?,?)").bind(bookingId,property.id,user.uid,property.seller_uid,paymentType,requestedFor,now,now).run();try{await notify(env,property.seller_uid,"viewing_request","New property request","A customer requested "+(paymentType==="viewing_fee"?"a viewing":"a booking")+" for "+property.title,"./leads.html");}catch(e){}return json({success:true,free:true,booking_id:bookingId,message:"Your request was sent. The seller will contact you to confirm the details."},201,headers);}
 const settings=await env.DB.prepare("SELECT provider,mode,public_key,secret_cipher,webhook_cipher FROM payment_settings WHERE id=1").first();if(!settings)return json({error:"The owner has not connected a payment provider."},409,headers);if(!env.PAYMENT_ENCRYPTION_KEY)return json({error:"Secure payment credential storage is not configured."},503,headers);
 const reference="ACP-"+crypto.randomUUID().replace(/-/g,"").toUpperCase(),minor=amountMinor(amount,pricing.currency);if(!Number.isSafeInteger(minor)||minor<=0)return json({error:"The calculated payment amount is invalid."},400,headers);
 await env.DB.prepare("INSERT INTO bookings (id,property_id,buyer_uid,seller_uid,booking_type,requested_for,payment_reference,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,'awaiting_payment',?,?)").bind(bookingId,property.id,user.uid,property.seller_uid,paymentType,requestedFor,reference,now,now).run();
 await env.DB.prepare("INSERT INTO payment_transactions (id,reference,provider,mode,payment_type,booking_id,property_id,buyer_uid,seller_uid,amount,amount_minor,currency,secret_cipher,webhook_cipher,provider_transaction_id,status,created_at,updated_at,verified_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,NULL,'pending',?,?,NULL)").bind(crypto.randomUUID(),reference,settings.provider,settings.mode,paymentType,bookingId,property.id,user.uid,property.seller_uid,amount,minor,pricing.currency,settings.secret_cipher,settings.webhook_cipher,now,now).run();
 const returnUrl=env.PAYMENT_RETURN_URL||"https://etidoz1.github.io/Agentcopilot-html/payment-result.html";let checkoutUrl="";
 try{
 const secret=await decryptPaymentSecret(settings.secret_cipher,env);
 if(settings.provider==="paystack"){
  const response=await fetch("https://api.paystack.co/transaction/initialize",{method:"POST",headers:{Authorization:"Bearer "+secret,"Content-Type":"application/json"},body:JSON.stringify({email:user.email,amount:String(minor),currency:pricing.currency,reference,callback_url:returnUrl,metadata:{booking_id:bookingId,property_id:property.id,payment_type:paymentType}})});const payload=await response.json().catch(()=>({}));if(!response.ok||payload.status!==true||!payload.data?.authorization_url)throw new Error("Paystack could not create a checkout session.");checkoutUrl=payload.data.authorization_url;
 }else{
  const response=await fetch("https://api.flutterwave.com/v3/payments",{method:"POST",headers:{Authorization:"Bearer "+secret,"Content-Type":"application/json"},body:JSON.stringify({tx_ref:reference,amount,currency:pricing.currency,redirect_url:returnUrl,customer:{email:user.email},meta:{booking_id:bookingId,property_id:property.id,payment_type:paymentType},customizations:{title:"AgentCoPilot property payment",description:paymentType==="viewing_fee"?"Property viewing fee":"Property booking deposit"}})});const payload=await response.json().catch(()=>({}));if(!response.ok||payload.status!=="success"||!payload.data?.link)throw new Error("Flutterwave could not create a checkout session.");checkoutUrl=payload.data.link;
 }
 }catch(error){const failedAt=new Date().toISOString();await env.DB.prepare("UPDATE payment_transactions SET status='checkout_failed',updated_at=? WHERE reference=? AND status='pending'").bind(failedAt,reference).run();await env.DB.prepare("UPDATE bookings SET status='checkout_failed',updated_at=? WHERE id=? AND status='awaiting_payment'").bind(failedAt,bookingId).run();throw error;}
 return json({success:true,checkout_url:checkoutUrl,reference,amount,currency:pricing.currency,payment_type:paymentType},200,headers);
}


async function notify(env,userUid,type,title,message,link=""){await env.DB.prepare("INSERT INTO notifications (id,user_uid,type,title,message,link,created_at) VALUES (?,?,?,?,?,?,?)").bind(crypto.randomUUID(),userUid,type,title,message,link,new Date().toISOString()).run();await env.DB.prepare("DELETE FROM notifications WHERE user_uid=? AND id NOT IN (SELECT id FROM notifications WHERE user_uid=? ORDER BY created_at DESC,id DESC LIMIT 5)").bind(userUid,userUid).run();}

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
 return out;
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
  return {title:clean(x.title,220),url:x.url,snippet,source,image_urls:[],image_url:null,image_attribution:null,score:Number(x.score)||0,listing_status:"External residential result — verify availability and details with the original advertiser"};
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
 const model=env.GEMINI_MODEL||DEFAULT_MODEL;
 const r=await fetch("https://generativelanguage.googleapis.com/v1beta/models/"+encodeURIComponent(model)+":generateContent",{method:"POST",headers:{"Content-Type":"application/json","x-goog-api-key":env.GEMINI_API_KEY},body:JSON.stringify({systemInstruction:{parts:[{text:instruction}]},contents:[{role:"user",parts:[{text:prompt}]}],generationConfig:{temperature:.25,topP:.8,maxOutputTokens:700}})});
 const p=await r.json();if(!r.ok)throw new Error(r.status===429?"The AI service is temporarily busy. Please try again shortly.":"The AI service could not complete this request.");const out=(p.candidates?.[0]?.content?.parts||[]).map(x=>x.text||"").join("").trim();if(!out)throw new Error("The AI returned an empty response.");return out;
}
export default {async fetch(request,env){
 const origin=request.headers.get("Origin")||"";const allowed=(env.ALLOWED_ORIGIN||"https://etidoz1.github.io").split(",").map(x=>x.trim()).filter(Boolean);const headers=cors(origin,allowed);if(request.method==="OPTIONS")return origin&&!allowed.includes(origin)?json({error:"Origin not allowed."},403):new Response(null,{status:204,headers});
 const url=new URL(request.url);if(url.pathname==="/health"&&request.method==="GET")return json({status:"ok",service:"AgentCoPilot property marketplace",database:!!env.DB,ai:!!env.GEMINI_API_KEY,global_search:!!env.TAVILY_API_KEY},200,headers);
 if(origin&&!allowed.includes(origin))return json({error:"Origin not allowed."},403,headers);
 try{
  if(url.pathname==="/api/payments/checkout"&&request.method==="POST"){
   const user=await currentUser(request,env);if(!user)return json({error:"Please sign in before making a payment."},401,headers);if(!user.email)return json({error:"Your account needs a valid email address for payment checkout."},400,headers);const b=await request.json();return await createPaymentCheckout(env,user,b,headers);
  }
  if(url.pathname==="/api/payments/verify"&&request.method==="GET"){
   const user=await currentUser(request,env);if(!user)return json({error:"Please sign in to verify your payment."},401,headers);const reference=clean(url.searchParams.get("reference"),100),providerTransactionId=clean(url.searchParams.get("transaction_id"),100);if(!reference)return json({error:"Payment reference is required."},400,headers);await paymentTables(env);const tx=await env.DB.prepare("SELECT * FROM payment_transactions WHERE reference=? AND buyer_uid=?").bind(reference,user.uid).first();if(!tx)return json({error:"Payment record not found for this account."},404,headers);if(tx.status==="success")return json({success:true,status:"success",reference:tx.reference,amount:tx.amount,currency:tx.currency},200,headers);try{return json(await verifyPaymentRecord(env,tx,providerTransactionId),200,headers);}catch(e){return json({success:false,status:tx.status,error:e.message},409,headers);}
  }
  if(url.pathname==="/api/webhooks/paystack"&&request.method==="POST"){
   await paymentTables(env);const raw=await request.text();let event;try{event=JSON.parse(raw);}catch{return json({error:"Invalid webhook payload."},400,headers);}const reference=clean(event?.data?.reference,100);if(!reference)return json({received:true},200,headers);const tx=await env.DB.prepare("SELECT * FROM payment_transactions WHERE reference=? AND provider='paystack'").bind(reference).first();if(!tx)return json({received:true},200,headers);const webhookSecret=await decryptPaymentSecret(tx.webhook_cipher,env),secret=await decryptPaymentSecret(tx.secret_cipher,env);let valid=false;const modern=request.headers.get("Paystack-Signature")||"";if(modern){let timestamp="",signatures=[];for(const part of modern.split(",")){const [k,...rest]=part.trim().split("=");const value=rest.join("=");if(k==="t")timestamp=value;if(k==="v1")signatures.push(value.includes(":")?value.slice(value.indexOf(":")+1):value);}const t=Number(timestamp);if(Number.isFinite(t)&&Math.abs(Math.floor(Date.now()/1000)-t)<=300){const expected=await hmacHex(webhookSecret,timestamp+"."+raw);valid=signatures.some(sig=>safeEqual(sig.toLowerCase(),expected));}}if(!valid){const legacy=request.headers.get("x-paystack-signature")||"";if(legacy){const expected=await hmacHex(secret,raw);valid=safeEqual(legacy.toLowerCase(),expected);}}if(!valid)return json({error:"Invalid Paystack webhook signature."},401,headers);if(event.event==="charge.success")try{await verifyPaymentRecord(env,tx,"");}catch(e){console.error("Paystack webhook verification failed",e);}return json({received:true},200,headers);
  }
  if(url.pathname==="/api/webhooks/flutterwave"&&request.method==="POST"){
   await paymentTables(env);const raw=await request.text();let event;try{event=JSON.parse(raw);}catch{return json({error:"Invalid webhook payload."},400,headers);}const data=event?.data||{},reference=clean(data.tx_ref||data.reference,100);if(!reference)return json({received:true},200,headers);const tx=await env.DB.prepare("SELECT * FROM payment_transactions WHERE reference=? AND provider='flutterwave'").bind(reference).first();if(!tx)return json({received:true},200,headers);const webhookSecret=await decryptPaymentSecret(tx.webhook_cipher,env),signature=request.headers.get("flutterwave-signature")||"",expected=await hmacBase64(webhookSecret,raw);if(!safeEqual(signature,expected))return json({error:"Invalid Flutterwave webhook signature."},401,headers);if(data.status==="successful"||event.type==="charge.completed")try{await verifyPaymentRecord(env,tx,String(data.id||""));}catch(e){console.error("Flutterwave webhook verification failed",e);}return json({received:true},200,headers);
  }
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
   await env.DB.batch(statements);try{await notify(env,user.uid,"listing_created","Property published",title+" is now live on AgentCoPilot.","./ai-tools.html#seller-panel");}catch(e){console.error("Listing notification failed",e);}return json({success:true,property_id:id,message:"Your property has been published."},201,headers);
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

   if(url.pathname==="/api/owner/payment-pricing"&&(request.method==="GET"||request.method==="PUT")){
    const user=await currentUser(request,env);if(!user)return json({error:"Please sign in."},401,headers);if(await userRole(user)!=="owner")return json({error:"Only the application owner can manage payment pricing."},403,headers);await paymentPricingTable(env);
    if(request.method==="GET"){const row=await env.DB.prepare("SELECT currency,viewing_fee_mode,viewing_fee_amount,deposit_mode,deposit_amount,updated_at FROM payment_pricing WHERE id=1").first();return json({pricing:row||{currency:"NGN",viewing_fee_mode:"free",viewing_fee_amount:0,deposit_mode:"off",deposit_amount:0}},200,headers);}
    const b=await request.json(),currency=clean(b.currency,3).toUpperCase(),viewMode=clean(b.viewing_fee_mode,10).toLowerCase(),depositMode=clean(b.deposit_mode,12).toLowerCase(),viewAmount=Number(b.viewing_fee_amount),depositAmount=Number(b.deposit_amount);
    if(!/^[A-Z]{3}$/.test(currency)||!["free","fixed"].includes(viewMode)||!["off","fixed","percentage"].includes(depositMode)||!Number.isFinite(viewAmount)||!Number.isFinite(depositAmount)||viewAmount<0||depositAmount<0||viewAmount>1000000000||depositAmount>1000000000)return json({error:"Enter a valid currency and non-negative fee/deposit values."},400,headers);
    if(viewMode==="fixed"&&viewAmount<=0)return json({error:"A fixed viewing fee must be greater than zero."},400,headers);
    if(depositMode==="fixed"&&depositAmount<=0)return json({error:"A fixed booking deposit must be greater than zero."},400,headers);
    if(depositMode==="percentage"&&(depositAmount<=0||depositAmount>100))return json({error:"The deposit percentage must be greater than 0 and no more than 100."},400,headers);
    const now=new Date().toISOString();await env.DB.prepare("INSERT INTO payment_pricing (id,currency,viewing_fee_mode,viewing_fee_amount,deposit_mode,deposit_amount,updated_by,updated_at) VALUES (1,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET currency=excluded.currency,viewing_fee_mode=excluded.viewing_fee_mode,viewing_fee_amount=excluded.viewing_fee_amount,deposit_mode=excluded.deposit_mode,deposit_amount=excluded.deposit_amount,updated_by=excluded.updated_by,updated_at=excluded.updated_at").bind(currency,viewMode,viewMode==="fixed"?viewAmount:0,depositMode,depositMode==="off"?0:depositAmount,user.uid,now).run();
    return json({success:true,message:"Viewing fee and booking deposit rules saved.",pricing:{currency,viewing_fee_mode:viewMode,viewing_fee_amount:viewMode==="fixed"?viewAmount:0,deposit_mode:depositMode,deposit_amount:depositMode==="off"?0:depositAmount},updated_at:now},200,headers);
   }
   if(url.pathname==="/api/owner/payment-settings"&&(request.method==="GET"||request.method==="PUT")){
    const user=await currentUser(request,env);if(!user)return json({error:"Please sign in."},401,headers);if(await userRole(user)!=="owner")return json({error:"Only the application owner can manage payment settings."},403,headers);await paymentTables(env);
    if(request.method==="GET"){const row=await env.DB.prepare("SELECT provider,mode,public_key,updated_at FROM payment_settings WHERE id=1").first();return json({configured:!!row,provider:row?.provider||"",mode:row?.mode||"test",public_key:row?.public_key||"",updated_at:row?.updated_at||null,encryption_ready:!!env.PAYMENT_ENCRYPTION_KEY},200,headers);}
    const b=await request.json(),provider=clean(b.provider,20).toLowerCase(),mode=clean(b.mode,10).toLowerCase(),publicKey=typeof b.public_key==="string"?b.public_key.trim().slice(0,240):"",secretKey=typeof b.secret_key==="string"?b.secret_key.trim():"",webhookSecret=typeof b.webhook_secret==="string"?b.webhook_secret.trim():"";
    if(!["paystack","flutterwave"].includes(provider)||!["test","live"].includes(mode)||!publicKey||publicKey.length>240||secretKey.length>500||webhookSecret.length>500)return json({error:"Choose a provider and mode, and enter a valid public key. New or changed provider credentials must be supplied."},400,headers);
    const existing=await env.DB.prepare("SELECT provider,mode,public_key,secret_cipher,webhook_cipher FROM payment_settings WHERE id=1").first();
    const sameConnection=existing&&existing.provider===provider&&existing.mode===mode&&existing.public_key===publicKey;
    if((!sameConnection||!existing.secret_cipher||!existing.webhook_cipher)&&(!secretKey||!webhookSecret))return json({error:"Enter both secret values when connecting a new provider or switching test/live mode."},400,headers);
    let secretCipher=existing?.secret_cipher,webhookCipher=existing?.webhook_cipher;try{if(secretKey)secretCipher=await encryptPaymentSecret(secretKey,env);if(webhookSecret)webhookCipher=await encryptPaymentSecret(webhookSecret,env);}catch(e){return json({error:e.message},503,headers);}
    const now=new Date().toISOString();await env.DB.prepare("INSERT INTO payment_settings (id,provider,mode,public_key,secret_cipher,webhook_cipher,updated_by,updated_at) VALUES (1,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET provider=excluded.provider,mode=excluded.mode,public_key=excluded.public_key,secret_cipher=excluded.secret_cipher,webhook_cipher=excluded.webhook_cipher,updated_by=excluded.updated_by,updated_at=excluded.updated_at").bind(provider,mode,publicKey,secretCipher,webhookCipher,user.uid,now).run();
    return json({success:true,message:"Payment provider credentials saved securely.",provider,mode,updated_at:now},200,headers);
   }
  if(url.pathname==="/api/generate"&&request.method==="POST"){const b=await request.json(),prompt=clean(b.prompt,12000);if(!prompt)return json({error:"Please provide property information."},400,headers);return json({result:await listingCopy(env,prompt)},200,headers);}
  return json({error:"Not found."},404,headers);
 }catch(e){console.error("AgentCoPilot API error",e);return json({error:e.message||"The request could not be completed."},500,headers);}
}};
