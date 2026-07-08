"use strict";
/**
 * Monargo One · moderne datum/tijd-kiezer (Editorial 2026).
 *
 * Progressive enhancement: vervangt de lelijke, browser-eigen popups van
 * <input type="date|time|datetime-local"> door één consistente, licht-getinte
 * popover (kalender + tijdkolommen) in de Monargo-stijl. De onderliggende
 * native input blijft in de DOM staan met dezelfde naam/waarde/required, dus
 * formulieren en bestaande JS (die input.value leest) blijven ongewijzigd werken.
 *
 * Waardeformaten blijven exact zoals native:
 *   date            -> "YYYY-MM-DD"
 *   time            -> "HH:MM"
 *   datetime-local  -> "YYYY-MM-DDTHH:MM"
 *
 * Werkt in alle shells: hangt via event-delegation aan document, dus ook aan
 * inputs die later dynamisch gerenderd worden · geen registratie per scherm nodig.
 */
(function () {
  if (window.__monargoDT) return;
  window.__monargoDT = true;

  var SEL = 'input[type="date"],input[type="time"],input[type="datetime-local"]';
  var MONTHS = ["januari","februari","maart","april","mei","juni","juli","augustus","september","oktober","november","december"];
  var DOW = ["ma","di","wo","do","vr","za","zo"];

  // ── Stijl (gebruikt de globale Editorial-tokens) ──────────────────────────
  var css = ''
    + SEL.split(',').map(function(s){return s+'::-webkit-calendar-picker-indicator';}).join(',')
    + '{opacity:0;display:none}'
    + '.mdt-pop{position:fixed;z-index:4000;background:var(--surface,#fff);border:1px solid var(--line,#e5e5ea);'
    + 'border-radius:16px;box-shadow:0 12px 40px rgba(0,0,0,.14);padding:14px;'
    + 'font-family:var(--font-sans,-apple-system,Segoe UI,sans-serif);color:var(--ink,#1d1d1f);'
    + 'width:max-content;display:flex;gap:14px;animation:mdtIn .12s ease}'
    + '@keyframes mdtIn{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:none}}'
    + '.mdt-cal{width:252px}'
    + '.mdt-hd{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px}'
    + '.mdt-title{font-size:14px;font-weight:600;letter-spacing:-.2px;text-transform:capitalize}'
    + '.mdt-nav{display:flex;gap:4px}'
    + '.mdt-nav button{width:30px;height:30px;border:none;background:none;border-radius:8px;cursor:pointer;'
    + 'color:var(--gray-600);font-size:16px;display:grid;place-items:center;transition:background .12s}'
    + '.mdt-nav button:hover{background:rgba(0,0,0,.05)}'
    + '.mdt-dow{display:grid;grid-template-columns:repeat(7,1fr);gap:2px;margin-bottom:4px}'
    + '.mdt-dow span{font-size:10.5px;color:var(--muted,#6e6e73);text-align:center;padding:4px 0;font-weight:500}'
    + '.mdt-grid{display:grid;grid-template-columns:repeat(7,1fr);gap:2px}'
    + '.mdt-day{height:32px;border:none;background:none;border-radius:9px;cursor:pointer;font-size:13px;'
    + 'color:var(--ink,#1d1d1f);transition:background .1s,color .1s}'
    + '.mdt-day:hover{background:var(--wf-blue-l)}'
    + '.mdt-day.mut{color:var(--gray-300)}'
    + '.mdt-day.today{font-weight:600;color:var(--wf-blue)}'
    + '.mdt-day.sel{background:var(--wf-blue);color:#fff;font-weight:600}'
    + '.mdt-day:disabled{color:var(--gray-300);cursor:not-allowed;background:none}'
    + '.mdt-time{display:flex;flex-direction:column;align-items:center}'
    /* Analoge klok-picker (Material-stijl) */
    + '.mdt-clock{width:232px;user-select:none}'
    + '.mdt-tlbl{font-size:10.5px;font-weight:600;letter-spacing:.8px;text-transform:uppercase;color:var(--muted,#6e6e73);margin-bottom:8px;text-align:left}'
    + '.mdt-tdisp{display:flex;align-items:center;justify-content:center;gap:4px;margin-bottom:12px}'
    + '.mdt-tseg{border:none;cursor:pointer;font-family:inherit;font-variant-numeric:tabular-nums;'
    + 'font-size:34px;font-weight:600;letter-spacing:-1px;padding:2px 10px;border-radius:10px;'
    + 'background:var(--gray-100);color:var(--ink,#1d1d1f);transition:background .12s,color .12s}'
    + '.mdt-tseg.on{background:var(--wf-blue-l);color:var(--wf-blue)}'
    + '.mdt-tcolon{font-size:30px;font-weight:600;color:var(--muted,#6e6e73)}'
    + '.mdt-face{position:relative;width:216px;height:216px;margin:0 auto;border-radius:50%;'
    + 'background:var(--gray-100);cursor:pointer;touch-action:none}'
    + '.mdt-num{position:absolute;width:30px;height:30px;margin:-15px 0 0 -15px;border-radius:50%;'
    + 'display:grid;place-items:center;font-size:12.5px;font-variant-numeric:tabular-nums;'
    + 'color:var(--ink,#1d1d1f);pointer-events:none}'
    + '.mdt-num.inner{font-size:10.5px;color:var(--muted,#6e6e73)}'
    + '.mdt-num.on{background:var(--wf-blue);color:#fff;font-weight:600;z-index:2}'
    + '.mdt-hand{position:absolute;left:50%;bottom:50%;width:2px;margin-left:-1px;background:var(--wf-blue);'
    + 'transform-origin:50% 100%;pointer-events:none}'
    + '.mdt-hand.anim{transition:height .18s ease,transform .2s cubic-bezier(.2,.7,.2,1)}'
    + '.mdt-hand::after{content:"";position:absolute;top:-4px;left:50%;transform:translateX(-50%);'
    + 'width:8px;height:8px;border-radius:50%;background:var(--wf-blue)}'
    + '.mdt-cdot{position:absolute;left:50%;top:50%;width:7px;height:7px;margin:-3.5px 0 0 -3.5px;'
    + 'border-radius:50%;background:var(--wf-blue);pointer-events:none;z-index:3}'
    + '.mdt-foot{display:flex;gap:8px;justify-content:space-between;align-items:center;margin-top:12px;padding-top:10px;border-top:1px solid var(--line,#e5e5ea)}'
    + '.mdt-now{background:none;border:none;color:var(--wf-blue);font-size:12.5px;font-weight:600;cursor:pointer;padding:6px 4px}'
    + '.mdt-btns{display:flex;gap:6px}'
    + '.mdt-btn{padding:7px 16px;border-radius:980px;font-size:13px;font-weight:600;cursor:pointer;border:none;font-family:inherit}'
    + '.mdt-btn-clear{background:none;color:var(--muted,#6e6e73)}'
    + '.mdt-btn-ok{background:var(--wf-blue);color:#fff}';
  var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);

  // ── Helpers ───────────────────────────────────────────────────────────────
  function pad(n){ return (n<10?'0':'')+n; }
  function ymd(d){ return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate()); }
  function parseDate(s){ if(!s) return null; var m=String(s).match(/(\d{4})-(\d{2})-(\d{2})/); return m?new Date(+m[1],+m[2]-1,+m[3]):null; }
  function parseTime(s){ if(!s) return null; var m=String(s).match(/T?(\d{2}):(\d{2})/); return m?{h:+m[1],min:+m[2]}:null; }

  var current = null; // {input, type, pop, view(Date), date(Date|null), time({h,min}|null)}

  function close(){
    if(!current) return;
    current.pop.remove(); current=null;
    document.removeEventListener('mousedown',onDoc,true);
    window.removeEventListener('resize',close);
    window.removeEventListener('scroll',close,true);
    if(drag){ document.removeEventListener('pointermove',onFaceMove,true); document.removeEventListener('pointerup',onFaceUp,true); document.removeEventListener('pointercancel',onFaceUp,true); drag=null; }
  }

  function onDoc(e){ if(current && !current.pop.contains(e.target) && e.target!==current.input) close(); }

  function commit(){
    var inp=current.input, type=current.type, val='';
    if(type!=='time' && !current.date) current.date=new Date();
    if(type!=='date' && !current.time) { var n=new Date(); current.time={h:n.getHours(),min:n.getMinutes()}; }
    if(type==='date') val=ymd(current.date);
    else if(type==='time') val=pad(current.time.h)+':'+pad(current.time.min);
    else val=ymd(current.date)+'T'+pad(current.time.h)+':'+pad(current.time.min);
    inp.value=val;
    inp.dispatchEvent(new Event('input',{bubbles:true}));
    inp.dispatchEvent(new Event('change',{bubbles:true}));
  }

  function renderCal(){
    var c=current, host=c.pop.querySelector('.mdt-cal'); if(!host) return;
    var view=c.view, y=view.getFullYear(), mo=view.getMonth();
    var today=new Date(); var min=parseDate(c.input.min), max=parseDate(c.input.max);
    var first=new Date(y,mo,1); var startDow=(first.getDay()+6)%7; // ma=0
    var grid='';
    for(var i=0;i<42;i++){
      var d=new Date(y,mo,1-startDow+i); var inMonth=d.getMonth()===mo;
      var dis=(min&&d<min)||(max&&d>max);
      var cls='mdt-day'+(inMonth?'':' mut')
        +(ymd(d)===ymd(today)?' today':'')
        +(c.date&&ymd(d)===ymd(c.date)?' sel':'');
      grid+='<button type="button" class="'+cls+'"'+(dis?' disabled':'')+' data-d="'+ymd(d)+'">'+d.getDate()+'</button>';
    }
    host.innerHTML=''
      +'<div class="mdt-hd"><div class="mdt-title">'+MONTHS[mo]+' '+y+'</div>'
      +'<div class="mdt-nav"><button type="button" data-mv="-1" aria-label="Vorige maand">‹</button>'
      +'<button type="button" data-mv="1" aria-label="Volgende maand">›</button></div></div>'
      +'<div class="mdt-dow">'+DOW.map(function(x){return '<span>'+x+'</span>';}).join('')+'</div>'
      +'<div class="mdt-grid">'+grid+'</div>';
  }

  // ── Analoge klok-picker ─────────────────────────────────────────────────────
  // 24-uurs wijzerplaat (Material-stijl): buitenring 00 + 13..23, binnenring
  // 12 + 01..11; minuten in stappen van 5 op één ring, vrij sleepbaar (1-min).
  var R_OUT=90, R_IN=58, CX=108, CY=108;
  function polar(r,deg){ var t=deg*Math.PI/180; return {x:CX+r*Math.sin(t), y:CY-r*Math.cos(t)}; }
  function hourAt(p,inner){ return inner ? (p===0?12:p) : (p===0?0:p+12); }

  // Volledige opbouw (bij openen). Wijzer + middelpunt blijven daarna staan,
  // enkel de cijferlaag wordt herbouwd bij wissel uur/minuut.
  function buildTime(){
    var c=current, host=c.pop.querySelector('.mdt-time'); if(!host) return;
    if(!c.time){ var n=new Date(); c.time={h:n.getHours(),min:n.getMinutes()}; }
    if(!c.tmode) c.tmode='h';
    host.innerHTML=''
      +'<div class="mdt-clock">'
      +'<div class="mdt-tlbl">Tijd selecteren</div>'
      +'<div class="mdt-tdisp">'
      +'<button type="button" class="mdt-tseg mdt-seg-h" data-seg="h"></button>'
      +'<span class="mdt-tcolon">:</span>'
      +'<button type="button" class="mdt-tseg mdt-seg-m" data-seg="min"></button>'
      +'</div>'
      +'<div class="mdt-face"><div class="mdt-hand"></div><div class="mdt-cdot"></div><div class="mdt-nums"></div></div>'
      +'</div>';
    renderNums();
    paintTime(false);
  }

  function renderNums(){
    var c=current, wrap=c.pop.querySelector('.mdt-nums'); if(!wrap) return;
    var html='';
    if(c.tmode==='h'){
      for(var p=0;p<12;p++){
        var deg=p*30;
        var vo=hourAt(p,false), po=polar(R_OUT,deg);
        html+='<div class="mdt-num" data-v="'+vo+'" style="left:'+po.x+'px;top:'+po.y+'px">'+pad(vo)+'</div>';
        var vi=hourAt(p,true), pi=polar(R_IN,deg);
        html+='<div class="mdt-num inner" data-v="'+vi+'" style="left:'+pi.x+'px;top:'+pi.y+'px">'+pad(vi)+'</div>';
      }
    } else {
      for(var q=0;q<12;q++){
        var mv=q*5, pm=polar(R_OUT,q*30);
        html+='<div class="mdt-num" data-v="'+mv+'" style="left:'+pm.x+'px;top:'+pm.y+'px">'+pad(mv)+'</div>';
      }
    }
    wrap.innerHTML=html;
  }

  // In-place bijwerken: leesvenster, wijzerhoek/lengte, actief cijfer.
  function paintTime(animate){
    var c=current, host=c.pop.querySelector('.mdt-time'); if(!host||!c.time) return;
    var h=c.time.h, mn=c.time.min, mode=c.tmode;
    var segH=host.querySelector('.mdt-seg-h'), segM=host.querySelector('.mdt-seg-m');
    if(segH){ segH.textContent=pad(h); segH.classList.toggle('on',mode==='h'); }
    if(segM){ segM.textContent=pad(mn); segM.classList.toggle('on',mode==='min'); }
    var hand=host.querySelector('.mdt-hand'), deg, len;
    if(mode==='h'){ var inner=(h>=1&&h<=12); len=inner?R_IN:R_OUT; deg=(h%12)*30; }
    else { len=R_OUT; deg=mn*6; }
    if(hand){ hand.classList.toggle('anim',!!animate); hand.style.height=len+'px'; hand.style.transform='rotate('+deg+'deg)'; }
    var cur = mode==='h'?h:mn;
    host.querySelectorAll('.mdt-num').forEach(function(el){ el.classList.toggle('on', +el.getAttribute('data-v')===cur); });
  }

  // ── Sleep-/tikinteractie op de wijzerplaat ──────────────────────────────────
  var drag=null; // {rect} · face-rect vastgelegd bij pointerdown (popover beweegt niet)
  function faceValue(clientX,clientY){
    if(!drag||!current) return;
    var r=drag.rect, cx=r.left+r.width/2, cy=r.top+r.height/2;
    var dx=clientX-cx, dy=clientY-cy;
    var deg=Math.atan2(dx,-dy)*180/Math.PI; if(deg<0) deg+=360;
    var dist=Math.sqrt(dx*dx+dy*dy), c=current;
    if(c.tmode==='h'){
      var p=Math.round(deg/30)%12, inner=dist < r.width*0.34;
      c.time.h = inner ? (p===0?12:p) : (p===0?0:p+12);
    } else {
      c.time.min = Math.round(deg/6)%60;
    }
  }
  function onFaceDown(e){
    if(!current) return;
    var face=e.target.closest('.mdt-face'); if(!face) return;
    e.preventDefault();
    drag={rect:face.getBoundingClientRect()};
    faceValue(e.clientX,e.clientY); paintTime(false);
    document.addEventListener('pointermove',onFaceMove,true);
    document.addEventListener('pointerup',onFaceUp,true);
    document.addEventListener('pointercancel',onFaceUp,true);
  }
  function onFaceMove(e){ if(!drag) return; e.preventDefault(); faceValue(e.clientX,e.clientY); paintTime(false); }
  function onFaceUp(){
    if(!drag) return;
    document.removeEventListener('pointermove',onFaceMove,true);
    document.removeEventListener('pointerup',onFaceUp,true);
    document.removeEventListener('pointercancel',onFaceUp,true);
    drag=null;
    var c=current; if(!c) return;
    if(c.type==='time') commit();               // input live in sync houden
    if(c.tmode==='h'){ c.tmode='min'; renderNums(); paintTime(true); } // auto-door naar minuten
  }

  function open(input){
    close();
    var type=input.type;
    var pop=document.createElement('div'); pop.className='mdt-pop';
    var dv=parseDate(input.value), tv=parseTime(input.value);
    current={input:input,type:type,pop:pop,view:dv||new Date(),date:dv,time:tv,tmode:'h'};

    var foot='<div class="mdt-foot">';
    foot+= (type!=='time') ? '<button type="button" class="mdt-now">Vandaag</button>'
                           : '<button type="button" class="mdt-now">Nu</button>';
    foot+='<div class="mdt-btns"><button type="button" class="mdt-btn mdt-btn-clear">Wissen</button>'
        +'<button type="button" class="mdt-btn mdt-btn-ok">Klaar</button></div></div>';

    if(type==='datetime-local'){
      // op smalle schermen kalender boven klok stapelen i.p.v. naast elkaar
      var stacked=window.innerWidth<560;
      pop.style.flexDirection='column';
      pop.innerHTML='<div style="display:flex;gap:14px;'+(stacked?'flex-direction:column;align-items:center':'')+'">'
        +'<div class="mdt-cal"></div><div class="mdt-time"></div></div>'+foot;
    } else if(type==='time'){
      pop.innerHTML='<div style="display:flex;flex-direction:column"><div class="mdt-time"></div>'+foot+'</div>';
    } else {
      pop.innerHTML='<div style="display:flex;flex-direction:column"><div class="mdt-cal"></div>'+foot+'</div>';
    }

    document.body.appendChild(pop);
    if(type!=='time') renderCal();
    if(type!=='date') buildTime();
    position(input,pop);

    pop.addEventListener('click', onPop);
    pop.addEventListener('pointerdown', onFaceDown);
    document.addEventListener('mousedown', onDoc, true);
    window.addEventListener('resize', close);
    window.addEventListener('scroll', close, true);
  }

  function position(input,pop){
    var r=input.getBoundingClientRect(), pr=pop.getBoundingClientRect();
    var top=r.bottom+6, left=r.left;
    if(top+pr.height>window.innerHeight-8) top=Math.max(8, r.top-pr.height-6);
    if(left+pr.width>window.innerWidth-8) left=Math.max(8, window.innerWidth-pr.width-8);
    pop.style.top=top+'px'; pop.style.left=left+'px';
  }

  function onPop(e){
    var t=e.target.closest('button'); if(!t) return;
    var c=current;
    if(t.dataset.mv){ c.view=new Date(c.view.getFullYear(), c.view.getMonth()+ (+t.dataset.mv), 1); renderCal(); return; }
    if(t.dataset.d){ c.date=parseDate(t.dataset.d); renderCal(); if(c.type==='date'){ commit(); close(); } return; }
    if(t.dataset.seg){ c.tmode=t.dataset.seg; renderNums(); paintTime(true); return; }
    if(t.classList.contains('mdt-now')){
      var n=new Date();
      if(c.type!=='time'){ c.date=n; c.view=n; renderCal(); }
      if(c.type!=='date'){ c.time={h:n.getHours(),min:n.getMinutes()}; renderNums(); paintTime(true); }
      if(c.type==='date'||c.type==='time'){ commit(); close(); }
      return;
    }
    if(t.classList.contains('mdt-btn-clear')){ c.input.value=''; c.input.dispatchEvent(new Event('input',{bubbles:true})); c.input.dispatchEvent(new Event('change',{bubbles:true})); close(); return; }
    if(t.classList.contains('mdt-btn-ok')){ commit(); close(); return; }
  }

  // ── Inhaken op native inputs (delegatie) ───────────────────────────────────
  function intercept(e){
    var inp=e.target;
    if(!inp || !inp.matches || !inp.matches(SEL) || inp.disabled || inp.readOnly) return;
    if(typeof inp.showPicker==='function') { try{ inp.__noPicker=true; }catch(_){} }
    e.preventDefault();
    if(current && current.input===inp){ return; }
    open(inp);
  }
  document.addEventListener('mousedown', intercept, true);
  // toetsenbord: open op Enter / pijl-omlaag, maar laat typen toe
  document.addEventListener('keydown', function(e){
    var inp=e.target;
    if(!inp || !inp.matches || !inp.matches(SEL)) return;
    if(e.key==='Enter' || e.key==='ArrowDown'){ e.preventDefault(); open(inp); }
    else if(e.key==='Escape') close();
  }, true);
})();
