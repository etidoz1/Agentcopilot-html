import {initializeApp,getApp,getApps} from "https://www.gstatic.com/firebasejs/13.2.0/firebase-app.js";
import {getAuth,onAuthStateChanged} from "https://www.gstatic.com/firebasejs/13.2.0/firebase-auth.js";
const config={apiKey:"AIzaSyDDWexZIGRtfkw5unI1jsGzcBS8Ind-dP8",authDomain:"agentcopilot-98817.firebaseapp.com",projectId:"agentcopilot-98817",storageBucket:"agentcopilot-98817.firebasestorage.app",messagingSenderId:"1061657518684",appId:"1:106165751868:web:5db7baa214b1d2da08fc99"};
const app=getApps().length?getApp():initializeApp(config),auth=getAuth(app),API="https://agentcopilot-html.miaj66355.workers.dev";
const $=id=>document.getElementById(id);
function notice(id,msg){const e=$(id);e.textContent=msg;e.style.display="block";}
function hide(id){$(id).style.display="none";}
function esc(v){return String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
function moneyFormat(v,currency="NGN"){try{return new Intl.NumberFormat(undefined,{style:"currency",currency,maximumFractionDigits:0}).format(Number(v)||0);}catch{return currency+" "+(Number(v)||0).toLocaleString();}}
async function getToken(){if(!auth.currentUser)throw new Error("Please sign in to continue.");return auth.currentUser.getIdToken();}
$("buyer-tab").onclick=()=>{$("buyer-tab").classList.add("active");$("seller-tab").classList.remove("active");$("buyer-panel").hidden=false;$("seller-panel").hidden=true;};
$("seller-tab").onclick=()=>{$("seller-tab").classList.add("active");$("buyer-tab").classList.remove("active");$("seller-panel").hidden=false;$("buyer-panel").hidden=true;};
onAuthStateChanged(auth,u=>{if(u)$("seller-name").value=u.displayName||"";});
function render(rows,external=[]){
 const host=$("property-results");$("result-count").textContent=(rows.length+external.length)+" found ("+rows.length+" AgentCoPilot, "+external.length+" external)";
 if(!rows.length&&!external.length){host.innerHTML='<div class="empty">No matching listings were found in the sources searched. Try another location, budget or search description.</div>';return;}
 const internal=rows.map(p=>{
  const photo=p.cover_image||"",phone=String(p.seller_phone||"").replace(/[^\d+]/g,""),wa=phone.replace(/\D/g,""),features=JSON.parse(p.features||"[]"),reasons=p.match_reasons||[];
  let chips='<span class="chip">'+esc(p.purpose==="sale"?"For sale":"For rent")+'</span><span class="chip">'+esc(p.property_type)+'</span>';
  if(p.bedrooms)chips+='<span class="chip">'+p.bedrooms+' beds</span>';if(p.bathrooms)chips+='<span class="chip">'+p.bathrooms+' baths</span>';
  return '<article class="property-card">'+(photo?'<img src="'+photo+'" alt="Seller-supplied property photograph" loading="lazy">':'<div class="empty">No photo supplied</div>')+'<div class="property-body"><span class="chip">AgentCoPilot listing</span><div class="price">'+moneyFormat(p.price,p.currency||"NGN")+'</div><h3>'+esc(p.title)+'</h3><div class="muted">'+esc([p.location,p.city,p.state,p.country].filter(Boolean).join(", "))+'</div><div class="chips">'+chips+'</div><p>'+esc(p.description).slice(0,250)+'</p>'+(features.length?'<div class="chips">'+features.slice(0,5).map(x=>'<span class="chip">'+esc(x)+'</span>').join("")+'</div>':'')+(reasons.length?'<p class="muted">AI match: '+esc(reasons.join(" · "))+'</p>':'')+'<p class="muted">Listed by '+esc(p.seller_name)+'</p><div class="contact"><button type="button" class="primary" data-enquiry="'+esc(p.id)+'">Send enquiry</button><a href="tel:'+esc(phone)+'">Call seller</a><a href="https://wa.me/'+esc(wa)+'" target="_blank" rel="noopener">WhatsApp</a></div></div></article>';
 }).join("");
 const outside=external.map(p=>{
  const photos=Array.isArray(p.image_urls)?p.image_urls.filter(u=>typeof u==="string"&&/^https:\/\//i.test(u)).slice(0,6):(p.image_url?[p.image_url]:[]);
  const gallery=photos.length?'<div class="external-gallery">'+photos.map((u,i)=>'<a href="'+esc(p.url)+'" target="_blank" rel="noopener"><img src="'+esc(u)+'" alt="Image declared by the original listing page, image '+(i+1)+'" loading="lazy"></a>').join("")+'</div><p class="muted">Source-page image metadata · confirm the photo on the original listing.</p>':'<div class="empty">No verified source-page image metadata was found. Open the original listing to view its photos.</div>';
  const budgetNote=p.budget_status==="over_budget"?'<p class="budget-warning">Over your stated budget · '+moneyFormat(p.listing_price,p.criteria_currency||"GBP")+' (source-stated price)</p>':p.budget_status==="within_budget"?'<p class="budget-ok">Source-stated price is within your budget.</p>':'<p class="muted">Price not verified against your budget — check the original listing.</p>';
  return '<article class="property-card">'+gallery+'<div class="property-body"><span class="chip">External listing · '+esc(p.source||"Web source")+'</span>'+budgetNote+'<h3>'+esc(p.title)+'</h3><p>'+esc(p.snippet||"Open the original source for listing details.")+'</p><p class="muted">'+esc(p.listing_status||"Details and availability have not been independently verified.")+'</p><div class="contact"><a href="'+esc(p.url)+'" target="_blank" rel="noopener">View original listing ↗</a></div></div></article>';
 }).join("");
 host.innerHTML=internal+outside;
  host.querySelectorAll(".external-gallery img").forEach(img=>{
   const reject=()=>{const path=(img.currentSrc||img.src||"").split("?")[0].toLowerCase();const ratio=img.naturalWidth/(img.naturalHeight||1);if(/(?:logo|icon|avatar|favicon|banner|sprite|badge|floor.?plan|map|brochure|watermark|placeholder|no.?image)/.test(path)||!img.naturalWidth||!img.naturalHeight||img.naturalWidth<320||img.naturalHeight<200||ratio>2.35||ratio<0.55){const link=img.closest("a");if(link)link.remove();}};
   img.addEventListener("load",reject,{once:true});img.addEventListener("error",()=>{const link=img.closest("a");if(link)link.remove();},{once:true});if(img.complete)reject();
  });
  host.querySelectorAll(".external-gallery").forEach(gallery=>{if(!gallery.querySelector("img")){const card=gallery.closest(".property-card"),body=card&&card.querySelector(".property-body");gallery.remove();if(body)body.insertAdjacentHTML("afterbegin",'<div class="empty">No suitable property photographs could be confirmed. Open the original listing to view its photos.</div>');}});
}
document.addEventListener("click",async e=>{const b=e.target.closest("[data-enquiry]");if(!b)return;const message=prompt("Write a short message to the seller about this property:");if(!message||!message.trim())return;b.disabled=true;try{const r=await fetch(API+"/api/leads",{method:"POST",headers:{"Content-Type":"application/json","Authorization":"Bearer "+await getToken()},body:JSON.stringify({property_id:b.dataset.enquiry,buyer_name:auth.currentUser?.displayName||"",message:message.trim()})}),d=await r.json();if(!r.ok)throw new Error(d.error||"Could not send enquiry.");alert(d.message||"Enquiry sent.");}catch(err){alert(err.message||"Unable to send enquiry.");}finally{b.disabled=false;}});
$("search-form").addEventListener("submit",async e=>{
 e.preventDefault();hide("search-notice");const btn=$("search-btn");btn.disabled=true;btn.textContent="AI agents are searching…";
 try{
  const parts=[$("buyer-query").value.trim(),$("buyer-purpose").value?"Purpose: "+$("buyer-purpose").value:"",$("buyer-city").value?"Location: "+$("buyer-city").value:"",$("buyer-country").value?"Country: "+$("buyer-country").value:"",$("buyer-currency").value?"Budget currency: "+$("buyer-currency").value:"",$("buyer-type").value?"Property type: "+$("buyer-type").value:"",$("buyer-bedrooms").value?"At least "+$("buyer-bedrooms").value+" bedrooms":"",$("buyer-budget").value?"Maximum budget "+($("buyer-currency").value||"in local currency")+" "+$("buyer-budget").value:"",$("buyer-state").value?"State: "+$("buyer-state").value:""].filter(Boolean);
  const r=await fetch(API+"/api/ai-search",{method:"POST",headers:{"Content-Type":"application/json","Authorization":"Bearer "+await getToken()},body:JSON.stringify({query:parts.join(". ")})}),d=await r.json();if(!r.ok)throw new Error(d.error||"Search failed.");
  render(d.properties||[],d.external_results||[]);notice("search-notice","AI understood your request: "+JSON.stringify(d.criteria)+". Matches are ranked against the sellers' submitted property details.");
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
  const body={seller_name:$("seller-name").value.trim(),seller_phone:$("seller-phone").value.trim(),purpose:$("purpose").value,property_type:$("property-type").value,title:$("property-title").value.trim(),description:$("property-description").value.trim(),location:$("property-location").value.trim(),city:$("property-city").value.trim(),state:$("property-state").value.trim(),country:$("property-country").value.trim(),currency:$("property-currency").value,price:$("property-price").value,bedrooms:$("property-bedrooms").value,bathrooms:$("property-bathrooms").value,size_sqm:$("property-size").value,condition:$("property-condition").value.trim(),features,photos,authority_confirmed:$("authority-confirmed").checked,contact_consent:$("contact-consent").checked};
  const r=await fetch(API+"/api/properties",{method:"POST",headers:{"Content-Type":"application/json","Authorization":"Bearer "+await getToken()},body:JSON.stringify(body)}),d=await r.json();if(!r.ok)throw new Error(d.error||"Could not publish property.");
  notice("seller-notice","Your property has been published. Buyers can now find it in AgentCoPilot search.");$("seller-form").reset();$("photo-preview").innerHTML="";
 }catch(err){notice("seller-notice",err.message||"Unable to publish property.");}finally{btn.disabled=false;btn.textContent="Publish property";}
});
