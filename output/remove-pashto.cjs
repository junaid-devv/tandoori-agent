const fs=require('fs'),path=require('path'),ts=require('typescript');
const files=[];function walk(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,e.name);if(e.isDirectory())walk(p);else if(p.endsWith('.ts'))files.push(p);}}walk('lib');
function known(n){if(ts.isParenthesizedExpression(n))return known(n.expression);if(ts.isIdentifier(n)&&n.text==='isPa')return false;if(ts.isCallExpression(n)&&n.expression.getText()==='pa')return false;if(ts.isBinaryExpression(n)){const op=n.operatorToken.kind;if([ts.SyntaxKind.EqualsEqualsEqualsToken,ts.SyntaxKind.EqualsEqualsToken].includes(op)&&[n.left,n.right].some(x=>ts.isStringLiteral(x)&&x.text==='pashto'))return false;const l=known(n.left),r=known(n.right);if(op===ts.SyntaxKind.BarBarToken){if(l===false&&r===false)return false;} }return undefined;}
for(const file of files){let source=fs.readFileSync(file,'utf8');if(!/pashto|pa\(l\)|isPa/.test(source))continue;
for(let pass=0;pass<8;pass++){const ast=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true);const edits=[];
function visit(n){if(ts.isVariableStatement(n)&&n.declarationList.declarations.length===1&&['pa','isPa'].includes(n.declarationList.declarations[0].name.getText(ast))){edits.push([n.getStart(ast),n.end,'']);return;}
if(ts.isPropertyAssignment(n)&&['pa','salam_pa','hello_pa'].includes(n.name.getText(ast))){let end=n.end;if(source[end]===',')end++;edits.push([n.getStart(ast),end,'']);return;}
if(ts.isIfStatement(n)&&known(n.expression)===false){edits.push([n.getStart(ast),n.end,n.elseStatement?n.elseStatement.getText(ast):'']);return;}
if(ts.isConditionalExpression(n)&&known(n.condition)===false){edits.push([n.getStart(ast),n.end,n.whenFalse.getText(ast)]);return;}
if(ts.isBinaryExpression(n)&&n.operatorToken.kind===ts.SyntaxKind.BarBarToken&&known(n.left)===false){edits.push([n.getStart(ast),n.end,n.right.getText(ast)]);return;}
ts.forEachChild(n,visit);}visit(ast);if(!edits.length)break;for(const [start,end,replace]of edits.sort((a,b)=>b[0]-a[0]))source=source.slice(0,start)+replace+source.slice(end);}
fs.writeFileSync(file,source);}
