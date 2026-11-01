'use strict';
const os=require('node:os');
const {spawnSync}=require('node:child_process');
const {installedCandidates,environment}=require('../runtime.cjs');
module.exports=function testPython(){
 const candidates=process.env.HANDOFF_TEST_PYTHON?[[process.env.HANDOFF_TEST_PYTHON]]:installedCandidates();
 for(const [executable,...prefix] of candidates){
  const result=spawnSync(executable,[...prefix,'-X','utf8','-E','-s','-B','-c','import sys;sys.exit(1) if sys.version_info < (3,11) else print(sys.executable)'],{encoding:'utf8',timeout:5000,env:environment(process.platform,process.env,os.tmpdir())});
  if(result.status===0 && result.stdout.trim())return result.stdout.trim();
 }
 return undefined;
};
