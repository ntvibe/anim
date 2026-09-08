(() => {
  "use strict";

  const FPS = 25, LOGO_START = 0, LOGO_END = 50;
  const LOGO_W = 165, WORDMARK_W = 704, MAX_W = 1710;
  const $ = (id) => document.getElementById(id);
  const el = {
    stage: $("stageShell"), artboard: $("artboard"), lockup: $("lockup"), portal: $("portal"),
    wordmark: $("wordmark"), custom: $("customText"), logo: $("logoAnim"), phase: $("phase"),
    text: $("text"), textSize: $("textSize"), logoSpeed: $("logoSpeed"), startHold: $("startHold"),
    endHold: $("endHold"), wordmarkDur: $("wordmarkDur"), centerPause: $("centerPause"), textDur: $("textDur"),
    preLogoHold: $("preLogoHold"), gap: $("gap"), tracking: $("tracking"), portalOverlap: $("portalOverlap"),
    curveTarget: $("curveTarget"), curveValue: $("curveValue"), curveSvg: $("curveSvg"), curvePath: $("curvePath"),
    h1: $("h1"), h2: $("h2"), h1line: $("h1line"), h2line: $("h2line"),
    x1: $("x1"), y1: $("y1"), x2: $("x2"), y2: $("y2"), playPause: $("playPause"), restart: $("restart"),
    scrub: $("scrub"), loop: $("loop"), timeV: $("timeV"), logoDur: $("logoDur"), totalDur: $("totalDur"),
    textWidthV: $("textWidthV"), err: $("err")
  };

  const settings = {text:"Für alle, die handeln.", textSize:154, logoSpeed:1, startHold:2, endHold:2.96,
    wordmarkDur:.40, centerPause:.32, textDur:1.28, preLogoHold:1.04, gap:54, tracking:-2.5, portalOverlap:37, loop:true};
  const curves = {wordmark:[.35,0,.18,1], text:[.16,1,.30,1], layout:[.34,0,.18,1]};
  const presets = {linear:[0,0,1,1], ease:[.25,.1,.25,1], out:[.16,1,.30,1], snappy:[.18,.88,.22,1.18]};
  let anim = null, ready = false, playing = true, elapsed = 0, lastNow = performance.now(), textW = 600;
  let draggingTimeline = false, dragHandle = null;

  const clamp = (v,a,b) => Math.max(a,Math.min(b,v));
  const logoDuration = () => ((LOGO_END - LOGO_START) / FPS) / settings.logoSpeed;
  function times(){let t=0,a={};a.initial0=t;t+=settings.startHold;a.initial1=t;a.word0=t;t+=settings.wordmarkDur;a.word1=t;a.pause0=t;t+=settings.centerPause;a.pause1=t;a.text0=t;t+=settings.textDur;a.text1=t;a.pre0=t;t+=settings.preLogoHold;a.pre1=t;a.logo0=t;t+=logoDuration();a.logo1=t;a.end0=t;t+=settings.endHold;a.end1=t;a.total=t;return a;}

  function cubicCoord(t,a,b){const mt=1-t;return 3*mt*mt*t*a+3*mt*t*t*b+t*t*t;}
  function cubicDeriv(t,a,b){return 3*(1-t)*(1-t)*a+6*(1-t)*t*(b-a)+3*t*t*(1-b);}
  function bezierEase(c,x){x=clamp(x,0,1);let t=x;for(let i=0;i<7;i++){const dx=cubicCoord(t,c[0],c[2])-x,d=cubicDeriv(t,c[0],c[2]);if(Math.abs(dx)<1e-5||Math.abs(d)<1e-6)break;t=clamp(t-dx/d,0,1);}let lo=0,hi=1;for(let i=0;i<10;i++){const xx=cubicCoord(t,c[0],c[2]);if(Math.abs(xx-x)<1e-5)break;if(xx<x)lo=t;else hi=t;t=(lo+hi)/2;}return cubicCoord(t,c[1],c[3]);}

  function fit(){const r=el.stage.getBoundingClientRect(),s=Math.min(r.width/1920,r.height/600);el.artboard.style.transform=`translate(-50%,-50%) scale(${s})`;}
  function measure(){el.custom.textContent=settings.text||" ";el.custom.style.fontSize=settings.textSize+"px";el.custom.style.letterSpacing=settings.tracking+"px";const available=MAX_W-LOGO_W-settings.gap;let raw=Math.max(el.custom.scrollWidth,1);if(raw>available){el.custom.style.fontSize=Math.max(44,settings.textSize*(available/raw))+"px";}textW=Math.ceil(el.custom.scrollWidth);el.textWidthV.textContent=textW+" px";}
  function setLogoFrame(f){if(ready)anim.goToAndStop(clamp(Math.floor(f+1e-6),LOGO_START,LOGO_END),true);}
  const portalLeft = () => LOGO_W-settings.portalOverlap;
  const contentRestX = () => settings.portalOverlap+settings.gap;
  function setLayout(contentWidth,p){const lp=bezierEase(curves.layout,clamp(p,0,1));const total=LOGO_W+(settings.gap+contentWidth)*lp;el.lockup.style.width=Math.max(LOGO_W,total)+"px";el.portal.style.left=portalLeft()+"px";el.portal.style.width=Math.max(0,total-portalLeft())+"px";}

  function render(t){
    if(!ready)return;const tm=times(),total=Math.max(tm.total,.001);t=settings.loop?((t%total)+total)%total:clamp(t,0,total);
    el.wordmark.style.display="block";el.custom.style.display="block";el.wordmark.style.transform=`translateX(${contentRestX()}px)`;el.custom.style.transform=`translateY(-50%) translateX(${contentRestX()}px)`;setLogoFrame(LOGO_END);
    let phase="";
    if(t<tm.initial1){setLayout(WORDMARK_W,1);phase="wordmark hold";}
    else if(t<tm.word1){const u=(t-tm.word0)/Math.max(settings.wordmarkDur,.001),p=bezierEase(curves.wordmark,u),lp=bezierEase(curves.layout,u);const x=contentRestX()+(-WORDMARK_W-contentRestX()+settings.portalOverlap*.45)*p;el.wordmark.style.transform=`translateX(${x}px)`;el.custom.style.transform=`translateY(-50%) translateX(${-textW}px)`;setLayout(WORDMARK_W,1-lp);phase="wordmark into B";}
    else if(t<tm.pause1){el.wordmark.style.transform=`translateX(${-WORDMARK_W}px)`;el.custom.style.transform=`translateY(-50%) translateX(${-textW}px)`;setLayout(0,0);phase="B only";}
    else if(t<tm.text1){const u=(t-tm.text0)/Math.max(settings.textDur,.001),p=bezierEase(curves.text,u),lp=bezierEase(curves.layout,u);const x=(-textW-settings.portalOverlap*.25)+(contentRestX()+textW+settings.portalOverlap*.25)*p;el.wordmark.style.transform=`translateX(${-WORDMARK_W}px)`;el.custom.style.transform=`translateY(-50%) translateX(${x}px)`;setLayout(textW,lp);phase="text out of B";}
    else if(t<tm.logo0){el.wordmark.style.transform=`translateX(${-WORDMARK_W}px)`;el.custom.style.transform=`translateY(-50%) translateX(${contentRestX()}px)`;setLayout(textW,1);phase="text hold";}
    else if(t<tm.logo1){el.wordmark.style.transform=`translateX(${-WORDMARK_W}px)`;el.custom.style.transform=`translateY(-50%) translateX(${contentRestX()}px)`;setLayout(textW,1);const u=(t-tm.logo0)/Math.max(logoDuration(),.001);setLogoFrame(LOGO_START+u*(LOGO_END-LOGO_START));phase="B animation";}
    else{el.wordmark.style.transform=`translateX(${-WORDMARK_W}px)`;el.custom.style.transform=`translateY(-50%) translateX(${contentRestX()}px)`;setLayout(textW,1);setLogoFrame(LOGO_END);phase="final hold";}
    el.phase.textContent=phase+" · "+t.toFixed(2)+"s";el.timeV.textContent=t.toFixed(2)+" s";if(!draggingTimeline)el.scrub.value=String(t);
  }

  function updateUI(){const vals={textSizeV:settings.textSize.toFixed(0)+" px",logoSpeedV:settings.logoSpeed.toFixed(2)+"×",startHoldV:settings.startHold.toFixed(2)+" s",endHoldV:settings.endHold.toFixed(2)+" s",wordmarkDurV:settings.wordmarkDur.toFixed(2)+" s",centerPauseV:settings.centerPause.toFixed(2)+" s",textDurV:settings.textDur.toFixed(2)+" s",preLogoHoldV:settings.preLogoHold.toFixed(2)+" s",gapV:settings.gap.toFixed(0)+" px",trackingV:settings.tracking.toFixed(1)+" px",portalOverlapV:settings.portalOverlap.toFixed(0)+" px"};for(const k in vals)$(k).textContent=vals[k];el.logoDur.textContent=logoDuration().toFixed(2)+" s";const tm=times();el.totalDur.textContent=tm.total.toFixed(2)+" s";el.scrub.max=tm.total;el.playPause.textContent=playing?"Pause":"Play";measure();updateCurveUI();}
  function tick(now){const dt=Math.min(.08,Math.max(0,(now-lastNow)/1000));lastNow=now;if(playing&&ready){elapsed+=dt;const total=times().total;if(settings.loop&&total>0&&elapsed>=total)elapsed%=total;if(!settings.loop&&elapsed>=total){elapsed=total;playing=false;updateUI();}render(elapsed);}requestAnimationFrame(tick);}
  function restart(){elapsed=0;lastNow=performance.now();render(0);}function play(){playing=true;lastNow=performance.now();updateUI();}function pause(){playing=false;updateUI();}
  function bindRange(id,key=id){$(id).addEventListener("input",e=>{settings[key]=Number(e.target.value);updateUI();elapsed=clamp(elapsed,0,times().total);render(elapsed);});}
  el.text.addEventListener("input",()=>{settings.text=el.text.value;updateUI();render(elapsed);});["textSize","logoSpeed","startHold","endHold","wordmarkDur","centerPause","textDur","preLogoHold","gap","tracking","portalOverlap"].forEach(id=>bindRange(id));
  el.loop.addEventListener("change",()=>{settings.loop=el.loop.checked;updateUI();});el.playPause.addEventListener("click",()=>playing?pause():play());el.restart.addEventListener("click",restart);el.scrub.addEventListener("pointerdown",()=>{draggingTimeline=true;pause();});el.scrub.addEventListener("input",()=>{elapsed=Number(el.scrub.value);render(elapsed);});el.scrub.addEventListener("change",()=>{draggingTimeline=false;});

  function curveMapPt(x,y){return[28+x*244,142-y*114];}
  function updateCurveUI(){const c=curves[el.curveTarget.value];[el.x1.value,el.y1.value,el.x2.value,el.y2.value]=c.map(v=>Number(v).toFixed(2));el.curveValue.textContent=c.map(v=>Number(v).toFixed(2)).join(", ");const p0=curveMapPt(0,0),p1=curveMapPt(c[0],c[1]),p2=curveMapPt(c[2],c[3]),p3=curveMapPt(1,1);el.h1.setAttribute("cx",p1[0]);el.h1.setAttribute("cy",p1[1]);el.h2.setAttribute("cx",p2[0]);el.h2.setAttribute("cy",p2[1]);el.h1line.setAttribute("x1",p0[0]);el.h1line.setAttribute("y1",p0[1]);el.h1line.setAttribute("x2",p1[0]);el.h1line.setAttribute("y2",p1[1]);el.h2line.setAttribute("x1",p3[0]);el.h2line.setAttribute("y1",p3[1]);el.h2line.setAttribute("x2",p2[0]);el.h2line.setAttribute("y2",p2[1]);el.curvePath.setAttribute("d",`M ${p0[0]} ${p0[1]} C ${p1[0]} ${p1[1]} ${p2[0]} ${p2[1]} ${p3[0]} ${p3[1]}`);}
  function setCurve(vals){const k=el.curveTarget.value;curves[k]=[clamp(vals[0],0,1),clamp(vals[1],-1,2),clamp(vals[2],0,1),clamp(vals[3],-1,2)];updateCurveUI();render(elapsed);}
  [el.x1,el.y1,el.x2,el.y2].forEach(inp=>inp.addEventListener("input",()=>setCurve([Number(el.x1.value),Number(el.y1.value),Number(el.x2.value),Number(el.y2.value)])));el.curveTarget.addEventListener("change",updateCurveUI);document.querySelectorAll("[data-preset]").forEach(b=>b.addEventListener("click",()=>setCurve(presets[b.dataset.preset].slice())));
  function pointerToCurve(e){const r=el.curveSvg.getBoundingClientRect(),x=(e.clientX-r.left)/r.width*300,y=(e.clientY-r.top)/r.height*170;return[clamp((x-28)/244,0,1),clamp((142-y)/114,-1,2)];}
  function drag(e){if(!dragHandle)return;const[x,y]=pointerToCurve(e),c=curves[el.curveTarget.value].slice();if(dragHandle===1){c[0]=x;c[1]=y;}else{c[2]=x;c[3]=y;}setCurve(c);}el.h1.addEventListener("pointerdown",e=>{dragHandle=1;el.curveSvg.setPointerCapture(e.pointerId);});el.h2.addEventListener("pointerdown",e=>{dragHandle=2;el.curveSvg.setPointerCapture(e.pointerId);});el.curveSvg.addEventListener("pointermove",drag);el.curveSvg.addEventListener("pointerup",()=>dragHandle=null);el.curveSvg.addEventListener("pointercancel",()=>dragHandle=null);

  function decodeAnimation(){const parts=window.__BP_DATA_PARTS||[];if(parts.length!==7||parts.some(x=>!x))throw new Error("Bitpanda Lottie data is incomplete.");const bytes=Uint8Array.from(atob(parts.join("")),c=>c.charCodeAt(0));return JSON.parse(new TextDecoder().decode(bytes));}
  function loadScript(url){return new Promise((resolve,reject)=>{const s=document.createElement("script");s.src=url;s.onload=resolve;s.onerror=()=>reject(new Error("Failed to load "+url));document.head.appendChild(s);});}
  async function ensureLottie(){if(window.lottie)return;const urls=["https://cdn.jsdelivr.net/npm/lottie-web@5.13.0/build/player/lottie.min.js","https://unpkg.com/lottie-web@5.13.0/build/player/lottie.min.js","https://cdnjs.cloudflare.com/ajax/libs/bodymovin/5.13.0/lottie.min.js"];let last;for(const u of urls){try{await loadScript(u);if(window.lottie)return;}catch(e){last=e;}}throw last||new Error("Could not load lottie-web");}

  new ResizeObserver(fit).observe(el.stage);
  async function boot(){try{await ensureLottie();const animationData=decodeAnimation();anim=lottie.loadAnimation({container:el.logo,renderer:"svg",loop:false,autoplay:false,animationData,rendererSettings:{progressiveLoad:false}});anim.setSubframe(false);anim.addEventListener("DOMLoaded",()=>{ready=true;const svg=el.logo.querySelector("svg");if(svg){svg.setAttribute("viewBox","744 228 412 608");svg.setAttribute("preserveAspectRatio","xMidYMid meet");}measure();updateUI();setLogoFrame(LOGO_END);render(0);});anim.addEventListener("renderFrameError",e=>{el.err.style.display="block";el.err.textContent="Lottie render error: "+(e&&e.nativeError?e.nativeError:e);});}catch(e){el.err.style.display="block";el.err.textContent=String(e&&e.stack?e.stack:e);}}

  window.bitpandaLockup={play,pause,restart,setText(v){settings.text=String(v);el.text.value=settings.text;updateUI();render(elapsed);},setCurve(name,v){if(curves[name]){curves[name]=v.slice(0,4);updateCurveUI();render(elapsed);}},setSpeed(v){settings.logoSpeed=clamp(Number(v)||1,.1,4);el.logoSpeed.value=settings.logoSpeed;updateUI();},seek(v){pause();elapsed=clamp(Number(v)||0,0,times().total);render(elapsed);},getSettings(){return{...settings,curves:JSON.parse(JSON.stringify(curves))};},getDuration(){return times().total;}};

  fit();measure();updateUI();requestAnimationFrame(tick);boot();
})();
