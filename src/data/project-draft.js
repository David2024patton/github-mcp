// P-3 project setup: a draft is policy DATA, not activation or evidence that
// GitHub/provider settings have been verified. Never invent a source SHA.
import {validateProjectProfile} from './profile-schema.js';

const slug=/^[a-z0-9-]{1,39}\/[a-z0-9._-]{1,100}$/;
const idPattern=/^[a-z][a-z0-9-]{2,63}$/;
const workName=/^(?:\.github\/workflows\/)?[A-Za-z0-9._-]+\.ya?ml$/;
const sha=/^[a-f0-9]{40}$/;
const label=(value,max,what)=>{
  if(typeof value!=='string'||!value.trim()||value.length>max)
    throw new TypeError(what+' must be nonempty text (max '+max+').');
  return value.trim();
};
const entries=(value,max,what,pattern)=>{
  if(!Array.isArray(value)||value.length>max||
    value.some(x=>typeof x!=='string'||!pattern.test(x))||
    new Set(value.map(x=>x.toLowerCase())).size!==value.length)
    throw new TypeError(what+' must be a bounded distinct list.');
  return value;
};
const ref=/^[a-zA-Z0-9._/-]{1,100}$/;
const allowedFindings=new Set(['workflows','ownedRefs','workBranches','defaultBranch',
  'sourceSha','deployments','branchNames','providerApps','notes']);
const allowedInput=new Set(['id','name','owner','repo','description','visibility',
  'requiredChecks','productionBranch','environments','findings']);
const clean=(raw,allow,which)=>{
  if(!raw||typeof raw!=='object'||Array.isArray(raw))
    throw new TypeError(which+' must be an object.');
  const extra=Object.keys(raw).filter(k=>!allow.has(k));
  if(extra.length)throw new TypeError('Unknown '+which+' fields: '+extra.join(', ')+
    '. No value was guessed or silently accepted.');
  return raw;
};
const scrub=s=>String(s).replace(/[\u0000-\u001f\u007f<>|]/g,' ').slice(0,800);
export const STANDARD_PROJECT_LABELS=Object.freeze([
  {name:'bug',color:'d73a4a',description:'Something is not working'},
  {name:'enhancement',color:'a2eeef',description:'New or improved behavior'},
  {name:'documentation',color:'0075ca',description:'Documentation changes'},
  {name:'blocked',color:'b60205',description:'A dependency prevents progress'}
]);

