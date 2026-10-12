/**
 * One-shot page classifier. Injected into the WebView before a resume so the
 * app injects the engine that matches the page the user is actually looking
 * at. In particular the Payment Methods page (and the provider page after
 * it) must route to the payment engine — they used to fall through to the
 * search script, so resuming from the payment step selected nothing.
 */
export function buildResumeProbeScript(seed: number): string {
  return (
    '(function(){' +
    'var SEED=' + seed + ';' +
    'function post(type,data){try{if(window.ReactNativeWebView&&window.ReactNativeWebView.postMessage){window.ReactNativeWebView.postMessage(JSON.stringify({type:type,t:Math.round(performance.now()),seed:SEED,data:data||{}}));}}catch(e){}}' +
    'function txt(){try{return (document.body?document.body.innerText:"")||"";}catch(e){return "";}}' +
    'function vis(el){try{var r=el.getBoundingClientRect();return r.width>0&&r.height>0;}catch(e){return false;}}' +
    'var tl=txt().toLowerCase();' +
    'var page="unknown";' +
    'if(/review journey/.test(tl)||tl.indexOf("your ticket will be sent to")!==-1){page="reviewJourney";}' +
    'else if(/payment methods/.test(tl)){page="paymethods";}' +
    'else if(/pay & book/.test(tl)){page="providers";}' +
    'else{' +
    'var inputs=document.querySelectorAll("input"),hits=0;' +
    'for(var i=0;i<inputs.length;i++){' +
    'if(!vis(inputs[i]))continue;' +
    'var ph=(inputs[i].getAttribute("placeholder")||"").toLowerCase();' +
    'if(/full name as per govt/.test(ph)){hits=2;break;}' +
    'var hay=(ph+" "+(inputs[i].getAttribute("aria-label")||"")+" "+(inputs[i].getAttribute("name")||"")).toLowerCase();' +
    'if(/name/.test(hay))hits++;' +
    '}' +
    'if(hits>=2)page="passenger";' +
    'else if(/book your ticket|search trains/.test(tl))page="search";' +
    '}' +
    'post("RESUME_PROBE_RESULT",{page:page});' +
    '})();'
  );
}

/**
 * Pages that the payment engine handles. It is resume-safe: steps already
 * past are skipped, so it can be injected on any of these.
 */
export function isPaymentEnginePage(page: string): boolean {
  return page === 'reviewJourney' || page === 'paymethods' || page === 'providers';
}
