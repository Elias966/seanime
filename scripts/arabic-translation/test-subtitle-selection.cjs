const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const mod={exports:{}};new Function('module',fs.readFileSync(__dirname+'/../../seanime-web/public/subtitle-translation-queue.js','utf8'))(mod);
const {preferDialogueTracks}=mod.exports;
const tracks=[{number:4,label:'S&S',language:'eng',forced:true,default:false},{number:5,label:'Dialog - ENG',language:'eng',forced:false,default:true}];
test('dual-audio signs/forced track yields to the full dialogue track',()=>assert.deepEqual(preferDialogueTracks(tracks).map(t=>t.number),[5]));
test('sign-only labels without forced flag also yield, while full dialogue with signs remains',()=>{
 assert.deepEqual(preferDialogueTracks([{number:1,language:'eng',label:'Signs and Songs'},{number:2,language:'eng',label:'Full Dialogue + Signs'}]).map(t=>t.number),[2]);
});
test('single tracks and partial-only languages remain available',()=>{
 assert.deepEqual(preferDialogueTracks(tracks.slice(0,1)),tracks.slice(0,1));
 const ar={number:6,label:'Signs',language:'ara',forced:true};assert.deepEqual(preferDialogueTracks([...tracks,ar]).map(t=>t.number),[5,6]);
});
test('actual compiled selector fixes Parasyte defaults, preserves manual/off translation and none/blacklist preferences',{skip:!process.env.SEANIME_PLAYER_BUNDLE},()=>{
 const raw=fs.readFileSync(process.env.SEANIME_PLAYER_BUNDLE,'utf8'),start=raw.indexOf('function tF('),end=raw.indexOf('var tO=',start);
 assert.ok(start>=0&&end>start);const ctx={window:{SeanimePreferDialogueSubtitleTracks:preferDialogueTracks},D:{B:(track,lang)=>track.language===lang}};vm.createContext(ctx);
 const select=vm.runInContext('('+raw.slice(start,end)+')',ctx),settings={preferredSubtitleLanguage:'eng',preferredSubtitleBlacklist:''};
 assert.equal(select(settings,tracks),4);assert.equal(select(settings,tracks,true),5);
 assert.equal(select({...settings,preferredSubtitleLanguage:'none'},tracks,true),-1);
 assert.equal(select({...settings,preferredSubtitleBlacklist:'Dialog'},tracks,true),4);
 // Language preference beats unrelated full tracks.
 assert.equal(select({...settings,preferredSubtitleLanguage:'ara'},[...tracks,{number:6,language:'ara',label:'Forced',forced:true}],true),6);
 assert.ok(raw.includes('tF(this.settings,e,!!this.shouldTranslate)'));
});
