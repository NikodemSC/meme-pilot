const $=selector=>document.querySelector(selector);
const $$=selector=>[...document.querySelectorAll(selector)];
const list=$("#tokens"),search=$("#search"),nodes=new Map();
const minMcInput=$("#minMc"),clearFilters=$("#clearFilters"),filterError=$("#filterError");
const filterStorageKey="meme-pilot:new-coins:min-mc-usd";
let paperWalletStorageKey="meme-pilot:active-paper-wallet";
const usd=new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",maximumFractionDigits:2});
const compactUsd=new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",notation:"compact",maximumFractionDigits:2});
const number=new Intl.NumberFormat("pl-PL",{maximumFractionDigits:4});
let tokens=[],feedStatus={},paper=null,minMarketCap=null,settingsHydrated=false,refreshTimer=null,activePaperTab="positions",lastHistoryId=null,lastPositionIds=new Set();
let stats=null,statsGeneration=0,statsMonth=new Date().getMonth(),statsYear=new Date().getFullYear(),selectedStatsDay=null;
let activeWalletId="main",refreshGeneration=0,currentUser=null;
function paperUrl(path){return `${path}?walletId=${encodeURIComponent(activeWalletId)}`;}
function acceptPaper(data){paper={...data,wallets:data.wallets||paper?.wallets||[]};renderPaper();}

try{
  const stored=localStorage.getItem(filterStorageKey);
  if(stored!==null&&stored.trim()!==""&&Number.isFinite(Number(stored))&&Number(stored)>=0){minMarketCap=Number(stored);minMcInput.value=String(minMarketCap);}
}catch{}

