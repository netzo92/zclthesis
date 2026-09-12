import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';

const source=await readFile(new URL('../public/language.js',import.meta.url),'utf8');
function redirect(path,current,preference) {
  let result=null;
  const context={URL,location:{href:'https://zclthesis.com'+path,replace:url=>{result=url;}},document:{documentElement:{lang:current},querySelectorAll:()=>[]},localStorage:{getItem:()=>preference,setItem:()=>{}}};
  runInNewContext(source,context);
  return result;
}
test('language preference and explicit choices preserve the network page and hash',()=>{
  assert.equal(redirect('/network/#market','en','es'),'https://zclthesis.com/es/network/#market');
  assert.equal(redirect('/es/network/?lang=en#node','es','es'),'https://zclthesis.com/network/?lang=en#node');
  assert.equal(redirect('/network/index.html?lang=es','en',null),'https://zclthesis.com/es/network/?lang=es');
  assert.equal(redirect('/?lang=es#wallet','en',null),'https://zclthesis.com/es/?lang=es#wallet');
  assert.equal(redirect('/es/?lang=en#wallet','es','es'),'https://zclthesis.com/?lang=en#wallet');
  assert.equal(redirect('/network/?lang=en','en','es'),null);
});
