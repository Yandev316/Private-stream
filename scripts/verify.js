const fs = require('fs');
const path = require('path');

function walk(dir){
  const res = [];
  for (const name of fs.readdirSync(dir)){
    const p = path.join(dir,name);
    const st = fs.statSync(p);
    if (st.isDirectory()) res.push(...walk(p));
    else res.push(p);
  }
  return res;
}

function checkJSON(file, contents){
  try{
    JSON.parse(contents);
    // check trailing comma patterns: ,\s*}\s*$ or ,\s*]\s*$ inside
    const trailing = /,\s*[}\]]/m.test(contents);
    return { ok: true, trailingComma: trailing };
  }catch(e){
    return { ok: false, error: e.message };
  }
}

function balanceCheck(contents){
  const counts = { '{':0, '}':0, '(':0, ')':0, '[':0, ']':0 };
  for (const ch of contents){
    if (ch in counts) counts[ch]++;
  }
  return {
    curly: counts['{'] - counts['}'],
    paren: counts['('] - counts[')'],
    bracket: counts['['] - counts[']']
  };
}

function main(){
  const root = process.cwd();
  const files = walk(root).filter(f=>{
    const rel = path.relative(root,f);
    if (rel.startsWith('node_modules') || rel.startsWith('.git')) return false;
    return true;
  });

  const jsonFiles = files.filter(f=>f.endsWith('.json'));
  const jsFiles = files.filter(f=>f.endsWith('.js'));

  let ok = true;
  console.log('Checking JSON files...');
  for (const f of jsonFiles){
    const c = fs.readFileSync(f,'utf8');
    const r = checkJSON(f,c);
    if (!r.ok){
      ok = false;
      console.error('JSON PARSE ERROR:', f, r.error);
    } else if (r.trailingComma){
      console.warn('JSON warning (possible trailing comma):', f);
    } else {
      console.log('OK:', f);
    }
  }

  console.log('\nChecking JS files for simple balance issues...');
  for (const f of jsFiles){
    const c = fs.readFileSync(f,'utf8');
    const b = balanceCheck(c);
    const problems = [];
    if (b.curly !== 0) problems.push('curly:'+b.curly);
    if (b.paren !== 0) problems.push('paren:'+b.paren);
    if (b.bracket !== 0) problems.push('bracket:'+b.bracket);
    if (problems.length){
      ok = false;
      console.error('POSSIBLE BALANCE ISSUE in', f, problems.join(', '));
    } else {
      console.log('OK:', f);
    }
  }

  if (!ok){
    console.error('\nVerification found issues. Fix them and re-run.');
    process.exit(1);
  }
  console.log('\nAll checks passed.');
}

main();
