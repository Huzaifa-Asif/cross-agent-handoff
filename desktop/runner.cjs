'use strict';
const {spawn} = require('node:child_process');
const {StringDecoder} = require('node:string_decoder');
const {sanitizeProgress} = require('./progress.cjs');
function startProcess(executable, args, options={}) {
  const process = spawn(executable,args,{shell:false,env:options.env,cwd:options.cwd,stdio:['ignore','pipe','pipe'],windowsHide:true});
  let cancelled=false, forced=false, closed=false, oversized=false, output='',diagnostics='',lineBuffer='';
  let outputBytes=0,lastProgressAt=0,killTimer=null,readyForPause=!options.allowPause,termSent=false,terminalSeen=false;
  const sendTerm=()=>{if(!closed && !termSent && !terminalSeen){termSent=true;process.kill('SIGTERM');}};
  const decoder={out:new StringDecoder('utf8'),err:new StringDecoder('utf8')};
  const outputLimit=options.outputLimit || 20*1024*1024;
  const finishLine=line=>{
    let event=null;
    if(line.length<=4096){try{event=sanitizeProgress(JSON.parse(line));}catch{/* Non-progress diagnostics are bounded below. */}}
    if(event){
      if (['complete','complete-with-omissions','complete-with-notices','planned','paused','error'].includes(event.phase)) terminalSeen=true;
      else readyForPause=true;
      if(cancelled && readyForPause) sendTerm();
      const now=Date.now();
      if(now-lastProgressAt>=100 || ['complete','complete-with-omissions','complete-with-notices','planned','paused','error'].includes(event.phase)) {
        lastProgressAt=now; options.onProgress?.(event);
      }
    } else if(diagnostics.length<65536) diagnostics+=(line+'\n').slice(0,65536-diagnostics.length);
  };
  const consumeError=text=>{
    lineBuffer+=text;
    let newline;
    while((newline=lineBuffer.indexOf('\n'))!==-1){finishLine(lineBuffer.slice(0,newline));lineBuffer=lineBuffer.slice(newline+1);}
    if(lineBuffer.length>16384){if(diagnostics.length<65536) diagnostics+=lineBuffer.slice(0,65536-diagnostics.length);lineBuffer='';}
  };
  const cancel=()=>{
    if(closed || cancelled)return;
    cancelled=true;if(readyForPause)sendTerm();
    killTimer=setTimeout(()=>{if(!closed){forced=true;process.kill('SIGKILL');}},options.killGraceMs ?? 5000);
    killTimer.unref();
  };
  const timeout=options.timeoutMs?setTimeout(cancel,options.timeoutMs):null;
  const cleanup=()=>{closed=true;if(timeout)clearTimeout(timeout);if(killTimer)clearTimeout(killTimer);};
  const promise=new Promise((resolve,reject)=>{
    process.stdout.on('data',data=>{
      outputBytes+=data.length;
      if(outputBytes>outputLimit){oversized=true;cancel();return;}
      output+=decoder.out.write(data);
    });
    process.stderr.on('data',data=>consumeError(decoder.err.write(data)));
    process.on('error',()=>{cleanup();reject(new Error('Could not start the installed local runtime.'));});
    process.on('close',code=>{
      cleanup();output+=decoder.out.end();consumeError(decoder.err.end());if(lineBuffer)finishLine(lineBuffer);
      if(oversized)return reject(new Error('Result exceeds the desktop display limit. Use the CLI to inspect this bounded export.'));
      if(code===0)return resolve(output);
      if(options.allowPause && code===130){
        try{
          const result=JSON.parse(output);
          if(result.paused===true && (typeof result.checkpoint==='string' && /^[a-f0-9]{64}$/.test(result.checkpoint) || result.planning_cancelled===true && result.checkpoint===null && result.workspace_may_be_incomplete===true))return resolve(output);
        }catch{/* A non-checkpoint interruption requires inspection rather than assuming recovery. */}
      }
      if(cancelled && !options.allowPause)return reject(new Error('Stopped. Check whether the output was created before retrying; existing files are never overwritten.'));
      if(cancelled)return reject(new Error(forced?'The process did not pause within five seconds and was stopped. Resume library to verify the latest completed checkpoint; an interrupted initial snapshot may need a fresh destination.':'Stopped. Resume library to verify the latest completed checkpoint; an interrupted initial snapshot may need a fresh destination.'));
      reject(new Error(diagnostics.trim().slice(0,3000)||'The local engine rejected this operation.'));
    });
  });
  return {process,promise,cancel};
}
module.exports={startProcess};
