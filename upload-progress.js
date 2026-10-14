(function(){
  function wait(ms){return new Promise(resolve=>setTimeout(resolve,ms));}

  function parseBody(text){
    if(!text)return {};
    try{return JSON.parse(text);}catch{return {};}
  }

  function clampPercent(value){
    return Math.max(0,Math.min(100,Number(value)||0));
  }

  function requireElement(name,element){
    if(element)return element;
    console.warn(`[HaloUploadProgress] Missing UI element: ${name}`);
    return null;
  }

  function updateUi(ui,state){
    if(!ui)return;
    if(ui.panel){
      ui.panel.classList.toggle(ui.busyClass,state.uploading);
      ui.panel.setAttribute("aria-busy",state.uploading?"true":"false");
      ui.panel.dataset.uploadState=state.error?"error":state.success?"success":state.uploading?"uploading":"idle";
    }
    if(ui.track){
      ui.track.hidden=!state.showTrack;
      ui.track.setAttribute("aria-hidden",state.showTrack?"false":"true");
    }
    if(ui.fill){
      const progress=clampPercent(state.progress);
      const visualProgress=state.uploading&&progress===0?3:progress;
      ui.fill.style.width=`${visualProgress}%`;
    }
    if(ui.status&&state.message){
      ui.status.textContent=state.message;
    }
  }

  function createUploadUi(options){
    const ui={
      panel:requireElement("panel",options?.panel||null),
      status:requireElement("status",options?.status||null),
      track:requireElement("track",options?.track||null),
      fill:requireElement("fill",options?.fill||null),
      busyClass:options?.busyClass||"is-uploading"
    };
    const idleMessage=options?.idleMessage||"";
    const api={
      state:{uploading:false,progress:0,error:"",success:"",message:idleMessage,showTrack:Boolean(options?.showTrackWhenIdle)},
      set(next){
        api.state={...api.state,...next};
        updateUi(ui,api.state);
      },
      start(message="Preparing upload…"){
        api.set({uploading:true,progress:0,error:"",success:"",message,showTrack:true});
      },
      progress(percent,message=api.state.message){
        api.set({uploading:true,progress:percent,error:"",success:"",message,showTrack:true});
      },
      success(message,keepTrackVisible=false){
        api.set({uploading:false,progress:100,error:"",success:message||"",message:message||api.state.message,showTrack:keepTrackVisible});
      },
      fail(message){
        api.set({uploading:false,error:message||"Upload failed",success:"",message:message||"Upload failed",showTrack:true});
      },
      idle(message=idleMessage){
        api.set({uploading:false,progress:0,error:"",success:"",message,showTrack:Boolean(options?.showTrackWhenIdle)});
      }
    };
    updateUi(ui,api.state);
    return api;
  }

  function sendFormData(url,body,{method="POST",headers={},credentials="same-origin",onProgress=()=>{},timeoutMs=120000}={}){
    return new Promise((resolve,reject)=>{
      const xhr=new XMLHttpRequest();
      xhr.open(method,url,true);
      xhr.timeout=timeoutMs;
      if(credentials==="include")xhr.withCredentials=true;
      if(credentials==="omit")xhr.withCredentials=false;
      Object.entries(headers).forEach(([key,value])=>{if(value!=null)xhr.setRequestHeader(key,String(value));});
      xhr.upload.onprogress=event=>{
        if(event.lengthComputable&&event.total>0)onProgress(event.loaded/event.total,event);
      };
      xhr.onerror=()=>reject(new Error("The upload connection stopped. Please try again."));
      xhr.ontimeout=()=>reject(new Error("The upload took too long to finish. Please try again."));
      xhr.onload=()=>{
        const data=parseBody(xhr.responseText);
        resolve({ok:xhr.status>=200&&xhr.status<300,status:xhr.status,data});
      };
      xhr.send(body);
    });
  }

  async function sendFormDataWithRetry(url,body,{retryDelays=[],...options}={}){
    let lastError;
    for(let attempt=0;attempt<=retryDelays.length;attempt+=1){
      try{
        return await sendFormData(url,body,options);
      }catch(error){
        lastError=error;
        if(attempt<retryDelays.length)await wait(retryDelays[attempt]);
      }
    }
    throw lastError||new Error("The upload connection stopped. Please try again.");
  }

  async function uploadChunkedFile({url,file,chunkSize,buildBody,retryDelays=[],onProgress=()=>{},requestOptions={}}){
    const chunkCount=Math.ceil(file.size/chunkSize);
    for(let chunkIndex=0;chunkIndex<chunkCount;chunkIndex+=1){
      const start=chunkIndex*chunkSize;
      const end=Math.min(file.size,start+chunkSize);
      const body=buildBody({chunkIndex,chunkCount,start,end});
      const response=await sendFormDataWithRetry(url,body,{
        ...requestOptions,
        retryDelays,
        onProgress(ratio){
          const overall=((chunkIndex+ratio)/chunkCount)*100;
          onProgress(clampPercent(overall),{chunkIndex,chunkCount});
        }
      });
      if(!response.ok)throw new Error(response.data?.message||"The upload stopped early.");
      onProgress(clampPercent(((chunkIndex+1)/chunkCount)*100),{chunkIndex,chunkCount});
    }
    return {chunkCount};
  }

  // Web Crypto has no streaming digest. Hash bounded slices with SHA-256 rather
  // than retaining a second, potentially 128 MB, copy of the whole file.
  const sha256Constants=new Uint32Array([
    0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
    0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
    0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
    0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
    0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
    0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
    0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
    0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2
  ]);
  const hex=bytes=>Array.from(bytes,byte=>byte.toString(16).padStart(2,"0")).join("");
  async function fileSha256(file){
    const state=new Uint32Array([0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19]);
    const words=new Uint32Array(64);
    const rotate=(value,bits)=>(value>>>bits)|(value<<(32-bits));
    function blocks(bytes){
      const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
      for(let offset=0;offset<bytes.length;offset+=64){
        for(let i=0;i<16;i++)words[i]=view.getUint32(offset+i*4);
        for(let i=16;i<64;i++){
          const x=words[i-15],y=words[i-2];
          words[i]=words[i-16]+(rotate(x,7)^rotate(x,18)^(x>>>3))+words[i-7]+(rotate(y,17)^rotate(y,19)^(y>>>10));
        }
        let [a,b,c,d,e,f,g,h]=state;
        for(let i=0;i<64;i++){
          const first=(h+(rotate(e,6)^rotate(e,11)^rotate(e,25))+((e&f)^(~e&g))+sha256Constants[i]+words[i])|0;
          const second=((rotate(a,2)^rotate(a,13)^rotate(a,22))+((a&b)^(a&c)^(b&c)))|0;
          h=g;g=f;f=e;e=(d+first)|0;d=c;c=b;b=a;a=(first+second)|0;
        }
        [a,b,c,d,e,f,g,h].forEach((value,i)=>{state[i]+=value;});
      }
    }
    const readSize=1024*1024;
    const alignedSize=file.size-file.size%64;
    for(let start=0;start<alignedSize;start+=readSize){
      blocks(new Uint8Array(await file.slice(start,Math.min(alignedSize,start+readSize)).arrayBuffer()));
    }
    const tail=new Uint8Array(file.size-alignedSize<56?64:128);
    tail.set(new Uint8Array(await file.slice(alignedSize).arrayBuffer()));
    tail[file.size-alignedSize]=0x80;
    const view=new DataView(tail.buffer),bits=file.size*8;
    view.setUint32(tail.length-8,Math.floor(bits/4294967296));
    view.setUint32(tail.length-4,bits>>>0);
    blocks(tail);
    return Array.from(state,value=>value.toString(16).padStart(8,"0")).join("");
  }

  async function fileUploadId(file,scope,chunkSize=4*1024*1024){
    const digest=await fileSha256(file);
    return hex(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(JSON.stringify([scope,file.size,chunkSize,digest])))));
  }

  async function uploadResumableAudio({
    url="/api/song-catalog/audio",file,songId,versionId,contentType=file?.type,
    durationSeconds=0,chunkSize=4*1024*1024,onProgress=()=>{},requestOptions={},maxRetries=3
  }){
    if(!file)throw new Error("Reselect the same audio file to resume after a page reload.");
    if(!Number.isSafeInteger(file.size)||file.size<1||file.size>128*1024*1024||
      !Number.isSafeInteger(chunkSize)||chunkSize<1||chunkSize>4*1024*1024||Math.ceil(file.size/chunkSize)>32||
      !songId||!versionId)throw new Error("The audio file or upload target is invalid.");
    const retryLimit=Math.min(8,Math.max(0,Number.isSafeInteger(maxRetries)?maxRetries:3));
    const chunkCount=Math.ceil(file.size/chunkSize);
    const uploadId=await fileUploadId(file,[url,songId,versionId,contentType],chunkSize);
    const details={songId,versionId,uploadId,chunkCount,chunkSize,byteSize:file.size,filename:file.name,contentType};
    const cacheKey=`halo-audio-resume:${uploadId}`;
    function cache(status){
      try{
        if(status.finalized)window.localStorage.removeItem(cacheKey);
        else window.localStorage.setItem(cacheKey,JSON.stringify({...details,confirmedBytes:status.confirmedBytes||0,reselectRequired:true}));
      }catch{}
    }
    const retryable=status=>status===408||status===429||(status>=500&&status<600);
    const pause=attempt=>wait(Math.min(10000,500*2**attempt)*(0.75+Math.random()*0.5));
    async function request(body){
      let response;
      try{
        response=await fetch(url,{
          method:"POST",credentials:requestOptions.credentials||"same-origin",
          headers:body instanceof FormData?{...requestOptions.headers}:{"Content-Type":"application/json",...requestOptions.headers},
          body:body instanceof FormData?body:JSON.stringify(body)
        });
      }catch(error){
        throw Object.assign(new Error("The upload connection stopped. Reselect the same file to resume."),{retryable:error.name==="TypeError"||error.name==="NetworkError",cause:error});
      }
      let data;
      try{data=await response.json();}catch(error){
        if(!response.ok)throw Object.assign(new Error(`Audio upload failed (HTTP ${response.status}).`),{status:response.status,retryable:retryable(response.status)});
        throw Object.assign(new Error("The audio response could not be read. Reselect the same file to resume."),{retryable:error.name==="TypeError",ambiguous:true,cause:error});
      }
      if(!response.ok)throw Object.assign(new Error(data.message||`Audio upload failed (HTTP ${response.status}).`),{status:response.status,retryable:retryable(response.status)});
      return data;
    }
    async function getStatus(){
      for(let attempt=0;;attempt++){
        try{
          const status=await request({action:"upload_status",...details});
          if(typeof status.finalized!=="boolean"||!Array.isArray(status.receivedChunks)||!status.chunkChecksums||
            status.receivedChunks.some(index=>!Number.isSafeInteger(index)||index<0||index>=chunkCount)||
            !Number.isSafeInteger(status.confirmedBytes)||status.confirmedBytes<0||status.confirmedBytes>file.size)
            throw new Error("The server returned an invalid upload status. No audio was sent.");
          cache(status);
          onProgress(clampPercent((status.confirmedBytes||0)/file.size*100),{...status,uploadId,chunkCount});
          return status;
        }catch(error){
          if(!error.retryable||attempt>=retryLimit)throw error;
          await pause(attempt);
        }
      }
    }
    const checksums={};
    function matches(status,index){
      if(!status.receivedChunks.includes(index))return false;
      if(status.chunkChecksums[index]!==checksums[index])
        throw new Error("Saved audio conflicts with the selected file. Choose the original file or a new version.");
      return true;
    }
    const result=(status,alreadyFinalized=true)=>{
      if(status.persisted!==true||status.lockedIn!==true||!status.audioUrl)
        throw new Error("The server did not confirm audio persistence. Reselect the same file to resume.");
      cache({finalized:true});
      onProgress(100,{...status,uploadId,chunkCount,finalized:true});
      return {...status,...details,alreadyFinalized};
    };
    cache({confirmedBytes:0});
    for(let chunkIndex=0;chunkIndex<chunkCount;chunkIndex++){
      const chunk=file.slice(chunkIndex*chunkSize,Math.min(file.size,(chunkIndex+1)*chunkSize),contentType);
      checksums[chunkIndex]=hex(new Uint8Array(await crypto.subtle.digest("SHA-256",await chunk.arrayBuffer())));
      for(let attempt=0;;attempt++){
        const status=await getStatus();
        if(status.finalized)return result(status);
        if(matches(status,chunkIndex))break;
        const form=new FormData();
        Object.entries({...details,chunkIndex,offset:chunkIndex*chunkSize,chunkSha256:checksums[chunkIndex]}).forEach(([key,value])=>form.append(key,String(value)));
        form.append("chunk",chunk,file.name);
        try{
          await request(form);
        }catch(error){
          if(!error.retryable&&!error.ambiguous)throw error;
          const reconciled=await getStatus();
          if(reconciled.finalized)return result(reconciled);
          if(matches(reconciled,chunkIndex))break;
          if(!error.retryable||attempt>=retryLimit)throw error;
          await pause(attempt);
          continue;
        }
        const confirmed=await getStatus();
        if(confirmed.finalized)return result(confirmed);
        if(!matches(confirmed,chunkIndex))throw new Error("The server did not confirm this audio chunk. Reselect the same file to resume.");
        break;
      }
    }
    for(let attempt=0;;attempt++){
      const status=await getStatus();
      if(status.finalized)return result(status);
      for(let index=0;index<chunkCount;index++){
        if(!matches(status,index))throw new Error("The audio upload is incomplete. Reselect the same file to resume.");
      }
      try{
        const finalized=await request({action:"finalize_upload",...details,durationSeconds});
        return result(finalized,Boolean(finalized.alreadyFinalized));
      }catch(error){
        if(!error.retryable&&!error.ambiguous)throw error;
        const reconciled=await getStatus();
        if(reconciled.finalized)return result(reconciled);
        if(!error.retryable||attempt>=retryLimit)throw error;
        await pause(attempt);
      }
    }
  }

  window.HaloUploadProgress={createUploadUi,sendFormData,sendFormDataWithRetry,uploadChunkedFile,fileSha256,fileUploadId,uploadResumableAudio};
})();
