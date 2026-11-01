'use strict';
const fs = require('node:fs');
const path = require('node:path');
function candidates(platform=process.platform) {
  return platform === 'win32' ? [['py','-3.11'],['py','-3'],['python'],['python3']] : ['/opt/homebrew/bin/python3','/usr/local/bin/python3','/usr/bin/python3'].filter(file=>fs.existsSync(file)).map(file=>[file]);
}
function environment(platform=process.platform, source=process.env, temp) {
  if (platform !== 'win32') return {PATH:'/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin',LANG:'en_US.UTF-8',TMPDIR:temp};
  // Windows loader, installed Python launcher and system temp only. No provider credentials.
  const result={PYTHONUTF8:'1',PYTHON_MANAGER_AUTOMATIC_INSTALL:'false',TEMP:temp,TMP:temp};
  for(const key of ['SystemRoot','WINDIR','PATH','PATHEXT','LOCALAPPDATA']) {
    const actual=Object.keys(source).find(item=>item.toLowerCase()===key.toLowerCase());
    if(actual)result[key]=source[actual];
  }
  return result;
}
function resolveWindowsCandidate(candidate,search,exists=fs.existsSync) {
  const paths=search.split(';').filter(folder=>path.win32.isAbsolute(folder)).map(folder=>path.win32.join(folder,candidate+'.exe'));
  return paths.find(file=>exists(file) && !(candidate.startsWith('python') && /[\\/]Microsoft[\\/]WindowsApps[\\/]/i.test(file)));
}
function installedCandidates(platform=process.platform) {
  return candidates(platform).flatMap(([candidate,...prefix])=>{
    if(platform!=='win32' || process.platform!=='win32')return [[candidate,...prefix]];
    const executable=resolveWindowsCandidate(candidate,process.env.PATH || process.env.Path || '');
    return executable?[[executable,...prefix]]:[];
  });
}
async function discoverPython(engine,capture,platform=process.platform) {
  const probe='import json,os,sys;sys.path.insert(0,os.path.dirname(sys.argv[1]));import handoff;print(json.dumps({"version":list(sys.version_info[:3]),"safe":handoff.safe_io_available(),"executable":sys.executable,"backend":"windows" if os.name=="nt" else "posix"}))';
  for(const [executable,...prefix] of installedCandidates(platform)) {
    try {
      const data=JSON.parse(await capture(executable,[...prefix,'-X','utf8','-E','-s','-B','-c',probe,engine],{outputLimit:8192,timeoutMs:5000}));
      if(data.safe===true && Array.isArray(data.version) && data.version.length===3 && data.version.every(Number.isInteger) && data.version[0]===3 && data.version[1]>=11 && typeof data.executable==='string' && (platform==='win32'?/^[a-z]:[\\/]/i.test(data.executable):data.executable.startsWith('/')) && data.backend===(platform==='win32'?'windows':'posix')) return {executable:data.executable,version:data.version.join('.')};
    } catch { /* A Store alias, missing launcher, old interpreter or unsupported backend is not readiness. */ }
  }
  return null;
}
module.exports={candidates,installedCandidates,resolveWindowsCandidate,environment,discoverPython};
