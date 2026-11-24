import {initializeApp,getApp,getApps} from "https://www.gstatic.com/firebasejs/13.2.0/firebase-app.js";
import {getAuth,onAuthStateChanged} from "https://www.gstatic.com/firebasejs/13.2.0/firebase-auth.js";
const config={apiKey:"AIzaSyDDWexZIGRtfkw5unI1jsGzcBS8Ind-dP8",authDomain:"agentcopilot-98817.firebaseapp.com",projectId:"agentcopilot-98817",storageBucket:"agentcopilot-98817.firebasestorage.app",messagingSenderId:"1061657518684",appId:"1:106165751868:web:5db7baa214b1d2da08fc99"};
const app=getApps().length?getApp():initializeApp(config),auth=getAuth(app),API="https://agentcopilot-html.miaj66355.workers.dev";
const $=id=>document.getElementById(id);
function notice(id,msg){const e=$(id);e.textContent=msg;e.style.display="block";}
function hide(id){$(id).style.display="none";}
function esc(v){return String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
function naira(v){return new Intl.NumberFormat("en-NG",{style:"currency",currency:"NGN",maximumFractionDigits:0}).format(Number(v)||0);}
async function getToken(){if(!auth.currentUser)throw new Error("Please sign in to continue.");return auth.currentUser.getIdToken();}
$("buyer-tab").onclick=()=>{$("buyer-tab").classList.add("active");$("seller-tab").classList.remove("active");$("buyer-panel").hidden=false;$("seller-panel").hidden=true;};
$("seller-tab").onclick=()=>{$("seller-tab").classList.add("active");$("buyer-tab").classList.remove("active");$("seller-panel").hidden=false;$("buyer-panel").hidden=true;};
onAuthStateChanged(auth,u=>{if(u)$("seller-name").value=u.displayName||"";});
function render(rows){
 const host=$("property-results");$("result-count").textContent=rows.length+" found";
 if(!rows.length){host.innerHTML='<div class="empty">No published properties match yet. Try a wider location or budget, or check again as sellers add listings.</div>';return;}
 host.innerHTML=rows.map(p=>{
  const photo=p.cover_image||"",phone=String(p.seller_phone||"").replace(/[^\d+]/g,""),wa=phone.replace(/\D/g,""),features=JSON.parse(p.features||"[]"),reasons=p.match_reasons||[];
  let chips='<span class="chip">'+esc(p.purpose==="sale"?"For sale":"For rent")+'</span><span class="chip">'+esc(p.property_type)+'</span>';
  if(p.bedrooms)chips+='<span class="chip">'+p.bedrooms+' beds</span>';if(p.bathrooms)chips+='<span class="chip">'+p.bathrooms+' baths</span>';
  return '<article class="property-card">'+(photo?'<img src="'+photo+'" alt="Property photograph" loading="lazy">':'<div class="empty">No photo supplied</div>')+'<div class="property-body"><div class="price">'+naira(p.price)+'</div><h3>'+esc(p.title)+'</h3><div class="muted">'+esc(p.location)+'</div><div class="chips">'+chips+'</div><p>'+esc(p.description).slice(0,250)+'</p>'+(features.length?'<div class="chips">'+features.slice(0,5).map(x=>'<span class="chip">'+esc(x)+'</span>').join("")+'</div>':'')+(reasons.length?'<p class="muted">AI match: '+esc(reasons.join(" · "))+'</p>':'')+'<p class="muted">Listed by '+esc(p.seller_name)+'</p><div class="contact"><a href="tel:'+esc(phone)+'">Call seller</a><a href="https://wa.me/'+esc(wa)+'" target="_blank" rel="noopener">WhatsApp</a></div></div></article>';
 }).join("");
}
$("search-form").addEventListener("submit",async e=>{
 e.preventDefault();hide("search-notice");const btn=$("search-btn");btn.disabled=true;btn.textContent="AI agents are searching…";
 try{
  const parts=[$("buyer-query").value.trim(),$("buyer-purpose").value?"Purpose: "+$("buyer-purpose").value:"",$("buyer-city").value?"Location: "+$("buyer-city").value:"",$("buyer-type").value?"Property type: "+$("buyer-type").value:"",$("buyer-bedrooms").value?"At least "+$("buyer-bedrooms").value+" bedrooms":"",$("buyer-budget").value?"Maximum budget ₦"+$("buyer-budget").value:"",$("buyer-state").value?"State: "+$("buyer-state").value:""].filter(Boolean);
  const r=await fetch(API+"/api/ai-search",{method:"POST",headers:{"Content-Type":"application/json","Authorization":"Bearer "+await getToken()},body:JSON.stringify({query:parts.join(". ")})}),d=await r.json();if(!r.ok)throw new Error(d.error||"Search failed.");
  render(d.properties||[]);notice("search-notice","AI understood your request: "+JSON.stringify(d.criteria)+". Matches are ranked against the sellers' submitted property details.");
 }catch(err){notice("search-notice",err.message||"Unable to search.");}finally{btn.disabled=false;btn.textContent="Ask AI to find properties";}
});
async function photoData(file){
 const bmp=await createImageBitmap(file),scale=Math.min(1,1200/bmp.width),canvas=document.createElement("canvas");canvas.width=Math.round(bmp.width*scale);canvas.height=Math.round(bmp.height*scale);canvas.getContext("2d").drawImage(bmp,0,0,canvas.width,canvas.height);bmp.close();
 let q=.72,blob=await new Promise(res=>canvas.toBlob(res,"image/jpeg",q));while(blob&&blob.size>300*1024&&q>.4){q-=.08;blob=await new Promise(res=>canvas.toBlob(res,"image/jpeg",q));}
 if(!blob||blob.size>320*1024)throw new Error("A photo is too large after compression. Choose a smaller photo.");
 return await new Promise((res,rej)=>{const reader=new FileReader();reader.onload=()=>res(reader.result);reader.onerror=rej;reader.readAsDataURL(blob);});
}
$("property-photos").addEventListener("change",()=>{const files=[...$("property-photos").files].slice(0,5);$("photo-preview").innerHTML=files.map(f=>'<span class="muted">'+esc(f.name)+'</span>').join("");if($("property-photos").files.length>5)notice("seller-notice","Only the first five photos will be used.");});
$("seller-form").addEventListener("submit",async e=>{
 e.preventDefault();hide("seller-notice");const btn=$("publish-btn");btn.disabled=true;btn.textContent="Preparing listing…";
 try{
  const files=[...$("property-photos").files].slice(0,5);if(!files.length)throw new Error("Upload at least one property photograph.");
  const photos=await Promise.all(files.map(photoData)),features=$("property-features").value.split(",").map(x=>x.trim()).filter(Boolean);
  const body={seller_name:$("seller-name").value.trim(),seller_phone:$("seller-phone").value.trim(),purpose:$("purpose").value,property_type:$("property-type").value,title:$("property-title").value.trim(),description:$("property-description").value.trim(),location:$("property-location").value.trim(),city:$("property-city").value.trim(),state:$("property-state").value.trim(),price:$("property-price").value,bedrooms:$("property-bedrooms").value,bathrooms:$("property-bathrooms").value,size_sqm:$("property-size").value,condition:$("property-condition").value.trim(),features,photos,authority_confirmed:$("authority-confirmed").checked,contact_consent:$("contact-consent").checked};
  const r=await fetch(API+"/api/properties",{method:"POST",headers:{"Content-Type":"application/json","Authorization":"Bearer "+await getToken()},body:JSON.stringify(body)}),d=await r.json();if(!r.ok)throw new Error(d.error||"Could not publish property.");
  notice("seller-notice","Your property has been published. Buyers can now find it in AgentCoPilot search.");$("seller-form").reset();$("photo-preview").innerHTML="";
 }catch(err){notice("seller-notice",err.message||"Unable to publish property.");}finally{btn.disabled=false;btn.textContent="Publish property";}
});
