(function(){
  function wait(ms){return new Promise(resolve=>setTimeout(resolve,ms));}

  function parseBody(text){
    if(!text)return {};
    try{return JSON.parse(text);}catch{return {};}
  }

  function clampPercent(value){
    return Math.max(0,Math.min(100,Number(value)||0));
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
    }
    if(ui.fill){
      ui.fill.style.width=`${clampPercent(state.progress)}%`;
    }
    if(ui.status&&state.message){
      ui.status.textContent=state.message;
    }
  }

  function createUploadUi(options){
    const ui={
      panel:options?.panel||null,
      status:options?.status||null,
      track:options?.track||null,
      fill:options?.fill||null,
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

  function sendFormData(url,body,{method="POST",headers={},credentials="same-origin",onProgress=()=>{}}={}){
    return new Promise((resolve,reject)=>{
      const xhr=new XMLHttpRequest();
      xhr.open(method,url,true);
      if(credentials==="include")xhr.withCredentials=true;
      Object.entries(headers).forEach(([key,value])=>{if(value!=null)xhr.setRequestHeader(key,String(value));});
      xhr.upload.onprogress=event=>{
        if(event.lengthComputable&&event.total>0)onProgress(event.loaded/event.total,event);
      };
      xhr.onerror=()=>reject(new Error("The upload connection stopped. Please try again."));
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

  window.HaloUploadProgress={createUploadUi,sendFormData,sendFormDataWithRetry,uploadChunkedFile};
})();
