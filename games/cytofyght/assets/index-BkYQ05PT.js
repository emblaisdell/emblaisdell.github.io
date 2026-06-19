(function(){const e=document.createElement("link").relList;if(e&&e.supports&&e.supports("modulepreload"))return;for(const a of document.querySelectorAll('link[rel="modulepreload"]'))i(a);new MutationObserver(a=>{for(const h of a)if(h.type==="childList")for(const d of h.addedNodes)d.tagName==="LINK"&&d.rel==="modulepreload"&&i(d)}).observe(document,{childList:!0,subtree:!0});function n(a){const h={};return a.integrity&&(h.integrity=a.integrity),a.referrerPolicy&&(h.referrerPolicy=a.referrerPolicy),a.crossOrigin==="use-credentials"?h.credentials="include":a.crossOrigin==="anonymous"?h.credentials="omit":h.credentials="same-origin",h}function i(a){if(a.ep)return;a.ep=!0;const h=n(a);fetch(a.href,h)}})();const _=4096,Z={INSTR_COST:1,CHECK_COST:2,SIGNAL_COST:12,MOVE_COST:50,ATTACK_COST:50,INCOME_PER_TURN:100,BATTERY_MAX:400,START_HP:10,ATTACK_DAMAGE:1,MAX_CYCLES_PER_TURN:600,MAX_TURNS:4e3},se={read:()=>0,write:()=>{}},ie=["zero","ra","sp","gp","tp","t0","t1","t2","s0","s1","a0","a1","a2","a3","a4","a5","a6","a7","s2","s3","s4","s5","s6","s7","s8","s9","s10","s11","t3","t4","t5","t6"];class v extends Error{}class re{constructor(e,n=se){this.regs=new Int32Array(32),this.pc=0,this.ram=e??new Uint8Array(_),this.view=new DataView(this.ram.buffer,this.ram.byteOffset,this.ram.byteLength),this.bus=n}loadProgram(e,n=0){this.ram.set(e,n)}rd(e){return this.regs[e]}wr(e,n){e!==0&&(this.regs[e]=n|0)}memLoad(e,n,i){if(e=e>>>0,e>=_)return this.bus.read(e)|0;if(e+n>_)throw new v(`load out of bounds @${e}`);switch(n){case 1:return i?this.view.getInt8(e):this.view.getUint8(e);case 2:return i?this.view.getInt16(e,!0):this.view.getUint16(e,!0);case 4:return this.view.getInt32(e,!0)}}memStore(e,n,i){if(e=e>>>0,e>=_){this.bus.write(e,n|0);return}if(e+i>_)throw new v(`store out of bounds @${e}`);switch(i){case 1:this.view.setUint8(e,n&255);break;case 2:this.view.setUint16(e,n&65535,!0);break;case 4:this.view.setInt32(e,n|0,!0);break}}step(){const e=this.pc>>>0;if(e+4>_)throw new v(`pc out of range @${e}`);const n=this.view.getUint32(e,!0);let i=e+4;const a=n&127,h=n>>>7&31,d=n>>>12&7,f=n>>>15&31,y=n>>>20&31,R=n>>>25&127,o=n>>20,A=n>>20&-32|n>>>7&31,b=n&4294963200,g=n>>31<<12|(n>>>7&1)<<11|(n>>>25&63)<<5|(n>>>8&15)<<1,x=n>>31<<20|(n>>>12&255)<<12|(n>>>20&1)<<11|(n>>>21&1023)<<1;switch(a){case 55:this.wr(h,b);break;case 23:this.wr(h,e+b|0);break;case 111:this.wr(h,i),i=e+x|0;break;case 103:if(d===0){const t=this.rd(f)+o&-2;this.wr(h,i),i=t|0}else throw new v(`bad JALR funct3 ${d}`);break;case 99:{const t=this.rd(f),l=this.rd(y);let u=!1;switch(d){case 0:u=t===l;break;case 1:u=t!==l;break;case 4:u=t<l;break;case 5:u=t>=l;break;case 6:u=t>>>0<l>>>0;break;case 7:u=t>>>0>=l>>>0;break;default:throw new v(`bad BRANCH funct3 ${d}`)}u&&(i=e+g|0);break}case 3:{const t=this.rd(f)+o|0;let l;switch(d){case 0:l=this.memLoad(t,1,!0);break;case 1:l=this.memLoad(t,2,!0);break;case 2:l=this.memLoad(t,4,!0);break;case 4:l=this.memLoad(t,1,!1);break;case 5:l=this.memLoad(t,2,!1);break;default:throw new v(`bad LOAD funct3 ${d}`)}this.wr(h,l);break}case 35:{const t=this.rd(f)+A|0,l=this.rd(y);switch(d){case 0:this.memStore(t,l,1);break;case 1:this.memStore(t,l,2);break;case 2:this.memStore(t,l,4);break;default:throw new v(`bad STORE funct3 ${d}`)}break}case 19:{const t=this.rd(f),l=y;let u;switch(d){case 0:u=t+o|0;break;case 2:u=t<o?1:0;break;case 3:u=t>>>0<o>>>0?1:0;break;case 4:u=t^o;break;case 6:u=t|o;break;case 7:u=t&o;break;case 1:u=t<<l;break;case 5:u=R===32?t>>l:t>>>l;break;default:throw new v(`bad OP-IMM funct3 ${d}`)}this.wr(h,u);break}case 51:{const t=this.rd(f),l=this.rd(y),u=l&31;let T;switch(d){case 0:T=R===32?t-l|0:t+l|0;break;case 1:T=t<<u;break;case 2:T=t<l?1:0;break;case 3:T=t>>>0<l>>>0?1:0;break;case 4:T=t^l;break;case 5:T=R===32?t>>u:t>>>u;break;case 6:T=t|l;break;case 7:T=t&l;break;default:throw new v(`bad OP funct3 ${d}`)}this.wr(h,T);break}default:throw new v(`illegal opcode 0x${a.toString(16)} @${e}`)}this.pc=i>>>0}}class M extends Error{}const ae=(()=>{const r={};ie.forEach((e,n)=>r[e]=n);for(let e=0;e<32;e++)r["x"+e]=e;return r.fp=8,r})();function s(r){const e=ae[r.toLowerCase()];if(e===void 0)throw new M(`bad register: '${r}'`);return e}function G(r,e){let n=r.trim();if(e&&n in e)return e[n];let i=!1;n.startsWith("-")?(i=!0,n=n.slice(1)):n.startsWith("+")&&(n=n.slice(1));let a;if(/^0x[0-9a-f]+$/i.test(n))a=parseInt(n,16);else if(/^0b[01]+$/i.test(n))a=parseInt(n.slice(2),2);else if(/^[0-9]+$/.test(n))a=parseInt(n,10);else throw new M(`bad immediate: '${r}'`);return i?-a:a}function V(r){const e=r.match(/^(-?(?:0x[0-9a-f]+|[0-9]+))?\s*\(\s*([a-z0-9]+)\s*\)$/i);if(!e)throw new M(`bad memory operand: '${r}'`);return{off:e[1]?G(e[1]):0,reg:s(e[2])}}const c={r:(r,e,n,i,a,h)=>(n<<25|h<<20|a<<15|e<<12|i<<7|r)>>>0,i:(r,e,n,i,a)=>((a&4095)<<20|i<<15|e<<12|n<<7|r)>>>0,s:(r,e,n,i,a)=>((a&4064)<<20|(a&31)<<7|i<<20|n<<15|e<<12|r)>>>0,b:(r,e,n,i,a)=>((a>>12&1?2147483648:0)|(a>>5&63)<<25|i<<20|n<<15|e<<12|(a>>1&15)<<8|(a>>11&1)<<7|r)>>>0,u:(r,e,n)=>(n&4294963200|e<<7|r)>>>0,j:(r,e,n)=>((n>>20&1?2147483648:0)|(n>>1&1023)<<21|(n>>11&1)<<20|(n>>12&255)<<12|e<<7|r)>>>0};function Y(r){const e=r|0;let n=e&4095;return n&2048&&(n-=4096),{hi:e-n>>12&1048575,lo:n}}const oe={nop:()=>1,mv:()=>1,not:()=>1,neg:()=>1,seqz:()=>1,snez:()=>1,j:()=>1,jr:()=>1,ret:()=>1,call:()=>1,beqz:()=>1,bnez:()=>1,bgt:()=>1,ble:()=>1,li:r=>{const{hi:e}=Y(G(r[1]));return e===0?1:2},la:()=>2};function ce(r){const e=oe[r.mnemonic];return e?e(r.args):1}function j(r){const e=[],n={},i=[];let a=0;const h=r.split(`
`);for(let g=0;g<h.length;g++){let x=h[g].replace(/[#;].*$/,"").trim();if(!x)continue;let t;for(;(t=x.match(/^([A-Za-z_.$][\w.$]*)\s*:\s*(.*)$/))&&(n[t[1]]=a,x=t[2].trim(),!!x););if(!x)continue;const l=x.indexOf(" "),u=(l===-1?x:x.slice(0,l)).toLowerCase(),T=l===-1?"":x.slice(l+1).trim(),k=T?T.split(",").map($=>$.trim()):[];if(u===".word"){for(const $ of k)i.push({addr:a,value:$}),a+=4;continue}const F={mnemonic:u,args:k,line:g+1};e.push(F),a+=ce(F)*4}const d=a,f=new Uint8Array(d),y=new DataView(f.buffer);let R=0;const o=g=>{y.setUint32(R,g>>>0,!0),R+=4},A=(g,x)=>{if(g===".")return 0;if(!(g in n))throw new M(`line ${x}: unknown label '${g}'`);return n[g]-R},b=g=>G(g,n);for(const g of e){const{mnemonic:x,args:t,line:l}=g;try{switch(x){case"nop":o(c.i(19,0,0,0,0));break;case"mv":o(c.i(19,0,s(t[0]),s(t[1]),0));break;case"not":o(c.i(19,4,s(t[0]),s(t[1]),-1));break;case"neg":o(c.r(51,0,32,s(t[0]),0,s(t[1])));break;case"seqz":o(c.i(19,3,s(t[0]),s(t[1]),1));break;case"snez":o(c.r(51,3,0,s(t[0]),0,s(t[1])));break;case"j":o(c.j(111,0,A(t[0],l)));break;case"jr":o(c.i(103,0,0,s(t[0]),0));break;case"ret":o(c.i(103,0,0,1,0));break;case"call":o(c.j(111,1,A(t[0],l)));break;case"beqz":o(c.b(99,0,s(t[0]),0,A(t[1],l)));break;case"bnez":o(c.b(99,1,s(t[0]),0,A(t[1],l)));break;case"bgt":o(c.b(99,4,s(t[1]),s(t[0]),A(t[2],l)));break;case"ble":o(c.b(99,5,s(t[1]),s(t[0]),A(t[2],l)));break;case"li":{const{hi:u,lo:T}=Y(b(t[1])),k=s(t[0]);u===0?o(c.i(19,0,k,0,T)):(o(c.u(55,k,u<<12)),o(c.i(19,0,k,k,T)));break}case"la":{const{hi:u,lo:T}=Y(b(t[1])),k=s(t[0]);o(c.u(55,k,u<<12)),o(c.i(19,0,k,k,T));break}case"lui":o(c.u(55,s(t[0]),b(t[1])<<12));break;case"auipc":o(c.u(23,s(t[0]),b(t[1])<<12));break;case"jal":t.length===1?o(c.j(111,1,A(t[0],l))):o(c.j(111,s(t[0]),A(t[1],l)));break;case"jalr":if(t.length===1)o(c.i(103,0,1,s(t[0]),0));else if(t.length===2){const u=le(t[1]);o(u?c.i(103,0,s(t[0]),u.reg,u.off):c.i(103,0,s(t[0]),s(t[1]),0))}else o(c.i(103,0,s(t[0]),s(t[1]),b(t[2])));break;case"beq":o(c.b(99,0,s(t[0]),s(t[1]),A(t[2],l)));break;case"bne":o(c.b(99,1,s(t[0]),s(t[1]),A(t[2],l)));break;case"blt":o(c.b(99,4,s(t[0]),s(t[1]),A(t[2],l)));break;case"bge":o(c.b(99,5,s(t[0]),s(t[1]),A(t[2],l)));break;case"bltu":o(c.b(99,6,s(t[0]),s(t[1]),A(t[2],l)));break;case"bgeu":o(c.b(99,7,s(t[0]),s(t[1]),A(t[2],l)));break;case"lb":N(o,0,t);break;case"lh":N(o,1,t);break;case"lw":N(o,2,t);break;case"lbu":N(o,4,t);break;case"lhu":N(o,5,t);break;case"sb":z(o,0,t);break;case"sh":z(o,1,t);break;case"sw":z(o,2,t);break;case"addi":o(c.i(19,0,s(t[0]),s(t[1]),b(t[2])));break;case"slti":o(c.i(19,2,s(t[0]),s(t[1]),b(t[2])));break;case"sltiu":o(c.i(19,3,s(t[0]),s(t[1]),b(t[2])));break;case"xori":o(c.i(19,4,s(t[0]),s(t[1]),b(t[2])));break;case"ori":o(c.i(19,6,s(t[0]),s(t[1]),b(t[2])));break;case"andi":o(c.i(19,7,s(t[0]),s(t[1]),b(t[2])));break;case"slli":o(c.i(19,1,s(t[0]),s(t[1]),b(t[2])&31));break;case"srli":o(c.i(19,5,s(t[0]),s(t[1]),b(t[2])&31));break;case"srai":o(c.i(19,5,s(t[0]),s(t[1]),1024|b(t[2])&31));break;case"add":o(c.r(51,0,0,s(t[0]),s(t[1]),s(t[2])));break;case"sub":o(c.r(51,0,32,s(t[0]),s(t[1]),s(t[2])));break;case"sll":o(c.r(51,1,0,s(t[0]),s(t[1]),s(t[2])));break;case"slt":o(c.r(51,2,0,s(t[0]),s(t[1]),s(t[2])));break;case"sltu":o(c.r(51,3,0,s(t[0]),s(t[1]),s(t[2])));break;case"xor":o(c.r(51,4,0,s(t[0]),s(t[1]),s(t[2])));break;case"srl":o(c.r(51,5,0,s(t[0]),s(t[1]),s(t[2])));break;case"sra":o(c.r(51,5,32,s(t[0]),s(t[1]),s(t[2])));break;case"or":o(c.r(51,6,0,s(t[0]),s(t[1]),s(t[2])));break;case"and":o(c.r(51,7,0,s(t[0]),s(t[1]),s(t[2])));break;default:throw new M(`unknown instruction '${x}'`)}}catch(u){throw u instanceof M&&!u.message.startsWith("line ")?new M(`line ${l}: ${u.message}`):u}}for(const g of i)y.setUint32(g.addr,G(g.value,n)>>>0,!0);return{bytes:f,labels:n}}function le(r){return r.includes("(")?V(r):null}function N(r,e,n){const i=V(n[1]);r(c.i(3,e,s(n[0]),i.reg,i.off))}function z(r,e,n){const i=V(n[1]);r(c.s(35,e,i.reg,s(n[0]),i.off))}const p={SELF_HP:4096,BATTERY:4100,INCOME:4104,TURN:4108,POS_X:4112,POS_Y:4116,RNG:4120,TEAM:4124,GRID_W:4128,GRID_H:4132,SIG_N:4144,SIG_E:4148,SIG_S:4152,SIG_W:4156,RESULT:4176,CHECK:4352,MOVE:4356,ATTACK:4360,SIGNAL:4364,YIELD:4368},W=[0,1,0,-1],X=[-1,0,1,0],he=[2,3,0,1];class Q{constructor(e){this.s=e>>>0}nextU32(){this.s=this.s+1831565813|0;let e=Math.imul(this.s^this.s>>>15,1|this.s);return e=e+Math.imul(e^e>>>7,61|e)^e,(e^e>>>14)>>>0}nextInt(e){return this.nextU32()%e}shuffle(e){for(let n=e.length-1;n>0;n--){const i=this.nextInt(n+1);[e[n],e[i]]=[e[i],e[n]]}return e}}class de{constructor(e){this.cells=[],this.initiative=[],this.turn=0,this.nextId=0,this.width=e.width,this.height=e.height,this.cfg={...Z,...e.config},this.rng=new Q(e.seed),this.grid=new Array(this.width*this.height).fill(null)}idx(e,n){return n*this.width+e}inBounds(e,n){return e>=0&&n>=0&&e<this.width&&n<this.height}cellAt(e,n){return this.inBounds(e,n)?this.grid[this.idx(e,n)]:null}setup(e){for(const n of e)for(const i of n.positions){if(!this.inBounds(i.x,i.y)||this.grid[this.idx(i.x,i.y)])throw new Error(`invalid/occupied spawn at ${i.x},${i.y}`);const a=this.makeCell(n.team,i.x,i.y,n.program);this.cells.push(a),this.grid[this.idx(i.x,i.y)]=a}this.initiative=this.rng.shuffle([...this.cells])}makeCell(e,n,i,a){const h=new Uint8Array(_),d={id:this.nextId++,team:e,x:n,y:i,hp:this.cfg.START_HP,battery:0,income:0,alive:!0,sig:[0,0,0,0],result:0,endTurn:!1,cpu:null,stats:{attacksLanded:0,moves:0,signals:0,damageTaken:0}},f=this.makeBus(d);return d.cpu=new re(h,f),d.cpu.loadProgram(a),d}makeBus(e){const n=a=>e.battery<a?!1:(e.battery-=a,!0),i=a=>this.cellAt(e.x+W[a],e.y+X[a]);return{read:a=>{switch(a){case p.SELF_HP:return e.hp;case p.BATTERY:return e.battery;case p.INCOME:return e.income;case p.TURN:return this.turn;case p.POS_X:return e.x;case p.POS_Y:return e.y;case p.RNG:return this.rng.nextU32()|0;case p.TEAM:return e.team;case p.GRID_W:return this.width;case p.GRID_H:return this.height;case p.SIG_N:case p.SIG_E:case p.SIG_S:case p.SIG_W:{const h=a-p.SIG_N>>2,d=e.sig[h];return e.sig[h]=0,d}case p.RESULT:return e.result;default:return 0}},write:(a,h)=>{const d=h&3;switch(a){case p.CHECK:{e.result=n(this.cfg.CHECK_COST)&&i(d)?1:0;break}case p.MOVE:{if(!n(this.cfg.MOVE_COST)){e.result=0;break}const f=e.x+W[d],y=e.y+X[d];this.inBounds(f,y)&&!this.grid[this.idx(f,y)]?(this.grid[this.idx(e.x,e.y)]=null,e.x=f,e.y=y,this.grid[this.idx(f,y)]=e,e.stats.moves++,e.result=1):e.result=0;break}case p.ATTACK:{if(!n(this.cfg.ATTACK_COST)){e.result=0;break}const f=i(d);f?(f.hp-=this.cfg.ATTACK_DAMAGE,f.stats.damageTaken+=this.cfg.ATTACK_DAMAGE,e.stats.attacksLanded++,f.hp<=0&&this.kill(f),e.result=1):e.result=0;break}case p.SIGNAL:{if(!n(this.cfg.SIGNAL_COST)){e.result=0;break}const f=i(d);f?(f.sig[he[d]]++,e.stats.signals++,e.result=1):e.result=0;break}case p.YIELD:e.endTurn=!0;break}}}}kill(e){e.alive&&(e.alive=!1,this.grid[this.idx(e.x,e.y)]===e&&(this.grid[this.idx(e.x,e.y)]=null))}runTurn(){this.turn++;for(const e of this.initiative){if(!e.alive)continue;e.battery=Math.min(this.cfg.BATTERY_MAX,e.battery+this.cfg.INCOME_PER_TURN),e.income=this.cfg.INCOME_PER_TURN,e.endTurn=!1;let n=0;for(;!e.endTurn&&n<this.cfg.MAX_CYCLES_PER_TURN&&!(e.battery<this.cfg.INSTR_COST);){e.battery-=this.cfg.INSTR_COST;try{e.cpu.step()}catch{break}n++}}return!this.isOver()}aliveTeams(){const e=new Set;for(const n of this.cells)n.alive&&e.add(n.team);return e}isOver(){return this.aliveTeams().size<=1||this.turn>=this.cfg.MAX_TURNS}result(){const e=this.aliveTeams(),n={};for(const i of this.cells)i.alive&&(n[i.team]=(n[i.team]??0)+1);return{winner:e.size===1?[...e][0]:null,turns:this.turn,survivorsByTeam:n}}run(){for(;this.runTurn(););return this.result()}}const ue={width:32,height:32,seed:1,cellsPerTeam:24};function fe(r,e,n,i){const a=n*2;if(a>r*e)throw new Error("too many cells for the board size");const h=[];for(let d=0;d<e;d++)for(let f=0;f<r;f++)h.push({x:f,y:d});return new Q(i^2654435769).shuffle(h),[h.slice(0,n),h.slice(n,a)]}function me(r,e,n={}){const i={...ue,...n},a=new de({width:i.width,height:i.height,seed:i.seed}),[h,d]=fe(i.width,i.height,i.cellsPerTeam,i.seed),f=[{team:0,program:j(r.source).bytes,positions:h},{team:1,program:j(e.source).bytes,positions:d}];return a.setup(f),a}const pe=`
_start:
  li sp, 0xf00
loop:
  li t0, 0x1110      # YIELD
  sw x0, 0(t0)
  j loop
`,ge=`
_start:
  li sp, 0xf00
loop:
  li t0, 0           # dir = 0
scan:
  li t1, 0x1100      # CHECK port
  sw t0, 0(t1)
  li t1, 0x1050      # RESULT
  lw t2, 0(t1)
  beqz t2, next
  li t1, 0x1108      # ATTACK port
  sw t0, 0(t1)
next:
  addi t0, t0, 1
  li t1, 4
  blt t0, t1, scan
  li t1, 0x1110      # YIELD
  sw x0, 0(t1)
  j loop
`,we=`
_start:
  li sp, 0xf00
loop:
  li s0, 0           # found-a-target flag
  li t0, 0           # dir
scan:
  li t1, 0x1100      # CHECK
  sw t0, 0(t1)
  li t1, 0x1050
  lw t2, 0(t1)
  beqz t2, bnext
  li t1, 0x1108      # ATTACK
  sw t0, 0(t1)
  li s0, 1
bnext:
  addi t0, t0, 1
  li t1, 4
  blt t0, t1, scan
  bnez s0, done      # already attacked something this turn
  li t1, 0x1018      # RNG
  lw t2, 0(t1)
  andi t2, t2, 3     # random dir 0..3
  li t1, 0x1104      # MOVE
  sw t2, 0(t1)
done:
  li t1, 0x1110      # YIELD
  sw x0, 0(t1)
  j loop
`,be=`
_start:
  li sp, 0xf00
loop:
  li s0, 0           # dir
dloop:
  slli a0, s0, 2     # &strikes[dir] = 0x800 + dir*4
  li t0, 0x800
  add a0, a0, t0
  li t0, 0x1100      # CHECK occupied?
  sw s0, 0(t0)
  li t0, 0x1050
  lw a1, 0(t0)       # a1 = occupied
  beqz a1, clear     # empty -> reset strikes and continue
  slli t0, s0, 2     # read SIG[dir] (0x1030 + dir*4); reading resets it
  li t1, 0x1030
  add t0, t0, t1
  lw a2, 0(t0)       # a2 = signals received from this dir
  li t0, 0x110c      # SIGNAL the neighbour (respond or probe)
  sw s0, 0(t0)
  bnez a2, clear     # they answered -> friend -> reset strikes
  lw a3, 0(a0)       # enemy path: strikes++
  addi a3, a3, 1
  sw a3, 0(a0)
  li t0, 2
  blt a3, t0, dnext  # fewer than 2 strikes -> hold fire
  li t0, 0x1108      # ATTACK
  sw s0, 0(t0)
  j dnext
clear:
  sw x0, 0(a0)       # strikes[dir] = 0
dnext:
  addi s0, s0, 1
  li t0, 4
  blt s0, t0, dloop
  li t0, 0x1110      # YIELD
  sw x0, 0(t0)
  j loop
`,Te=`
_start:
  li sp, 0xf00
loop:
  li s0, 0           # dir
  li s1, 0           # active-enemy-contact flag
dloop:
  slli a0, s0, 2     # &strikes[dir] = 0x800 + dir*4
  li t0, 0x800
  add a0, a0, t0
  li t0, 0x1100      # CHECK occupied?
  sw s0, 0(t0)
  li t0, 0x1050
  lw a1, 0(t0)
  beqz a1, clear
  slli t0, s0, 2     # SIG[dir]
  li t1, 0x1030
  add t0, t0, t1
  lw a2, 0(t0)
  li t0, 0x110c      # signal (respond or probe)
  sw s0, 0(t0)
  bnez a2, clear     # answered -> friend
  li s1, 1           # unanswered -> hold position and resolve
  lw a3, 0(a0)
  addi a3, a3, 1
  sw a3, 0(a0)
  li t0, 2
  blt a3, t0, dnext
  li t0, 0x1108      # ATTACK
  sw s0, 0(t0)
  j dnext
clear:
  sw x0, 0(a0)
dnext:
  addi s0, s0, 1
  li t0, 4
  blt s0, t0, dloop
  bnez s1, endturn   # enemy adjacent -> don't move
  li t0, 0x1018      # RNG -> wander to hunt
  lw t1, 0(t0)
  andi t1, t1, 3
  li t0, 0x1104      # MOVE
  sw t1, 0(t0)
endturn:
  li t0, 0x1110      # YIELD
  sw x0, 0(t0)
  j loop
`,E={idle:{name:"Idle",description:"Does nothing. A control / punching bag.",source:pe},sentinel:{name:"Sentinel",description:"Holds position and attacks any adjacent cell (friendly fire included).",source:ge},berserker:{name:"Berserker",description:"Attacks adjacent cells, wanders randomly to hunt. No friend-or-foe.",source:we},diplomat:{name:"Diplomat",description:"Signalling handshake to spare friends; attacks silent (presumed-enemy) neighbours.",source:be},skirmisher:{name:"Skirmisher",description:"Mobile diplomat: hunts through open space, spares friends, finishes foes.",source:Te}},Ae=Object.keys(E),xe=`# Cytofyght Technical Specification

Revision 1.0

This document specifies the runtime behavior of the Cytofyght simulation: the
processor model executed by each cell, the memory map, the memory-mapped IO
(MMIO) interface, the energy economy, and the rules that govern a match. It is
intended as a programming reference for authors of cell programs.

All numeric literals are given in decimal unless prefixed with \`0x\`, in which case
they are hexadecimal. All multi-byte values in memory are little-endian.

---

## 1. Overview

A match takes place on a rectangular grid. Each grid square holds at most one
cell. Every cell belongs to a team and runs an identical, independent instance of
that team's program on a private virtual processor. A cell perceives and affects
the world only through MMIO.

The last team with at least one living cell wins. A match that reaches the turn
limit without a sole surviving team is recorded as a draw.

---

## 2. Processor model

Each cell executes the RV32I base integer instruction set (32-bit). The following
points define the subset and its deviations from a hardware core:

- 32 general-purpose registers, \`x0\` through \`x31\`. Register \`x0\` is hardwired to
  zero; writes to it are discarded.
- A 32-bit program counter (\`pc\`).
- Instructions are 32 bits wide and must be word-aligned.
- Supported opcodes: \`LUI\`, \`AUIPC\`, \`JAL\`, \`JALR\`, the \`BRANCH\` family, the
  \`LOAD\` family, the \`STORE\` family, the register-immediate \`OP-IMM\` family, and
  the register-register \`OP\` family.
- Not implemented: \`FENCE\`, \`ECALL\`, \`EBREAK\`, CSR instructions, the M/A/F/D
  extensions, and compressed (C) instructions. Encountering an unimplemented or
  malformed instruction raises a trap (see Section 9).

Shift amounts use the low 5 bits of the operand. Signed and unsigned comparisons
and shifts follow the RV32I definitions.

### 2.1 State persistence

A cell's processor state is persistent for the entire match. Registers, the
program counter, and the contents of RAM are retained between the cell's turns. A
program is therefore not restarted each turn; it resumes at the instruction
following the point where the previous turn ended. RAM is zero-initialized at
spawn, all registers are zero, and \`pc\` is 0.

---

## 3. Address space

Each cell has a private 4096-byte (\`0x1000\`) address space for RAM, with the MMIO
region mapped immediately above it.

| Region | Range | Size | Access |
| --- | --- | --- | --- |
| RAM | \`0x0000\` to \`0x0FFF\` | 4096 bytes | read/write, byte/half/word |
| MMIO | \`0x1000\` and above | n/a | word-oriented, see Section 5 |

The program image is loaded at address \`0x0000\`. There is no separate stack
region; programs that use a stack should initialize the stack pointer into RAM
(for example \`0x0F00\`) and must not let the program image and the stack overlap.

An access is treated as MMIO if and only if its effective address is greater than
or equal to \`0x1000\`. RAM accesses are bounds-checked: an access whose span
extends beyond \`0x0FFF\` raises a trap.

---

## 4. Execution and timing model

### 4.1 Turns and initiative

At the start of a match, all living cells of all teams are collected and placed
into a single randomized initiative order. This order is fixed for the duration of
the match.

A turn is one pass over the initiative order. On each pass, every cell that is
still alive is activated once, in initiative order. Cells removed earlier in the
same pass are skipped.

### 4.2 Power and the cycle budget

Each cell has a power battery, measured in power units. The battery is zero at
spawn. At the start of each of a cell's activations:

1. The battery is credited with \`INCOME_PER_TURN\` power, saturating at
   \`BATTERY_MAX\`. Power not spent carries over to later turns up to that cap.
2. The income figure for the turn is exposed through MMIO.

The cell then executes instructions until one of the following occurs:

- The cell writes to the \`YIELD\` port (Section 6.5).
- The remaining battery is less than \`INSTR_COST\`, so the next instruction cannot
  be afforded.
- The per-turn instruction cap \`MAX_CYCLES_PER_TURN\` is reached.
- A trap occurs (Section 9).

Every instruction costs \`INSTR_COST\` power, deducted before the instruction
executes. Actions cost additional power as defined in Section 6. When a turn ends
mid-program, the program counter and all state are preserved, and execution
resumes at the next instruction on the cell's following turn.

### 4.3 Cost accounting for actions

An action is triggered by a store to an action port. Action cost is charged in
addition to the \`INSTR_COST\` already charged for the store instruction itself. The
charge uses the following rule, referred to elsewhere as "spend":

- If the current battery is less than the action cost, the action does not occur,
  no power is deducted for the action, and the action result is 0.
- Otherwise the cost is deducted and the action is performed.

Because a store that triggers an action still costs \`INSTR_COST\` regardless of
whether the action succeeds, a program should verify it can afford an action (by
reading \`BATTERY\`) before attempting it in a tight loop.

---

## 5. MMIO register map

All IO is memory-mapped. Sensor registers are read with load instructions; action
ports are triggered with store instructions. Reading a sensor or reading the
result register costs no power beyond the \`INSTR_COST\` of the load instruction
itself.

Reads of an unmapped MMIO address return 0. Writes to an unmapped MMIO address
have no effect. MMIO is word-oriented; programs should use \`lw\` and \`sw\`.

### 5.1 Sensor registers (read)

| Address | Name | Reset | Description |
| --- | --- | --- | --- |
| \`0x1000\` | \`SELF_HP\` | \`START_HP\` | Current hit points of this cell. |
| \`0x1004\` | \`BATTERY\` | 0 | Current battery level in power units. |
| \`0x1008\` | \`INCOME\` | 0 | Power credited at the start of the current turn. |
| \`0x100C\` | \`TURN\` | 0 | Index of the current turn (increments each pass). |
| \`0x1010\` | \`POS_X\` | spawn x | Current grid column of this cell. |
| \`0x1014\` | \`POS_Y\` | spawn y | Current grid row of this cell. |
| \`0x1018\` | \`RNG\` | n/a | Returns a fresh pseudo-random 32-bit value on each read. |
| \`0x101C\` | \`TEAM\` | team id | Numeric identifier of this cell's team. |
| \`0x1020\` | \`GRID_W\` | width | Grid width in cells. |
| \`0x1024\` | \`GRID_H\` | height | Grid height in cells. |
| \`0x1030\` | \`SIG_N\` | 0 | Signals received from the north since last read. Reading resets it to 0. |
| \`0x1034\` | \`SIG_E\` | 0 | Signals received from the east since last read. Reading resets it to 0. |
| \`0x1038\` | \`SIG_S\` | 0 | Signals received from the south since last read. Reading resets it to 0. |
| \`0x103C\` | \`SIG_W\` | 0 | Signals received from the west since last read. Reading resets it to 0. |
| \`0x1050\` | \`RESULT\` | 0 | Result of the most recently triggered action (Section 6). |

### 5.2 Action ports (write)

| Address | Name | Payload | Power cost | Description |
| --- | --- | --- | --- | --- |
| \`0x1100\` | \`CHECK\` | direction | \`CHECK_COST\` | Test whether a neighbor square is occupied. |
| \`0x1104\` | \`MOVE\` | direction | \`MOVE_COST\` | Move one square in a direction. |
| \`0x1108\` | \`ATTACK\` | direction | \`ATTACK_COST\` | Attack the neighbor in a direction. |
| \`0x110C\` | \`SIGNAL\` | direction | \`SIGNAL_COST\` | Send a signal to the neighbor in a direction. |
| \`0x1110\` | \`YIELD\` | ignored | 0 | End this cell's turn immediately. |

The value written to an action port is interpreted as a direction by taking its
low 2 bits (see Section 7). The \`YIELD\` port ignores its payload.

---

## 6. Action semantics

After any action other than \`YIELD\`, the \`RESULT\` register holds the outcome of
that action. The value is valid until the next action overwrites it.

### 6.1 CHECK

Charges \`CHECK_COST\`. Sets \`RESULT\` to 1 if the target square is inside the grid
and occupied by a cell, otherwise 0. \`CHECK\` does not reveal the team of the
occupant. A result of 0 is returned for an empty square, an off-grid square, or
an attempt that could not be afforded; these cases are indistinguishable from the
result alone.

### 6.2 MOVE

Charges \`MOVE_COST\`. If the target square is inside the grid and unoccupied, the
cell moves into it and \`RESULT\` is set to 1. Otherwise the cell does not move and
\`RESULT\` is set to 0. In the blocked case the power cost is still charged.

### 6.3 ATTACK

Charges \`ATTACK_COST\`. If the target square contains a cell (of any team,
including the attacker's own), that cell loses \`ATTACK_DAMAGE\` hit points and
\`RESULT\` is set to 1. If the target hit points reach 0 or below, the target is
removed from the grid immediately. If the target square is empty or off-grid,
\`RESULT\` is set to 0 and the power cost is still charged.

\`ATTACK\` does not distinguish friend from foe. Friendly fire is possible and is
the program author's responsibility to avoid.

### 6.4 SIGNAL

Charges \`SIGNAL_COST\`. If the target square contains a cell, that cell's received-
signal counter for the opposing direction is incremented and \`RESULT\` is set to 1.
For example, a signal sent east increments the recipient's \`SIG_W\` counter. If the
target square is empty or off-grid, \`RESULT\` is set to 0 and the power cost is
still charged. A signal carries no data payload.

### 6.5 YIELD

Ends the cell's turn immediately. No power is charged. The program counter has
already advanced past the triggering store, so the cell resumes at the following
instruction on its next turn. \`RESULT\` is unchanged.

---

## 7. Direction encoding

Directions are encoded in 2 bits. The origin is the top-left of the grid; the
y-axis increases downward.

| Value | Direction | Delta x | Delta y | Opposite |
| --- | --- | --- | --- | --- |
| 0 | North | 0 | -1 | South |
| 1 | East | +1 | 0 | West |
| 2 | South | 0 | +1 | North |
| 3 | West | -1 | 0 | East |

The "Opposite" column gives the direction from which a recipient perceives an
incoming signal, as used by \`SIGNAL\`.

---

## 8. Signalling protocol notes

The signalling channel carries no data; it conveys only that a signal arrived from
a given direction, and how many arrived since the counter was last read. The
counters are free to read and self-clear on read.

This is sufficient to build a friend-or-foe handshake by convention. For example,
a team can agree that a cell which receives a signal from a direction answers with
a signal in that direction on its next turn. A cell can then classify a neighbor
as friendly if the neighbor answers a probe, and as hostile if it does not.
Because both teams may run the same program, a robust handshake distinguishes
teams only when the teams use different conventions.

Signal counters are updated at the moment a \`SIGNAL\` action is performed. A
recipient that is later in the same turn's initiative order can therefore observe
a signal sent earlier in the same turn.

---

## 9. Traps

A trap ends the current cell's turn. It does not remove or otherwise penalize the
cell beyond the loss of the remainder of that turn; execution resumes at the
faulting instruction on the cell's next turn, so an uncorrected fault will recur.

A trap is raised on any of the following:

- An attempt to execute an instruction whose word would extend beyond the RAM
  bound.
- A load or store whose access targets RAM and extends beyond the RAM bound.
- An illegal or unimplemented opcode or function field.

MMIO accesses are never bounds-trapped; unmapped reads return 0 and unmapped
writes are ignored.

---

## 10. Combat and win conditions

- Every cell starts with \`START_HP\` hit points.
- Each successful attack removes \`ATTACK_DAMAGE\` hit points from the target.
- A cell at 0 or fewer hit points is removed from the grid and takes no further
  turns.
- A match ends when at most one team has living cells, or when the turn count
  reaches \`MAX_TURNS\`.
- If exactly one team has living cells at the end, that team wins. Otherwise the
  match is a draw.

---

## 11. Parameter reference

The following parameters define the default configuration. They are fixed for a
given match and are exposed to programs only where noted in Section 5.

| Parameter | Value | Meaning |
| --- | --- | --- |
| \`INSTR_COST\` | 1 | Power charged per executed instruction. |
| \`CHECK_COST\` | 2 | Power charged per \`CHECK\`. |
| \`SIGNAL_COST\` | 12 | Power charged per \`SIGNAL\`. |
| \`MOVE_COST\` | 50 | Power charged per \`MOVE\`. |
| \`ATTACK_COST\` | 50 | Power charged per \`ATTACK\`. |
| \`INCOME_PER_TURN\` | 100 | Power credited at the start of each turn. |
| \`BATTERY_MAX\` | 400 | Battery capacity. |
| \`START_HP\` | 10 | Hit points at spawn. |
| \`ATTACK_DAMAGE\` | 1 | Hit points removed per successful attack. |
| \`MAX_CYCLES_PER_TURN\` | 600 | Hard cap on instructions executed per turn. |
| \`MAX_TURNS\` | 4000 | Turn limit; reaching it ends the match. |
| RAM size | 4096 | Bytes of private RAM per cell. |

---

## 12. Programming model and conventions

A cell program is typically structured as a one-time initialization block
followed by a per-turn loop that ends each turn with a write to \`YIELD\`:

\`\`\`asm
_start:
    li sp, 0xf00          # initialize stack pointer (runs once)
loop:
    # ... perform this turn's sensing and actions ...
    li t0, 0x1110         # YIELD
    sw x0, 0(t0)
    j loop                # next turn resumes here
\`\`\`

Recommended practices:

- Read \`BATTERY\` before committing to \`MOVE\` or \`ATTACK\` so that power is not lost
  to an unaffordable action inside a loop.
- Place persistent per-cell state in RAM at addresses clear of the program image.
  Programs in this project use the region beginning at \`0x800\` for scratch data.
- Reading a signal counter clears it. Read each counter at most once per turn if
  the count matters.
- A turn implicitly ends when the battery is exhausted; an explicit \`YIELD\` is an
  optimization that preserves battery for later turns.

The assembler used in this project supports the RV32I instructions listed in
Section 2, the common pseudo-instructions (\`li\`, \`la\`, \`mv\`, \`nop\`, \`not\`, \`neg\`,
\`seqz\`, \`snez\`, \`j\`, \`jr\`, \`ret\`, \`call\`, \`beqz\`, \`bnez\`, \`bgt\`, \`ble\`), labels,
the \`.\` current-address symbol, and the \`.word\` data directive. Registers may be
named numerically (\`x0\` to \`x31\`) or by their ABI aliases.
`,m=r=>document.getElementById(r),I=m("teamA"),O=m("teamB"),Se=m("descA"),ye=m("descB"),ke=m("seed"),J=m("count"),ve=m("width"),Ee=m("height"),q=m("speed"),Ce=m("speedval"),C=m("canvas"),S=C.getContext("2d"),Ie=["#35d6ff","#ffb000"];for(const r of Ae)for(const e of[I,O]){const n=document.createElement("option");n.value=r,n.textContent=E[r].name,e.appendChild(n)}I.value="skirmisher";O.value="diplomat";function D(){Se.textContent=E[I.value].description,ye.textContent=E[O.value].description}I.onchange=D;O.onchange=D;D();let w,L=!1,B=0,H=0;function ee(){const r=Math.max(2,+ve.value|0),e=Math.max(1,+Ee.value|0),n=Math.floor(r*e/2),i=Math.min(Math.max(1,+J.value|0),n);J.value=String(i),w=me(E[I.value],E[O.value],{width:r,height:e,seed:+ke.value|0,cellsPerTeam:i}),te(),L=!1,m("play").textContent="Run",K()}function te(){const r=Math.min(window.innerWidth-380,900),e=window.innerHeight-60,n=Math.max(4,Math.floor(Math.min(r/w.width,e/w.height)));C.width=w.width*n,C.height=w.height*n}function K(){const r=C.width/w.width;S.fillStyle="#04080c",S.fillRect(0,0,C.width,C.height),S.strokeStyle="#0d1c27",S.lineWidth=1;for(let e=0;e<=w.width;e++)S.beginPath(),S.moveTo(e*r+.5,0),S.lineTo(e*r+.5,C.height),S.stroke();for(let e=0;e<=w.height;e++)S.beginPath(),S.moveTo(0,e*r+.5),S.lineTo(C.width,e*r+.5),S.stroke();for(const e of w.cells){if(!e.alive)continue;const n=Math.max(.25,e.hp/Z.START_HP);S.globalAlpha=n,S.fillStyle=Ie[e.team]??"#aaa";const i=r>8?1:0;S.fillRect(e.x*r+i,e.y*r+i,r-i*2,r-i*2),S.globalAlpha=1}Re()}function Re(){const r={0:0,1:0};for(const h of w.cells)h.alive&&r[h.team]++;const e=r[0]??0,n=r[1]??0,i=Math.max(1,e+n);m("countA").textContent=String(e),m("countB").textContent=String(n),m("turn").textContent=String(w.turn),m("barA").style.width=`${e/i*100}%`,m("barB").style.width=`${n/i*100}%`;const a=m("winner");if(w.isOver()){const h=w.result();h.winner===null?a.textContent=`Draw after ${h.turns} turns`:a.textContent=`${E[h.winner===0?I.value:O.value].name} (Team ${h.winner===0?"A":"B"}) wins!`}else a.textContent=""}function ne(r){if(requestAnimationFrame(ne),!L){H=r;return}const e=(r-H)/1e3;H=r,B+=e*+q.value;let n=!1;for(;B>=1;)if(B-=1,!w.isOver())w.runTurn(),n=!0;else{L=!1,m("play").textContent="Run";break}n&&K()}m("new").onclick=ee;m("step").onclick=()=>{w.isOver()||w.runTurn(),K()};m("play").onclick=()=>{w.isOver()||(L=!L,m("play").textContent=L?"Pause":"Run")};q.oninput=()=>Ce.textContent=q.value;window.addEventListener("resize",()=>{te(),K()});const P=m("file"),U=m("uploadStatus");function _e(r,e){const n=r.replace(/\.[^.]+$/,"")||"custom";let i=`custom:${n}`,a=2;for(;i in E;)i=`custom:${n}-${a++}`;E[i]={name:n,description:"Custom uploaded program.",source:e};for(const h of[I,O]){const d=document.createElement("option");d.value=i,d.textContent=`★ ${n}`,h.appendChild(d)}return i}m("upload").onclick=()=>P.click();P.onchange=async()=>{var i;const r=(i=P.files)==null?void 0:i[0];if(!r)return;const e=await r.text();try{j(e)}catch(a){U.textContent=`✕ ${a.message}`,U.className="status err",P.value="";return}const n=_e(r.name,e);I.value=n,D(),U.textContent=`✓ ${r.name} compiled — assigned to BOT.A`,U.className="status ok",P.value=""};m("downloadSpec").onclick=r=>{r.preventDefault();const e=new Blob([xe],{type:"text/plain;charset=utf-8"}),n=URL.createObjectURL(e);window.open(n,"_blank","noopener"),setTimeout(()=>URL.revokeObjectURL(n),3e4)};ee();requestAnimationFrame(ne);