function money(value){return Number.isFinite(Number(value))?usd.format(Number(value)):"—";}
function compactMoney(value){return Number.isFinite(Number(value))?compactUsd.format(Number(value)):"—";}
function signedMoney(value){const amount=Number(value||0);return `${amount>0?"+":""}${money(amount)}`;}
function pnlClass(value){return Number(value)>0?"positive":Number(value)<0?"negative":"";}
function dateTime(value){return value?new Date(value).toLocaleString("pl-PL",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit"}):"—";}
function shortMint(value=""){return value.length>14?`${value.slice(0,6)}…${value.slice(-5)}`:value;}
function reasonLabel(value){return ({ENTRY_RULES:"Filtry wejścia",TAKE_PROFIT:"Take profit",PARTIAL_TAKE_PROFIT:"Częściowy take profit",STOP_LOSS:"Stop loss",TRAILING_STOP:"Trailing stop",NO_MOVEMENT:"Brak ruchu",MAX_HOLD:"Limit czasu"})[value]||value||"";}
function escapeHtml(value=""){return String(value).replace(/[&<>'"]/g,char=>({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"})[char]);}
function tokenAvatar(item){return item.image?`<img src="${escapeHtml(item.image)}" alt="" loading="lazy" referrerpolicy="no-referrer">`:`<span>${escapeHtml((item.symbol||item.name||"◈").slice(0,2).toUpperCase())}</span>`;}

function setView(name){
  const valid=["scanner","paper","stats","settings"].includes(name)?name:"scanner";
  $$("[data-view-panel]").forEach(panel=>panel.classList.toggle("active",panel.dataset.viewPanel===valid));
  $$("[data-view]").forEach(button=>button.classList.toggle("active",button.dataset.view===valid));
  if(location.hash!==`#${valid}`)history.replaceState(null,"",`#${valid}`);
  if(valid==="stats"&&currentUser)refreshStats();
}
$$('[data-view]').forEach(button=>button.addEventListener('click',()=>setView(button.dataset.view)));
setView(location.hash.slice(1));window.addEventListener("hashchange",()=>setView(location.hash.slice(1)));

function updateCard(node,token){
  node.querySelector("strong").textContent=token.name||token.symbol||"Nowy token";
  node.querySelector(".symbol").textContent=token.symbol||"";
  node.querySelector(".badge").textContent=token.source||token.standard||"Solana";
  const icon=node.querySelector(".icon");
  if(token.image&&icon.dataset.image!==token.image){
    icon.dataset.image=token.image;const image=document.createElement("img");image.src=token.image;image.alt="";image.loading="lazy";image.referrerPolicy="no-referrer";
    image.onerror=()=>{icon.textContent=(token.symbol||token.name||"◈").slice(0,2).toUpperCase()};icon.replaceChildren(image);
  }
  const mc=node.querySelector(".mc-value"),details=node.querySelector(".mc-details"),previous=Number(node.dataset.mc),value=token.marketCapUsd;
  mc.textContent=Number.isFinite(value)?compactUsd.format(value):"—";mc.title=Number.isFinite(value)?usd.format(value):"Brak dostępnej wyceny";
  if(Number.isFinite(value)&&Number.isFinite(previous)&&node.dataset.mc&&previous!==value){mc.classList.remove("tick-up","tick-down");void mc.offsetWidth;mc.classList.add(value>previous?"tick-up":"tick-down");}
  node.dataset.mc=Number.isFinite(value)?String(value):"";
  const metricParts=[];
  if(Number.isFinite(token.marketCapSol))metricParts.push(`${token.marketCapSol.toLocaleString("pl-PL",{maximumFractionDigits:2})} SOL`);
  if(Number.isFinite(token.volume5mUsd))metricParts.push(`Vol 5m ${compactMoney(token.volume5mUsd)}`);
  if(Number.isFinite(token.transactions5m))metricParts.push(`${token.transactions5m} tx`);
  if(Number.isFinite(token.buys5m)&&Number.isFinite(token.sells5m))metricParts.push(`B ${token.buys5m} / S ${token.sells5m}`);
  if(Number.isFinite(token.bondingCurveProgressPercent))metricParts.push(`Curve ${token.bondingCurveProgressPercent.toFixed(0)}%`);
  details.textContent=metricParts.join(" · ")||token.mcSource||"Brak wyceny";
  const label=node.querySelector(".mc-state"),rateStale=token.mcSource?.startsWith("Pump.fun")&&(!token.usdRateAt||Date.now()-token.usdRateAt>60000),disconnected=token.mcSource?.startsWith("Pump.fun")&&!feedStatus.connected,marketStale=token.mcSource==="DEX Screener"&&(Date.now()-Date.parse(token.mcUpdatedAt)>120000||feedStatus.marketError);
  label.textContent=token.mcUpdatedAt?(rateStale||disconnected||marketStale?"Ostatni odczyt":token.mcSource?.startsWith("Pump.fun")?"● On-chain":"↻ Rynek"):"";
  label.classList.toggle("stale",Boolean(rateStale||disconnected||marketStale));label.title=token.mcUpdatedAt?`${token.mcSource} · ${new Date(token.mcUpdatedAt).toLocaleTimeString("pl-PL")}`:"";
}

function renderScanner(){
  const query=search.value.trim().toLowerCase(),pumpTokens=tokens.filter(token=>token.source==="Pump.fun");
  const visible=pumpTokens.filter(token=>(minMarketCap===null||(Number.isFinite(token.marketCapUsd)&&token.marketCapUsd>=minMarketCap))&&[token.mint,token.name,token.symbol].some(value=>value?.toLowerCase().includes(query))),wanted=new Set(visible.map(token=>token.mint));
  $("#count").textContent=visible.length.toLocaleString("pl-PL");$("#countLabel").textContent=`widocznych / ${pumpTokens.length.toLocaleString("pl-PL")} Pump.fun`;
  clearFilters.disabled=minMarketCap===null&&minMcInput.value===""&&!minMcInput.validity.badInput;
  for(const[mint,node]of nodes)if(!wanted.has(mint)){node.remove();nodes.delete(mint);}
  list.querySelector(".empty")?.remove();
  for(let index=0;index<visible.length;index++){
    const token=visible[index];let node=nodes.get(token.mint);
    if(!node){
      node=document.createElement("article");node.className="token";
      node.innerHTML='<div class="asset"><span class="icon">◈</span><div class="details"><div class="token-title"><strong></strong><span class="symbol"></span></div><button class="address" title="Kopiuj adres"></button></div></div><div class="market-cap"><b class="mc-value">—</b><small class="mc-details"></small><small class="mc-state"></small></div><span class="badge"></span><span class="time"></span><a class="tx" target="_blank" rel="noopener noreferrer">Solscan ↗</a>';
      const button=node.querySelector("button");button.textContent=`${token.mint} ⧉`;button.onclick=async()=>{try{await navigator.clipboard.writeText(token.mint);button.textContent="Skopiowano ✓";setTimeout(()=>button.textContent=`${token.mint} ⧉`,1500);}catch{button.textContent=token.mint;}};
      node.querySelector(".time").textContent=token.createdAt?new Date(token.createdAt).toLocaleTimeString("pl-PL"):"—";node.querySelector(".tx").href=`https://solscan.io/tx/${encodeURIComponent(token.signature)}`;nodes.set(token.mint,node);
    }
    updateCard(node,token);if(list.children[index]!==node)list.insertBefore(node,list.children[index]||null);
  }
  if(!visible.length){const empty=document.createElement("div");empty.className="empty";empty.textContent=query||minMarketCap!==null?"Brak tokenów spełniających filtry. Skanowanie trwa.":"Oczekiwanie na nowe tokeny Pump.fun…";list.append(empty);}
}

function renderFeedStatus(){
  const connection=$("#connection");connection.textContent=feedStatus.connected?"● LIVE":feedStatus.message||"Brak połączenia";connection.classList.toggle("live",Boolean(feedStatus.connected));
  $("#queue").textContent=feedStatus.pending?`Do odczytania: ${feedStatus.pending}`:"";
  $("#notice").textContent=[feedStatus.publicRpc?"Publiczne RPC — możliwe opóźnienia i braki.":"",feedStatus.rpcError?"Odczyt transakcji chwilowo niedostępny. Ponawiam.":"",feedStatus.marketError?"Wyceny rynku chwilowo niedostępne. Zachowano ostatnie dane.":"",feedStatus.missed?`Nie odczytano zdarzeń: ${feedStatus.missed}`:""].filter(Boolean).join(" ");
}

function renderPaper(){
  if(!paper)return;const wallet=paper.wallet,status=$("#botStatus"),scrolls={positions:$("#positionsPanel").scrollTop,history:$("#historyPanel").scrollTop,logs:$("#logsPanel").scrollTop};
  const wallets=paper.wallets||[];
  for(const select of [$("#paperWalletSelect"),$("#settingsWalletSelect"),$("#statsWalletSelect")]){
    if(select.options.length!==wallets.length||wallets.some((item,index)=>select.options[index]?.value!==item.id||select.options[index]?.textContent!==item.name)){
      select.replaceChildren(...wallets.map(item=>{const option=document.createElement("option");option.value=item.id;option.textContent=item.name;return option;}));
    }
    select.value=paper.walletId||activeWalletId;
  }
  $("#settingsWalletName").textContent=paper.walletName||wallets.find(item=>item.id===activeWalletId)?.name||"Paper";
  status.className=`bot-status ${paper.status}`;status.querySelector("b").textContent=paper.status==="running"?"Running":paper.status==="paused"?"Paused":"Stopped";
  $("#paperEquity").textContent=money(wallet.equityUsd);$("#paperTotalPnl").textContent=signedMoney(wallet.totalPnlUsd);$("#paperTotalPnl").className=pnlClass(wallet.totalPnlUsd);
  $("#paperCash").textContent=money(wallet.cashUsd);$("#paperCashSol").textContent=feedStatus.solPriceUsd?`${number.format(wallet.cashUsd/feedStatus.solPriceUsd)} SOL`:"— SOL";
  $("#paperPositionsValue").textContent=money(wallet.openValueUsd);$("#paperPositionCount").textContent=`${paper.positions.length} ${paper.positions.length===1?"pozycja":"pozycji"}`;
  for(const [id,value] of [["#paperRealized",wallet.realizedPnlUsd],["#paperUnrealized",wallet.unrealizedPnlUsd]]){const element=$(id);element.textContent=signedMoney(value);element.className=pnlClass(value);}
  $("#positionBadge").textContent=paper.positions.length;$("#historyBadge").textContent=paper.history.length;
  $("#positionsPanel").innerHTML=paper.positions.length?paper.positions.map(position=>`<article class="trade-row position-row"><div class="trade-asset"><span class="mini-avatar">${tokenAvatar(position)}</span><div><strong>${escapeHtml(position.name||position.symbol||"Token")}</strong><button class="copy-mint" data-mint="${escapeHtml(position.mint)}">${escapeHtml(shortMint(position.mint))} ⧉</button></div></div><div><span>Wartość</span><b>${money(position.currentValueUsd)}</b></div><div><span>Wejście / teraz</span><b>${compactMoney(position.entryMarketCapUsd)} → ${compactMoney(position.currentMarketCapUsd)}</b></div><div><span>PnL</span><b class="${pnlClass(position.unrealizedPnlUsd)}">${signedMoney(position.unrealizedPnlUsd)} · ${Number(position.pnlPercent||0).toFixed(2)}%</b></div><div><span>Otwarto</span><b>${dateTime(position.openedAt)}</b></div></article>`).join(""):`<div class="empty compact">Brak otwartych pozycji.</div>`;
  $("#historyPanel").innerHTML=paper.history.length?paper.history.map(trade=>{const fees=Number(trade.networkFeeUsd||0)+Number(trade.platformFeeUsd||0)+Number(trade.slippageUsd||0)+Number(trade.priceImpactUsd||0),marketCaps=trade.signalMarketCapUsd?`${compactMoney(trade.signalMarketCapUsd)} → ${compactMoney(trade.marketCapUsd)}`:compactMoney(trade.marketCapUsd);return `<article class="trade-row history-row"><span class="side ${trade.side.toLowerCase()}">${trade.partial?`SELL ${number.format(trade.soldPercent)}%`:trade.side}</span><div class="trade-asset"><span class="mini-avatar">${tokenAvatar(trade)}</span><div><strong>${escapeHtml(trade.name||trade.symbol||"Token")}</strong><button class="copy-mint" data-mint="${escapeHtml(trade.mint)}">${escapeHtml(shortMint(trade.mint))} ⧉</button><small class="trade-reason">${escapeHtml(reasonLabel(trade.reason))}</small></div></div><div><span>Kwota</span><b>${money(trade.grossUsd)}</b></div><div><span>Fee + koszty</span><b>${money(fees)}</b></div><div><span>MC sygnał → zakup</span><b>${marketCaps}</b></div><div><span>${trade.side==="BUY"?"Wartość tokenów":"Wpływ"}</span><b>${money(trade.netAssetUsd)}</b></div><div><span>Czas</span><b>${dateTime(trade.at)}</b></div></article>`;}).join(""):`<div class="empty compact">Historia jest pusta.</div>`;
  $("#logsPanel").innerHTML=paper.logs.length?paper.logs.map(log=>`<article class="log-row"><span class="log-type ${log.type.toLowerCase()}">${escapeHtml(log.type)}</span><p>${escapeHtml(log.message)}</p><time>${dateTime(log.at)}</time></article>`).join(""):`<div class="empty compact">Brak zdarzeń.</div>`;
  const currentPositionIds=new Set(paper.positions.map(position=>position.id));
  paper.positions.forEach((position,index)=>{if(lastPositionIds.size&&!lastPositionIds.has(position.id))$("#positionsPanel").children[index]?.classList.add("new-row");});
  if(lastHistoryId&&paper.history[0]?.id!==lastHistoryId)$("#historyPanel").firstElementChild?.classList.add("new-row");
  lastPositionIds=currentPositionIds;lastHistoryId=paper.history[0]?.id||lastHistoryId;
  $("#positionsPanel").scrollTop=scrolls.positions;$("#historyPanel").scrollTop=scrolls.history;$("#logsPanel").scrollTop=scrolls.logs;
  $$(".copy-mint").forEach(button=>button.onclick=async()=>{await navigator.clipboard.writeText(button.dataset.mint);const old=button.textContent;button.textContent="Skopiowano ✓";setTimeout(()=>button.textContent=old,1200);});
  if(!settingsHydrated)hydrateSettings();updateWalletConversion();
}

function hydrateSettings(){
  if(!paper)return;const form=$("#strategyForm");
  for(const [key,value] of Object.entries(paper.config)){const field=form.elements.namedItem(key);if(!field)continue;if(field.type==="checkbox")field.checked=Boolean(value);else field.value=value??"";}
  settingsHydrated=true;
}
function updateWalletConversion(){
  const amount=Number($("#walletBalance").value),currency=$("#walletCurrency").value,price=Number(feedStatus.solPriceUsd);
  $("#walletConversion").textContent=!Number.isFinite(amount)||amount<=0?"—":currency==="SOL"?(price?`≈ ${money(amount*price)}`:"Brak aktualnego kursu SOL"):(price?`≈ ${number.format(amount/price)} SOL`:"Brak aktualnego kursu SOL");
}
function showMessage(selector,text,error=false){const node=$(selector);node.textContent=text;node.classList.toggle("error",error);clearTimeout(node._timer);node._timer=setTimeout(()=>node.textContent="",4000);}
async function request(path,options={}){const response=await MemeConnection.fetch(path,{...options,headers:{"Content-Type":"application/json","X-Meme-Pilot-Request":"1",...(options.headers||{})}});if(response.status===401){MemeConnection.login();throw Error("Zaloguj się ponownie.")}const data=await response.json().catch(()=>({}));if(!response.ok)throw Error(data.error||"Operacja nie powiodła się.");return data;}

function statsDateKey(year,month,day){return String(year)+"-"+String(month+1).padStart(2,"0")+"-"+String(day).padStart(2,"0");}
function todayStatsKey(){
  const parts=Object.fromEntries(new Intl.DateTimeFormat("en-GB",{timeZone:"Europe/Warsaw",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date()).map(part=>[part.type,part.value]));
  return parts.year+"-"+parts.month+"-"+parts.day;
}
function renderStatsCalendar(){
  if(!stats)return;
  const days=stats.days||{},today=todayStatsKey(),first=new Date(statsYear,statsMonth,1),firstWeekday=(first.getDay()+6)%7,count=new Date(statsYear,statsMonth+1,0).getDate();
  $("#statsMonthLabel").textContent=first.toLocaleDateString("pl-PL",{month:"long",year:"numeric"});
  $("#nextStatsMonth").disabled=statsYear>Number(today.slice(0,4))||(statsYear===Number(today.slice(0,4))&&statsMonth>=Number(today.slice(5,7))-1);
  const cells=[];
  for(let i=0;i<firstWeekday;i++)cells.push('<span class="calendar-blank"></span>');
  for(let day=1;day<=count;day++){
    const key=statsDateKey(statsYear,statsMonth,day),entry=days[key],pnl=Number(entry?.realizedPnlUsd||0),hasTrades=Boolean(entry?.buyCount||entry?.sellCount);
    const classes=["calendar-day",pnl>0?"positive":pnl<0?"negative":"",key===today?"today":"",key===selectedStatsDay?"active":""].filter(Boolean).join(" ");
    const amount=entry?.sellCount?compactMoney(pnl):"—";
    cells.push('<button type="button" class="'+classes+'" data-stats-day="'+key+'" aria-label="'+key+', wynik '+money(pnl)+'"><span>'+day+'</span><b>'+amount+'</b><small>'+(hasTrades?Number(entry.buyCount||0)+Number(entry.sellCount||0)+" trans.":"")+'</small></button>');
  }
  $("#statsCalendar").innerHTML=cells.join("");
  $$(".calendar-day").forEach(button=>button.addEventListener("click",()=>{selectedStatsDay=button.dataset.statsDay;renderStatsCalendar();}));
  const currentMonth=statsYear===Number(today.slice(0,4))&&statsMonth===Number(today.slice(5,7))-1;
  const selected=selectedStatsDay||(currentMonth?today:statsDateKey(statsYear,statsMonth,1)),entry=days[selected];
  $("#statsDayDetail").innerHTML=entry?'<strong>'+selected+'</strong> · wynik <b class="'+pnlClass(entry.realizedPnlUsd)+'">'+signedMoney(entry.realizedPnlUsd)+'</b> · kupna '+Number(entry.buyCount||0)+' · sprzedaże '+Number(entry.sellCount||0):'<strong>'+selected+'</strong> · brak zapisanych transakcji.';
}

function renderStatsChart(){
  if(!stats)return;
  const now=todayStatsKey(),end=new Date(now+"T12:00:00Z"),keys=[];
  for(let i=29;i>=0;i--){const date=new Date(end);date.setUTCDate(date.getUTCDate()-i);keys.push(date.toISOString().slice(0,10));}
  let total=0;
  const values=[0,...keys.map(key=>{total+=Number(stats.days?.[key]?.realizedPnlUsd||0);return total;})];
  const min=Math.min(0,...values),max=Math.max(0,...values),span=Math.max(1,max-min),pad=span*.12,lower=min-pad,upper=max+pad;
  const x=index=>20+index*560/(values.length-1),y=value=>205-(value-lower)/(upper-lower)*180;
  const points=values.map((value,index)=>x(index).toFixed(1)+","+y(value).toFixed(1));
  const line="M"+points.join(" L"),baseline=y(0).toFixed(1),area=line+" L"+x(values.length-1).toFixed(1)+","+baseline+" L20,"+baseline+" Z";
  const color=total>0?"#67dda4":total<0?"#ff8098":"#bda2ff";
  $("#chartResult").textContent=signedMoney(total);$("#chartResult").className=pnlClass(total);
  $("#chartStart").textContent=keys[0].slice(5).replace("-",".");$("#chartEnd").textContent=keys.at(-1).slice(5).replace("-",".");
  $("#statsChart").innerHTML='<defs><linearGradient id="statsFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="'+color+'" stop-opacity=".28"/><stop offset="100%" stop-color="'+color+'" stop-opacity="0"/></linearGradient></defs><line class="chart-grid" x1="20" y1="25" x2="580" y2="25"/><line class="chart-grid" x1="20" y1="115" x2="580" y2="115"/><line class="chart-grid" x1="20" y1="205" x2="580" y2="205"/><line class="chart-zero" x1="20" y1="'+baseline+'" x2="580" y2="'+baseline+'"/><path d="'+area+'" fill="url(#statsFill)"/><path class="chart-line" style="stroke:'+color+'" d="'+line+'"/><circle class="chart-dot" style="fill:'+color+'" cx="'+x(values.length-1).toFixed(1)+'" cy="'+y(total).toFixed(1)+'" r="5"/>';
}

function renderStats(){
  if(!stats)return;
  for(const [selector,value] of [["#statsTotalPnl",stats.wallet.totalPnlUsd],["#statsRealized",stats.wallet.realizedPnlUsd],["#statsUnrealized",stats.wallet.unrealizedPnlUsd]]){const node=$(selector);node.textContent=signedMoney(value);node.className=pnlClass(value);}
  $("#statsWinRate").textContent=stats.totals.winRatePercent===null?"—":number.format(stats.totals.winRatePercent)+"%";
  $("#statsWinLoss").textContent="Zamknięte: "+stats.totals.closedWins+" zyskownych · "+stats.totals.closedLosses+" stratnych";
  $("#statsEntriesCount").textContent=stats.totals.entries+" wejść";
  $("#statsBuckets").innerHTML=stats.buckets.map(bucket=>{
    const profitRate=bucket.count?Math.round(bucket.profitable/bucket.count*100):0,lossRate=bucket.count?Math.round(bucket.losing/bucket.count*100):0;
    return '<div class="stats-bucket"><strong>'+escapeHtml(bucket.label)+'</strong><span class="bucket-share">'+number.format(bucket.sharePercent)+'%</span><span class="bucket-track"><i style="width:'+Math.max(0,Math.min(100,bucket.sharePercent))+'%"></i></span><span class="bucket-count">'+bucket.count+' wejść · '+bucket.open+' otw.</span><span class="bucket-outcome"><em>↑ '+bucket.profitable+' ('+profitRate+'%)</em> · <i>↓ '+bucket.losing+' ('+lossRate+'%)</i></span></div>';
  }).join("");
  renderStatsCalendar();renderStatsChart();
}

async function refreshStats(){
  const generation=++statsGeneration,walletId=activeWalletId;
  try{
    const data=await request("/api/paper/stats?walletId="+encodeURIComponent(walletId));
    if(generation!==statsGeneration||walletId!==activeWalletId)return;
    stats=data;$("#statsMessage").textContent="";renderStats();
  }catch(error){if(generation===statsGeneration)showMessage("#statsMessage",error.message,true);}
}

async function refresh(){
  const generation=++refreshGeneration,walletId=activeWalletId;
  try{
    const [scannerResponse,paperResponse]=await Promise.all([MemeConnection.fetch("/api/new-coins",{cache:"no-store"}),MemeConnection.fetch(`/api/paper?walletId=${encodeURIComponent(walletId)}`,{cache:"no-store"})]);
    if(scannerResponse.status===401||paperResponse.status===401){MemeConnection.login();return}
    if(!paperResponse.ok&&walletId!=="main"){activeWalletId="main";try{localStorage.setItem(paperWalletStorageKey,"main")}catch{}return refresh();}
    if(!scannerResponse.ok||!paperResponse.ok)throw Error();const scanner=await scannerResponse.json(),state=await paperResponse.json();if(generation!==refreshGeneration)return;tokens=scanner.tokens;feedStatus=scanner.status;paper=state;renderFeedStatus();renderScanner();renderPaper();
  }catch{$("#connection").textContent="Brak połączenia z serwerem";$("#connection").classList.remove("live");}
}
function scheduleRefresh(delay=120){
  if(refreshTimer)return;
  refreshTimer=setTimeout(async()=>{refreshTimer=null;await refresh();},delay);
}

function applyFilters(){
  const raw=minMcInput.value.trim(),invalid=minMcInput.validity.badInput||(raw!==""&&(!Number.isFinite(Number(raw))||Number(raw)<0));
  minMcInput.setAttribute("aria-invalid",String(invalid));filterError.textContent=invalid?"Wpisz kwotę równą lub większą od zera.":"";clearFilters.disabled=false;if(invalid)return;
  minMarketCap=raw===""?null:Number(raw);try{if(minMarketCap===null)localStorage.removeItem(filterStorageKey);else localStorage.setItem(filterStorageKey,String(minMarketCap));}catch{}renderScanner();
}
minMcInput.addEventListener("input",applyFilters);clearFilters.addEventListener("click",()=>{minMcInput.value="";applyFilters();minMcInput.focus();});search.addEventListener("input",renderScanner);

$$('[data-bot-status]').forEach(button=>button.addEventListener('click',async()=>{try{acceptPaper(await request(paperUrl("/api/paper/status"),{method:"POST",body:JSON.stringify({status:button.dataset.botStatus})}));showMessage("#paperMessage",button.dataset.botStatus==="running"?"Bot działa i reaguje na zdarzenia ze skanera.":button.dataset.botStatus==="paused"?"Bot został wstrzymany.":"Bot został zatrzymany.");}catch(error){showMessage("#paperMessage",error.message,true);}}));
$$('[data-paper-tab]').forEach(button=>button.addEventListener('click',()=>{activePaperTab=button.dataset.paperTab;$$('[data-paper-tab]').forEach(item=>item.classList.toggle('active',item===button));$$('.paper-tab-panel').forEach(panel=>panel.classList.toggle('hidden',panel.id!==`${activePaperTab}Panel`));}));

$("#walletBalance").addEventListener("input",updateWalletConversion);$("#walletCurrency").addEventListener("change",updateWalletConversion);
$("#walletForm").addEventListener("submit",async event=>{event.preventDefault();const amount=Number($("#walletBalance").value),currency=$("#walletCurrency").value;if(!Number.isFinite(amount)||amount<=0)return;let balanceUsd=amount;if(currency==="SOL"){if(!(feedStatus.solPriceUsd>0))return showMessage("#paperMessage","Nie ma aktualnego kursu SOL. Wybierz USD lub spróbuj ponownie.",true);balanceUsd=amount*feedStatus.solPriceUsd;}if((paper?.positions.length||paper?.history.length)&&!confirm("To usunie pozycje i historię bieżącej sesji. Kontynuować?"))return;try{acceptPaper(await request(paperUrl("/api/paper/wallet"),{method:"POST",body:JSON.stringify({balanceUsd})}));showMessage("#paperMessage","Utworzono nową sesję paper tradingu.");}catch(error){showMessage("#paperMessage",error.message,true);}});
$("#clearSession").addEventListener("click",async()=>{if(!confirm("Wyczyścić wszystkie pozycje i historię oraz przywrócić saldo początkowe?"))return;try{acceptPaper(await request(paperUrl("/api/paper/reset"),{method:"POST",body:"{}"}));showMessage("#paperMessage","Sesja została wyczyszczona.");}catch(error){showMessage("#paperMessage",error.message,true);}});

$("#strategyForm").addEventListener("submit",async event=>{event.preventDefault();const config={};for(const element of event.currentTarget.elements){if(!element.name)continue;if(element.type==="checkbox")config[element.name]=element.checked;else config[element.name]=element.value===""?null:Number(element.value);}if((config.partialTakeProfitPercent===null)!==(config.partialSellPercent===null))return showMessage("#settingsMessage","Uzupełnij oba pola częściowej sprzedaży albo zostaw oba puste.",true);try{settingsHydrated=false;acceptPaper(await request(paperUrl("/api/paper/config"),{method:"PUT",body:JSON.stringify(config)}));showMessage("#settingsMessage","Ustawienia zapisane dla wybranego portfela.");}catch(error){showMessage("#settingsMessage",error.message,true);}});

for(const select of [$("#paperWalletSelect"),$("#settingsWalletSelect"),$("#statsWalletSelect")])select.addEventListener("change",async event=>{activeWalletId=event.target.value;try{localStorage.setItem(paperWalletStorageKey,activeWalletId)}catch{}settingsHydrated=false;lastHistoryId=null;lastPositionIds=new Set();await refresh();if($('[data-view-panel="stats"]').classList.contains("active"))await refreshStats();});
$("#prevStatsMonth").addEventListener("click",()=>{statsMonth--;if(statsMonth<0){statsMonth=11;statsYear--;}selectedStatsDay=null;renderStatsCalendar();});
$("#nextStatsMonth").addEventListener("click",()=>{statsMonth++;if(statsMonth>11){statsMonth=0;statsYear++;}selectedStatsDay=null;renderStatsCalendar();});
$("#newPaperWallet").addEventListener("click",()=>{$("#newWalletName").value="Paper "+((paper?.wallets?.length||1)+1);$("#createWalletError").textContent="";$("#createWalletDialog").showModal();});
$("#cancelCreateWallet").addEventListener("click",()=>$("#createWalletDialog").close());
$("#createWalletForm").addEventListener("submit",async event=>{
  event.preventDefault();
  try{
    const state=await request("/api/paper/wallets",{method:"POST",body:JSON.stringify({name:$("#newWalletName").value,balanceUsd:Number($("#newWalletBalance").value),cloneConfigFrom:$("#cloneSettings").checked?activeWalletId:null})});
    activeWalletId=state.walletId;try{localStorage.setItem(paperWalletStorageKey,activeWalletId)}catch{}
    settingsHydrated=false;lastHistoryId=null;lastPositionIds=new Set();$("#createWalletDialog").close();acceptPaper(state);
    showMessage("#paperMessage","Nowy niezależny portfel jest gotowy.");
  }catch(error){$("#createWalletError").textContent=error.message;}
});

$("#logout").addEventListener("click",async()=>{try{await request("/api/auth/logout",{method:"POST",body:"{}"})}finally{MemeConnection.saveToken("");MemeConnection.login()}});
async function boot(){
  try{
    const response=await MemeConnection.fetch("/api/auth/me",{cache:"no-store"});
    if(!response.ok){MemeConnection.login();return}
    const data=await response.json();currentUser=data.user;
    $("#accountName").textContent=currentUser.name;
    paperWalletStorageKey=`meme-pilot:active-paper-wallet:${currentUser.id}`;
    try{activeWalletId=localStorage.getItem(paperWalletStorageKey)||"main"}catch{}
    renderScanner();await refresh();
    if($('[data-view-panel="stats"]').classList.contains("active"))refreshStats();
    if(!MemeConnection.remote){
    const events=new EventSource("/api/events");
    events.onmessage=event=>{scheduleRefresh();try{const type=JSON.parse(event.data).type;if($('[data-view-panel="stats"]').classList.contains("active")&&["paper-trade","paper-reset"].includes(type))refreshStats();}catch{}};
    }
    setInterval(()=>scheduleRefresh(0),MemeConnection.remote?3000:10000);
    setInterval(()=>{if($('[data-view-panel="stats"]').classList.contains("active"))refreshStats();},5000);
  }catch{$("#connection").textContent="Brak połączenia z serwerem";setTimeout(boot,5000);}
}
boot();
