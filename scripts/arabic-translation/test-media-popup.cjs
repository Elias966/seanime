const{test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
test('packaged Electron blocks media-frame popups while preserving normal links',{skip:!process.env.SEANIME_ELECTRON_MAIN},()=>{
 const code=fs.readFileSync(process.env.SEANIME_ELECTRON_MAIN,'utf8');const start=code.indexOf('setWindowOpenHandler(({ frameName, url }) => {');assert.ok(start>=0);const end=code.indexOf('// // Allow other URLs',start);assert.ok(end>start);const snippet=code.slice(start+'setWindowOpenHandler('.length,end);let external=[];
 const main={url:'app://-/'},child={url:'https://player.example/embed/123'};let win={webContents:{mainFrame:main}};main.framesInSubtree=[main,child];
 const handler=new Function('win','electron_1','return '+snippet+'return {action:"deny"}}')(win,{shell:{openExternal:url=>external.push(url)}});
 assert.deepEqual(handler({url:'https://advert.example'}),{action:'deny'});assert.equal(external.length,0);
 main.framesInSubtree=[main];assert.deepEqual(handler({url:'https://seanime.app'}),{action:'deny'});assert.deepEqual(external,['https://seanime.app']);assert.deepEqual(handler({url:'about:blank'}),{action:'allow'});
});