/** Input is a description, never a repository content fetch. */
export function composeProjectDraft(input,now=Date.now()){
  const a=clean(input,allowedInput,'project specification');
  const f=clean(a.findings??{},allowedFindings,'findings');
  const owner=label(a.owner,39,'owner').toLowerCase();
  const repo=label(a.repo,100,'repo').toLowerCase();
  const full=owner+'/'+repo;
  if(!slug.test(full))throw new TypeError('Specify one valid owner/repository slug.');
  const id=label(a.id,64,'project id').toLowerCase();
  if(!idPattern.test(id))throw new TypeError('Project id must be lowercase with hyphens.');
  const name=label(a.name,100,'project name');
  const description=label(a.description,500,'project description');
  if(!['public','private'].includes(a.visibility))
    throw new TypeError('Visibility must be explicitly public or private.');
  const requiredChecks=entries(a.requiredChecks,15,'requiredChecks',ref);
  if(!requiredChecks.length)
    throw new TypeError('At least one required check is needed; do not invent ci.');
  const environments=entries(a.environments??[],15,'environments',ref);
  const productionBranch=a.productionBranch??null;
  if(productionBranch!==null&&!ref.test(productionBranch))
    throw new TypeError('Production branch is not valid.');
  const defaultBranch=f.defaultBranch??'main';
  if(!ref.test(defaultBranch))throw new TypeError('Invalid findings.defaultBranch.');
  const workBranches=entries(f.workBranches??['ai/**'],10,'workBranches',/^[A-Za-z0-9_./*?-]{1,120}$/);
  const workflows=f.workflows??[];
  if(!Array.isArray(workflows)||workflows.length>30)
    throw new TypeError('Findings workflows require a bounded list.');
  for(const w of workflows){
    if(!w||!workName.test(w.file??'')||
      typeof w.maxPermissions!=='object'||!w.maxPermissions||
      Object.entries(w.maxPermissions).some(([k,v])=>
        !/^[a-z_]{2,40}$/.test(k)||!['read','write','none'].includes(v)))
      throw new TypeError('Workflow findings require a file and explicit permission levels.');
  }
  const ownedRefs=f.ownedRefs??[];
  if(!Array.isArray(ownedRefs)||ownedRefs.length>20)
    throw new TypeError('Findings ownedRefs must be a bounded list.');
  const apps=entries(f.providerApps??[],15,'providerApps',/^[A-Za-z0-9._ -]{2,60}$/);
  const sourceSha=f.sourceSha??null;
  if(sourceSha!==null&&!sha.test(sourceSha))
    throw new TypeError('Source SHA must be a verified 40-hex hash, or null if no branch exists.');
  const date=new Date(now).toISOString().slice(0,10);
  const profile=validateProjectProfile({
    schemaVersion:1,id,name,status:'draft',
    source:{repository:full,verifiedMainSha:sourceSha,checkedOn:date,
      documentation:'docs/APP-NEEDS-'+id.toUpperCase()+'.md'},
    repos:[full],productionBranches:productionBranch?[productionBranch]:[],
    productionEnvironments:environments,ownedRefs,
    branchPatterns:{default:defaultBranch,work:workBranches,preview:[],transfer:[]},
    requiredChecks,mergeMethod:'merge',workflows,
    repoSettings:{visibility:a.visibility,allow_merge_commit:true},
    security:{secretScanning:true,pushProtection:true},
    actionsSettings:{defaultWorkflowPermissions:'read',forkPrApproval:'all'},
    apps,collaborators:'review-required',readiness:[],
    notes:('DRAFT; desired policy is not provider proof. '+description+
      (f.notes?' Owner findings: '+label(f.notes,650,'findings notes'):'')).slice(0,1900)
  });
  const review=[
    ...(sourceSha===null?['Confirm default branch and source SHA after initialization.']:[]),
    ...(!workflows.length?['Inspect CI/workflow trigger, scopes, secrets, and permissions.']:[]),
    ...(productionBranch&&!ownedRefs.some(r=>r.pattern===productionBranch)?
      ['Decide who owns the production branch before activating this profile.']:[]),
    'Verify repository/App access, cost eligibility and production policy before activating the draft.'
  ];
  const doc=[
    '# APP-NEEDS-'+id.toUpperCase()+' — draft project setup',
    '',
    'Status: DRAFT — owner review required; this is not proof of deployed/provider settings.',
    '',
    '| Item | Desired or reported value |',
    '|---|---|',
    '| Repository | '+scrub(full)+' |',
    '| Description | '+scrub(description)+' |',
    '| Visibility | '+a.visibility+' |',
    '| Default branch | '+scrub(defaultBranch)+' (not independently verified) |',
    '| Required checks | '+requiredChecks.map(scrub).join(', ')+' |',
    '| Production branch | '+scrub(productionBranch??'none specified')+' |',
    '| Environments | '+scrub(environments.join(', ')||'none')+' |',
    '| Work branches | '+workBranches.map(scrub).join(', ')+' |',
    '| Provider apps | '+apps.map(scrub).join(', ')||'not verified |',
    '',
    '## Workflow evidence to verify',
    ...workflows.map(w=>'- '+scrub(w.file)+': '+Object.entries(w.maxPermissions)
      .map(([k,v])=>scrub(k+': '+v)).join(', ')),
    ...(!workflows.length?['- No workflow source supplied; must inspect the actual repository.']:[]),
    '',
    '## Owner decisions and remaining evidence',
    ...review.map(x=>'- [ ] '+scrub(x)),
    '',
    'Do not commit this draft or modify any workflow/ref automatically.'
  ].join('\n');
  return {profile,doc,review,repository:full};
}
