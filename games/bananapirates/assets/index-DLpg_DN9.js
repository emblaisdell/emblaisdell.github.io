(function(){const e=document.createElement("link").relList;if(e&&e.supports&&e.supports("modulepreload"))return;for(const o of document.querySelectorAll('link[rel="modulepreload"]'))r(o);new MutationObserver(o=>{for(const a of o)if(a.type==="childList")for(const n of a.addedNodes)n.tagName==="LINK"&&n.rel==="modulepreload"&&r(n)}).observe(document,{childList:!0,subtree:!0});function t(o){const a={};return o.integrity&&(a.integrity=o.integrity),o.referrerPolicy&&(a.referrerPolicy=o.referrerPolicy),o.crossOrigin==="use-credentials"?a.credentials="include":o.crossOrigin==="anonymous"?a.credentials="omit":a.credentials="same-origin",a}function r(o){if(o.ep)return;o.ep=!0;const a=t(o);fetch(o.href,a)}})();function i(s,e={},...t){const r=document.createElement(s);for(const[o,a]of Object.entries(e))a!=null&&(o==="class"?r.className=a:o==="onClick"?r.addEventListener("click",a):o==="style"?Object.assign(r.style,a):r[o]=a);for(const o of t)o==null||o===!1||r.append(typeof o=="string"?document.createTextNode(o):o);return r}function E(s){s.replaceChildren()}function V(s){document.getElementById("app").replaceChildren(s)}function O(s){const e=s.trim()==="";return i("span",{class:e?"Tile blank":"Tile"},i("span",{class:"letter"},e?"":s.toUpperCase()))}function H(s){return i("span",{class:"Word"},...[...s].map(e=>O(e)))}function ae(s){return i("span",{class:"TileText"},...s.toUpperCase().split(" ").map(e=>H(e)))}function ne(s){const e=s.words.reduce((t,r)=>t+r.length,0);return`${s.words.length} word${s.words.length===1?"":"s"} · ${e} letters`}function ie(s){const e=i("div",{class:"cpu-wait"},i("div",{class:"cpu-wait-fill"}));return e.dataset.bot=s,e}function le(s,e,t={}){const r=t.selectable??!1,o=()=>t.onSelectionChange?.(),a=new Set;let n=null,c=null;const f=s.flipped.map((l,w)=>{const d=O(l);return r&&(d.classList.add("selectable"),d.addEventListener("click",()=>{a.delete(w)?d.classList.remove("selected"):(a.add(w),d.classList.add("selected")),o()})),d});function p(l,w){const d=H(l);return t.glowWords?.has(`${w}|${l}`)&&d.classList.add("glow"),r&&(d.classList.add("selectable"),d.addEventListener("click",()=>{c===d?(d.classList.remove("selected"),n=null,c=null):(c?.classList.remove("selected"),d.classList.add("selected"),n=l,c=d),o()})),d}function h(l,w){return i("div",{class:`Player${l.isCpu?" is-cpu":""}${w?" is-turn":""}`},i("div",{class:"player-header"},i("h2",{},l.id===e?`${l.name} (you)`:l.name),i("span",{class:"score"},ne(l)),w?i("span",{class:"turn-badge"},"to flip"):null,i("hr")),l.isCpu?ie(l.id):null,i("div",{class:"words"},l.words.length===0?i("span",{class:"empty"},"—"):null,...l.words.map(d=>p(d,l.id))))}return{el:i("div",{class:"Board"},i("div",{class:"global-letters"},i("div",{class:"flipped"},...f,i("div",{class:"unflipped"},O(" "),i("span",{class:"count"},`× ${s.numUnflipped}`)))),i("div",{class:"players"},...s.players.map(l=>h(l,l.id===s.turn&&s.numUnflipped>0)))),getSelection:()=>({poolLetters:[...a].map(l=>s.flipped[l]),base:n}),clearSelection:()=>{for(const l of a)f[l]?.classList.remove("selected");a.clear(),c?.classList.remove("selected"),n=null,c=null,o()}}}const j={"too-short":"Too short.","not-a-word":"Not in the dictionary.","bad-letters":"Letters only.","no-play":"Can't make that from the board.","illegal-steal":"That's just adding letters — rearrange it!","game-over":"The game is over.","not-your-turn":"Wait your turn to flip."};function F(s){const e=new Map;for(const t of s)e.set(t,(e.get(t)??0)+1);return e}function ce(s,e){const t=new Set;if(!s)return{glow:t,transform:null};const r=new Map(s.players.map(c=>[c.id,F(c.words)])),o=[],a=[];for(const c of e.players){const f=r.get(c.id)??new Map,p=F(c.words);for(const[h,m]of p)for(let l=0;l<m-(f.get(h)??0);l++)o.push(h),t.add(`${c.id}|${h}`);for(const[h,m]of f)for(let l=0;l<m-(p.get(h)??0);l++)a.push(h)}if(o.length===0)return{glow:t,transform:null};const n=o[o.length-1];return{glow:t,transform:a.length>0?`${a[0]} → ${n}`:n}}function ue(s,e){const t=i("div",{class:"board-slot"}),r=i("div"),o=i("div",{class:"hint"}),a=i("div",{class:"flash"});let n=null,c=null,f=null;const p=window.matchMedia("(max-width: 600px)");let h=p.matches;function m(u){a.textContent=u}function l(){const u=s.flip();!u.ok&&u.reason&&m(u.reason==="no-play"?"Bag's empty!":j[u.reason])}function w(){s.pass();const u=s.getGame();m(u.numUnflipped>0?"Flip a tile to keep playing.":"Passed — waiting on the others…")}const d=i("input",{type:"text",placeholder:"type a word…",autocomplete:"off",autocapitalize:"off",spellcheck:!1});function U(){const u=d.value.trim();if(!u)return;const g=s.submit(u);g.ok?d.value="":g.reason&&m(j[g.reason])}d.addEventListener("keydown",u=>{u.key==="Enter"?(u.preventDefault(),U()):u.key===" "&&d.value===""&&(u.preventDefault(),l())});let A=null;function te(){return A=i("div",{class:"Button secondary",onClick:l},"Flip ⎵"),i("div",{class:"controls"},i("div",{class:"TextBox"},d),i("div",{class:"Button",onClick:U},"Claim"),A,i("div",{class:"Button secondary",onClick:w},"Pass"))}const W=te();function M(){if(!n||!s.playSelection)return;const{poolLetters:u,base:g}=n.getSelection();u.length!==0&&(m("…"),s.playSelection(u,g).then(y=>{!y||y.ok||(m(y.reason==="no-play"?"No word from those tiles.":j[y.reason??"no-play"]),n?.clearSelection())}))}function se(){const u=s.getGame(),g=(n?.getSelection().poolLetters.length??0)>0;if(u.numUnflipped===0)return g?i("div",{class:"controls mobile"},i("div",{class:"Button play",onClick:M},"PLAY")):i("div",{class:"controls mobile"},i("div",{class:"Button play end",onClick:w},"END"));const y=i("div",{class:"Button secondary mini",onClick:l},"Flip");y.classList.toggle("disabled",u.turn!==s.selfId);const k=i("div",{class:`Button play${g?"":" disabled"}`,onClick:M},"PLAY");return i("div",{class:"controls mobile"},k,y)}function B(){if(h){E(r),r.append(se());return}r.firstChild!==W&&(E(r),r.append(W));const u=s.getGame();A?.classList.toggle("disabled",u.turn!==s.selfId||u.numUnflipped===0)}function I(){o.textContent=h?"Tap pool letters (and a word to steal), then PLAY.":"Space (or Flip) reveals a tile · Enter claims · steal by rearranging a word + a new letter"}function z(){const u=s.getGame(),{glow:g,transform:y}=ce(f,u);f=u;const k=t.querySelector(".players")?.scrollTop??0;n=le(u,s.selfId,{selectable:h,glowWords:g,onSelectionChange:B}),E(t),t.append(n.el);const R=t.querySelector(".players");R&&(R.scrollTop=k),B(),y&&m(y),t.querySelector(".Word.glow")?.scrollIntoView({block:"nearest"}),re()}s.onChange(z),p.addEventListener("change",()=>{h=p.matches,I(),z()});function N(){if(!t.isConnected)return;const u=new Map((s.cpuWaits?.()??[]).map(g=>[g.id,g.fraction]));for(const g of t.querySelectorAll(".cpu-wait")){const y=g.dataset.bot?u.get(g.dataset.bot):void 0,k=g.firstElementChild;g.classList.toggle("is-waiting",y!==void 0),k&&(k.style.width=y===void 0?"0%":`${(y*100).toFixed(1)}%`)}requestAnimationFrame(N)}function re(){const u=s.getGame();if(!u.winner||c)return;const g=u.players.find(y=>y.id===u.winner);c=i("div",{class:"modal-backdrop"},i("div",{class:"modal"},ae(`${g?.name??"Nobody"} Wins`),i("div",{class:"Button",onClick:e},"Play Again"))),document.body.append(c)}const oe=i("div",{class:"App game"},t,r,a,o);return I(),z(),queueMicrotask(()=>{h||d.focus(),requestAnimationFrame(N)}),oe}const Y={minWordLen:4,stealRule:"root-change"},de={A:13,B:3,C:3,D:6,E:18,F:3,G:4,H:3,I:12,J:2,K:2,L:5,M:3,N:8,O:11,P:3,Q:2,R:9,S:6,T:9,U:6,V:3,W:3,X:2,Y:3,Z:2};function pe(s=de){const e=[];for(const[t,r]of Object.entries(s))for(let o=0;o<r;o++)e.push(t);return e}function he(s,e){for(let t=s.length-1;t>0;t--){const r=Math.floor(e()*(t+1)),o=s[t];s[t]=s[r],s[r]=o}return s}function b(s){const e={};for(const t of s)e[t]=(e[t]??0)+1;return e}function v(s,e){for(const t in s)if((e[t]??0)<s[t])return!1;return!0}function J(s,e){const t={};for(const r in s){const o=s[r]-(e[r]??0);o>0&&(t[r]=o)}return t}function K(s){let e=0;for(const t in s)e+=s[t];return e}const fe=["S","ES","ED","D","ING","INGS","ER","ERS","EST","LY"];function me(s,e){let t=0;for(let r=0;r<e.length&&t<s.length;r++)s[t]===e[r]&&t++;return t===s.length}function P(s,e,t,r){if(t==="strict-reorder")return!e.includes(s);if(e.startsWith(s)){const o=e.slice(s.length);if(fe.includes(o))return!1}return!(r?.(s,e)&&me(s,e))}function ge(s){const e={...Y,...s.config};let t=s.bag;if(!t){if(!s.rng)throw new Error("createEngine requires either `bag` or `rng`");t=he(pe(),s.rng)}return{bag:[...t],pool:[],players:s.players.map(r=>({...r,words:[...r.words]})),winner:"",passed:new Set,turn:0,config:e}}function we(s){return{flipped:[...s.pool],numUnflipped:s.bag.length,players:s.players.map(e=>({...e,words:[...e.words]})),winner:s.winner,turn:s.players[s.turn]?.id??"",passed:[...s.passed]}}function ye(s,e){if(s.winner)return{ok:!1,reason:"game-over"};if(s.players[s.turn]?.id!==e)return{ok:!1,reason:"not-your-turn"};const t=s.bag.pop();return t===void 0?{ok:!1,reason:"no-play"}:(s.pool.push(t),s.passed.clear(),s.turn=(s.turn+1)%s.players.length,{ok:!0})}function be(s){return s.toUpperCase().trim()}function $(s,e){for(const t in e){let r=e[t];for(;r>0;){const o=s.indexOf(t);if(o===-1)break;s.splice(o,1),r--}}}function ke(s,e,t,r,o){if(s.winner)return{ok:!1,reason:"game-over"};const a=be(t);if(!/^[A-Z]+$/.test(a))return{ok:!1,reason:"bad-letters"};if(a.length<s.config.minWordLen)return{ok:!1,reason:"too-short"};if(!r(a))return{ok:!1,reason:"not-a-word"};const n=s.players.find(h=>h.id===e);if(!n)return{ok:!1,reason:"no-play"};const c=b(a),f=b(s.pool);if(v(c,f))return $(s.pool,c),n.words.push(a),s.passed.clear(),{ok:!0};let p=!1;for(const h of s.players)for(let m=0;m<h.words.length;m++){const l=h.words[m],w=b(l);if(!v(w,c))continue;const d=J(c,w);if(!(K(d)<1)&&v(d,f)){if(!P(l,a,s.config.stealRule,o)){p=!0;continue}return h.words.splice(m,1),$(s.pool,d),n.words.push(a),s.passed.clear(),{ok:!0}}}return{ok:!1,reason:p?"illegal-steal":"no-play"}}function ve(s,e){return s.winner?!1:(s.passed.add(e),s.bag.length===0&&s.passed.size>=s.players.length?(Ce(s),!0):!1)}function Ce(s){let e=null,t=-1,r=-1;for(const o of s.players){const a=o.words.reduce((n,c)=>n+c.length,0);(o.words.length>t||o.words.length===t&&a>r)&&(e=o,t=o.words.length,r=a)}return s.winner=e?.id??"",e}function Le(s){let e=s>>>0;return()=>{e|=0,e=e+1831565813|0;let t=Math.imul(e^e>>>15,1|e);return t=t+Math.imul(t^t>>>7,61|t)^t,((t^t>>>14)>>>0)/4294967296}}function Te(s,e,t,r,o){const a=s.map(c=>c.toUpperCase());if(e){const c=e.toUpperCase();if(a.length<1)return null;const f=[...a,...c.split("")];if(f.length<o)return null;for(const p of t.exactAnagrams(f))if(p!==c&&P(c,p,r))return p;return null}if(a.length<o)return null;const n=t.exactAnagrams(a);return n.length?n[0]:null}class X{entries;constructor(e){this.entries=[];for(const t of e){const r=t.toUpperCase();this.entries.push({word:r,counts:b(r)})}}subsetWords(e,t){const r=[];for(const o of this.entries)o.word.length>=t&&v(o.counts,e)&&r.push(o.word);return r}exactAnagrams(e){const t=e.length,r=b(e.map(a=>a.toUpperCase())),o=[];for(const a of this.entries)a.word.length===t&&v(a.counts,r)&&o.push(a.word);return o}}function xe(s,e){const t={...s};for(const r in e)t[r]=(t[r]??0)+e[r];return t}function Se(s,e,t,r,o){const a=b(s.flipped),n=new Set,c=[];for(const f of t.subsetWords(a,e))n.has(`-${f}`)||(n.add(`-${f}`),c.push({word:f,base:null}));for(const f of s.players)for(const p of f.words){const h=b(p),m=xe(h,a);for(const l of t.subsetWords(m,e)){if(l===p)continue;const w=b(l);if(!v(h,w)||K(J(w,h))<1||!P(p,l,r,o))continue;const d=`${p}-${l}`;n.has(d)||(n.add(d),c.push({word:l,base:p}))}}return c}const Ae={medium:{skill:.75,reactionMs:1700}},ze=10,Ee=500,je=1200;class Oe{constructor(e,t,r){this.api=e,this.finder=t,this.opts=r}bots=[];playTimers=new Map;tableTimers=new Map;pending=new Map;rng=Math.random;add(e,t){this.bots.push({id:e,...t})}tick(){const e=this.api.getGame();if(e.winner){this.stop();return}const t=Se(e,this.opts.minWordLen,this.finder,this.opts.stealRule,this.opts.sameLemma);for(const r of this.bots)this.considerPlay(r,e,t),this.considerTable(r,e)}getWaits(){const e=performance.now(),t=[];for(const[r,o]of this.pending)t.push({id:r,fraction:Math.min(1,Math.max(0,(e-o.startedAt)/o.duration))});return t}considerPlay(e,t,r){const o=this.pending.get(e.id);if(!(o&&r.some(a=>a.word===o.word&&a.base===o.base))&&(this.clearPlay(e.id),r.length>0&&this.rng()<e.skill)){const a=this.choose(r),n=e.reactionMs*ze*(.6+this.rng()*.8);this.pending.set(e.id,{word:a.word,base:a.base,startedAt:performance.now(),duration:n}),this.playTimers.set(e.id,setTimeout(()=>this.firePlay(e.id),n))}}considerTable(e,t){if(this.pending.has(e.id)){this.clearTable(e.id);return}if(t.numUnflipped>0){if(t.turn!==e.id){this.clearTable(e.id);return}this.tableTimers.has(e.id)||this.tableTimers.set(e.id,setTimeout(()=>this.fireTable(e.id,{flip:{}}),Ee))}else{if(t.passed.includes(e.id)){this.clearTable(e.id);return}this.tableTimers.has(e.id)||this.tableTimers.set(e.id,setTimeout(()=>this.fireTable(e.id,{pass:{}}),je))}}choose(e){const t=[...e].sort((a,n)=>n.word.length-a.word.length),r=t[0].word.length,o=t.filter(a=>a.word.length>=r-1);return o[Math.floor(this.rng()*o.length)]}firePlay(e){const t=this.pending.get(e);this.clearPlay(e),t&&this.api.applyCpuAction(e,{tryWord:{word:t.word}})}fireTable(e,t){this.tableTimers.delete(e),this.api.applyCpuAction(e,t)}clearPlay(e){const t=this.playTimers.get(e);t&&clearTimeout(t),this.playTimers.delete(e),this.pending.delete(e)}clearTable(e){const t=this.tableTimers.get(e);t&&clearTimeout(t),this.tableTimers.delete(e)}stop(){for(const e of this.playTimers.values())clearTimeout(e);for(const e of this.tableTimers.values())clearTimeout(e);this.playTimers.clear(),this.tableTimers.clear(),this.pending.clear()}}class qe{constructor(e){this.opts=e,this.config={...Y,...e.config},this.roster=[{id:this.selfId,name:e.playerName,isCpu:!1}]}selfId="you";roster;engine=null;cpus=null;cpuSeq=0;started=!1;config;changeListeners=[];lobbyListeners=[];getLobby(){return{code:"",players:[...this.roster],isHost:!0,started:this.started}}onLobby(e){this.lobbyListeners.push(e)}addCpu(e="medium"){if(this.started)return;const t=++this.cpuSeq;this.roster.push({id:`cpu-${t}`,name:"CPU",isCpu:!0}),this.fireLobby()}startGame(){if(this.started||this.roster.length===0)return;const e=this.roster.map(r=>({...r,words:[]}));this.engine=ge({players:e,config:this.config,rng:Le(Date.now()&4294967295^2654435769)}),this.started=!0,this.cpus=new Oe({getGame:()=>this.getGame(),applyCpuAction:(r,o)=>this.applyAction(r,o)},this.opts.finder,{minWordLen:this.config.minWordLen,stealRule:this.config.stealRule,sameLemma:this.opts.sameLemma});const t=Ae.medium;for(const r of this.roster)r.isCpu&&this.cpus.add(r.id,t);this.fireLobby(),this.fireChange(),this.cpus.tick()}applyAction(e,t){if(!this.engine)return{ok:!1,reason:"no-play"};let r={ok:!0};return"flip"in t?r=ye(this.engine,e):"tryWord"in t?r=ke(this.engine,e,t.tryWord.word,this.opts.dict,this.opts.sameLemma):"pass"in t&&ve(this.engine,e),(r.ok||"pass"in t)&&(this.fireChange(),this.cpus?.tick()),r}getGame(){return this.engine?we(this.engine):{flipped:[],numUnflipped:0,players:[],winner:"",turn:"",passed:[]}}flip(){return this.applyAction(this.selfId,{flip:{}})}submit(e){return this.applyAction(this.selfId,{tryWord:{word:e}})}pass(){this.applyAction(this.selfId,{pass:{}})}onChange(e){this.changeListeners.push(e)}cpuWaits(){return this.cpus?.getWaits()??[]}async playSelection(e,t){if(!this.opts.loadAnagram)return{ok:!1,reason:"no-play"};const r=await this.opts.loadAnagram(),o=Te(e,t,r,this.config.stealRule,this.config.minWordLen);return o?this.applyAction(this.selfId,{tryWord:{word:o}}):{ok:!1,reason:"no-play"}}fireChange(){for(const e of this.changeListeners)e()}fireLobby(){for(const e of this.lobbyListeners)e()}dispose(){this.cpus?.stop()}}const Pe=`
able acid aces ache acre acres acted actor adds afar aged ages aide aids
aim aims airs ajar akin alarm album alert alike alive alley alloy aloft alone
also alter amber amble amend amid ample amuse angel anger angle ankle apart
apple apply apron arch arcs area arena argue arise armor army arose array arts
ashen aside asked asset atlas atom atoms aunt aura auto avert avoid await awake
award aware awoke axes axis bacon badge bags bake baked baker bakes bald bale
ball balm band bands bang bank bare barge bark barn bars base based bash basic
basin basis bask bass bath bats beach bead beam bean bear beard beast beat beats
beauty bed beds beef been beer bees beet began begin begun being bell belly below
belt bench bend bent berry best bets bias bid bike bile bill bind binds bird
birds bite bites bitter black blade blame bland blank blast blaze bleak bleed
blend bless blew blind blink bliss block blood bloom blot blow blue bluff blunt
blur board boast boat boats body boil bold bolt bond bone bones bonus book books
boom boost boot boots bore born boss both bound bout bowl box boxes boy boys brace
braid brain brake bran brand brass brave bread break breast breath breed brew
brick bride brief bright brim bring brink brisk broad broke brook broom broth
brown brush brute buck buds build built bulk bull bump bunch bundle bunk burn
burnt burst bush bust busy butter button buy buzz cabin cable cache cage cake
cakes calm came camel camp cane cans cape card care cared career carer cares
cargo carol carry cars cart carts case cash cast cat catch cater cats cause cave
cease cedar cedars cell cells cent chain chair chalk champ chant chaos chap charm
chart chase cheap cheat cheater cheats check cheek cheer chess chest chew chick
chief child chill chime chin chip choir choke chord chose chunk churn cider cigar
cite cited civic civil claim clamp clan clap clash class claw clay clean clear
cleat clerk click cliff climb cling cloak clock clone close cloth cloud clout
clove clown club clue clump coach coal coast coat coats cobra code coil coin
cold cole color colt comb come comet comic cope copy coral cord core cork corn
cost couch cough could count court cove cover covet cow crab crack craft cramp
crane crank crash crate crater crave crawl crazy cream creek creep crept crest
crew crib cried crisp croak crop cross crow crowd crown crude cruel crumb crush
crust cry cube cubic cult cure curl curse curve cyber dab dad daily dairy dale
dam dame damp dance dare dark dart dash data date dawn day days dead deaf deal
dealt dean dear death debit debt decay deck deed deep deer dense dent deny depth
desk deter detox devil diary dice dim dime din dine dined diner dingo dingy dire
dirt disc dish ditch dive diver dock doctor dodge doe does dog dogs doll dome
done donor door dose dot dots dot double doubt dough dove down dozen drab draft
drag drain drama drank draw drawn dread dream dress drew dried drift drill drink
drip drive drone droop drop drove drown drug drum dry duck due duel duet dug dull
duly dump dune dunk dusk dust duty dwarf dwell dwelt dye each eager eagle ear
earl early earn ears earth ease east easy eat eaten eats echo edge edges edit eel
eerie eggs eight elbow elder elect elite else elude email ember emit empty enact
end ends enemy enjoy enter entry envy equal equip era erase error erupt essay
ether evade even event ever every evict evil exact exam excel exert exile exist
exit extra eye eyes fable face faced faces fact facts fade faded fail faint fair
fairy faith fake falcon fall false fame fan fancy fang fans far fare farm fast
fat fatal fate fatty fault favor fawn fear feast feat feed feel feet fell felt
fence fend fern ferry fetch fever few fiber field fiend fiery fifth fifty fig
fight file filed files fill film final find finds fine finer fink fire fired fires
firm first fish fist fit five fix flag flair flake flame flank flap flare flash
flask flat flaw fled flee flesh flew flex flick flier fling flint flip flirt
float flock flood floor flora flour flow flue fluid flung flush flute foam focal
focus foe fog foil fold folk fond font food fool foot for force ford fore fork
form fort forth forty forum found four fox foxes frail frame frank fraud freak
free fresh fried friend frill frog from front frost frown froze fruit fry fudge
fuel full fume fun fund funny fur furry fury fuse fuzzy gain gait gala gale game
games gang gap gape garb gas gash gate gauge gave gaze gear gem gems gene genre
gent germ get ghost giant gift gifts gig gill gilt giraffe girl give given glad
glade gland glare glass glaze gleam glean glide glint gloat globe gloom glory
gloss glove glow glue gnaw goal goat goes gold golf gone good goose gore gorge
gout gown grab grace grade graft grain grand grant grape graph grasp grass grate
grave gravy graze great greed green greet grew grid grief grill grim grin grind
grip grit groan groin groom grope gross group grove grow growl grown grub gruff
guard guess guest guide guild guilt gulf gull gulp gum gums gun guns gust gut
guts guy guys gym habit hack had hail hair half hall halt ham hand hands handy
hang hard hare harm harp harsh haste hasty hat hatch hate hated hates hats haul
have haven havoc hawk hay haze hazel head heal heap hear heard heart heat heave
heavy heel heft heir held hell helm help hem hemp hen herb herd here hero hers
hide high hike hill hilt hind hint hip hire hiss hit hive hoard hoax hobby hog
hold hole holes holly home homes honey honor hood hoof hook hoop hop hope hoped
hopes horde horn horse hose host hot hotel hound hour house hover how howl hub
hue huff huge hull hum human humid hump hunch hung hunt hurl hurry hurt hush hut
hymn ice iced icily icing icon idea ideal idiom idle idol image impel imply inch
index inept infer inlet inner input intro irate iris iron irony issue item ivory
ivy jab jack jade jail jam jar jaw jazz jeans jelly jerk jest jet jewel jibe jig
job jobs join joint joke joker jolly jolt joust joy judge juice juicy jump junk
jury just keel keen keep kept kettle key keys kick kid kids kill kiln kin kind
king kings kiosk kiss kit kite kiwi knack knee kneel knelt knew knife knit knob
knock knot know known label labor lace laces lack lad lady lag lain lair lake
lamb lame lamp lance land lands lane lap lapse large lark lash last late later
laugh lava law lawn laws lay layer lazy lead leaf leak lean leap leapt learn lease
leash least leave led ledge leech leek left leg legal legs lemon lend length lens
lent less let level lever liar lice lick lid lie life lift light like liked likes
lily limb lime limit limp line lined linen liner lines link lint lion lip lips
liquid list lit live lived liver lives load loaf loan lobby local lock locks
lodge loft log logic logo loin lone long look loom loop loose loot lord lore lose
loser loss lost lot loud louse love loved lover loves low lower loyal luck lucky
lull lump lunar lunch lung lure lurk lush lust lute lying lymph lynx mace mad
made magic maid mail main maize major make maker makes male mall malt mamma man
mane mango mania manor many map maple maps mar marble march mare margin mark
market marry marsh mart mash mask mason mass mast mat match mate mates math matter
maul maxim maybe mayor maze meal mean meant meat medal media meet melon melt
memo mend mental menu mercy mere merge merit merry mesh mess metal meter mice
midst might mild mile miles milk mill mince mind mine miner mines mini mink mint
minus mirth misty mix mixer moan moat mock mode model modem moist mold mole molt
mom money monk month mood moon moor moose moral more morph moss most motel moth
motor mound mount mourn mouse mouth move moved mover movie mow much muck mud mug
mule mum mumble munch mural murky mush music musk must musty mute mutt myrrh myth
nag nail name named names nap nape nasal nasty nation navy near neat neck need
needs nerd nerve nest net never new news newt next nice niche nick niece night
nimble nine ninth nip noble nod node noise noisy nomad none noon noose norm north
nose nosy not note noted notes notch noun nova novel now noxious nudge nudity null
numb nurse nut nuts nylon nymph oak oaks oar oasis oat oath oats obey object oblige
oboe occur ocean odd odds ode of off offer often ogre oil oils oily okay old olive
omen omit once one ones onion only onset onto ooze opal open opera opt optic
oral orange orbit orchard order organ origin other otter ought ounce our oust out
outer oval oven over overt owe owed owl owls own owner ox oxen pace paced pack
pact pad page pages paid pail pain paint pair palm pan panel pang panic pant
papa paper par parade park part party pass past paste pat patch path patio pause
pave paw pawn pay peace peach peak pearl pear peas peat pecan peck pedal peek peel
peer pen penny peony perch peril perk pest petal phase phone photo piano pick
pie pier pies pig pike pile piles pill pilot pin pinch pine pines pink pint pious
pipe piper pique pit pitch pity pivot pixel place plaid plain plan plane plank
plant plate play plaza plea plead pleat pled plot plow ploy plug plum plump plus
plush poach pod poem poet point poise poke polar pole police poll pond pony pool
poor pope popular pore pork port pose posh post pot potato pouch pound pour pout
power prank pray press prey price prick pride prime print prior prism prize probe
prod prom prone prong proof prop prose proud prove prowl pry pub puck puff pull
pulp pulse puma pump punch punk pup pupil puppy pure purge purr purse push putt
quad quail quake quart queen query quest queue quick quiet quill quilt quip quit
quite quiz quote race raced racer races rack radar radio raft rag rage rags raid
rail rain raise rake rally ram ramp ran ranch random range rank rant rare rash
rat rate rated rates ratio rave raven raw ray rays razor reach react read ready
realm reap rear reason rebel recap recur reed reef reek reel refer reign rein
relax relay relic relief relish rely remedy remind remit renal rend renew rent
repay repel reply reset resin rest retire revel revere review reward rhino rhyme
rib ribbon rice rich rid ride rider ridge rife rift rig right rigid rigor rim
ring rinse riot rip ripe rise risen risk ritual rival river road roam roar roast
robe robin robot rock rocks rod rode rogue role roll roman romp roof rook room
roost root rope rose roses rosy rot rotor rouge rough round rouse route rove row
royal rub ruby rude ruff rug ruin rule ruler rum rumor run rune rung runt rural
ruse rush rust rusty sack sad saddle safe saga sage said sail saint sake salad
sale salmon salon salsa salt same sand sane sang sank sap sash sat satin sauce
save saved saw say scab scald scale scalp scam scan scant scar scare scared scarf
scary scene scent scoff scold scoop scope score scorn scour scout scowl scrap
scrub scuff sea seal seam search seas season seat second secret sect see seed
seedy seeing seek seem seen seep seer sees seize self sell semi send sense sent
sepia serve set seven sever sewn shack shade shady shaft shake shaky shale shall
sham shame shape share shark sharp shave shawl she shed sheen sheep sheer sheet
shelf shell shield shift shin shine shiny ship shirt shoal shock shoe shone shook
shoot shop shore short shot shout shove shown shred shrub shrug shun shut shy sick
side sift sigh sight sign silk sill silly silo silt silver simple sin since sinew
sing singe sink sip sir siren sister sit site sitter six sixth sixty size sized
skate sketch ski skid skill skim skin skip skirt skull skunk sky slab slack slain
slam slang slant slap slash slate slave sled sleek sleep sleet slept slice slick
slid slide slim slime sling slip slit slogan slope slot sloth slow slug slum slump
slung slur small smart smash smear smell smile smirk smith smock smog smoke smoky
smug snack snag snail snake snap snare snarl sneak sneer sniff snip snob snoop snore
snort snout snow snub snuff soak soap soar sob sober social sock soda sofa soft
soil sold sole solid solo solve some son song soon soot soothe sore sort soul
sound soup sour source south sow soy space spade span spare spark spasm speak
spear speck speed spell spend spent spice spike spill spin spine spiral spite
splash split spoil spoke sponge spool spoon sport spot spout spray spread spree
spring sprint sprout spruce spry spud spun spur spurt spy squad square squash
squat squid stab stack staff stage stain stair stake stale stalk stall stamp stand
star stare stared stark start state stay steady steak steal steam steel steep
steer stem step stern stew stick stiff still stilt sting stink stint stir stock
stoic stomp stone stood stool stoop stop store stork storm story stout stove stow
strain strand straw stray streak stream street stress strict stride strike string
strip strive strode stroke strong struck strut stub stud study stuff stump stun
stung stunt sturdy style suave such suck sudden suds suede sugar suit suite sulky
sullen sum summer summon sun sung sunk sunny sup super sure surf surge sushi swam
swamp swan swap swarm sway swear sweat sweep sweet swell swept swift swim swine
swing swipe swirl swish switch swivel swoon swoop sword swore sworn swung syrup
table tacit tack taco tact tag tail take taken taker tale talent talk tall tame
tan tang tank tap tape taper taps tar target tariff tart task taste tasty taught
taunt taut tax taxi tea teach teacher team tear tears tease teeth tell temper
temple tempo ten tenant tend tender tennis tenor tense tent tepid term terms tern
terror test text than thank that thaw theft their them theme then there these they
thick thief thigh thin thing think third thirst this thorn those though thread
threat three threw thrill throat throne throng throw thrust thud thug thumb thump
thus tick ticket tidal tidy tie tied tier ties tiger tight tile till tilt timber
time timer times timid tin tiny tip tips tire tired toad toast today toe toes tofu
toil token told toll tomb tone tones tongue tonic took tool tooth top topaz topic
torch torn toss total tote touch tough tour tout tow towel tower town toxic toy
trace track tract trade trail train trait tramp trap trash tray tread treat treaty
tree trek trend trial tribe trick tried trim trio trip tripe trite troll troop
trophy trot trout truce truck trudge true trump trunk trust truth try tub tube
tuck tug tulip tumble tuna tune tunic tunnel turf turn tusk tutor twang tweed tweet
twice twig twin twine twirl twist two tying type typist tyrant udder ugly ulcer
ultra umbra unbar uncle uncut under undo unfit unify union unit unite unity unzip
upon upper upset urban urea urge urgent usage use used user uses usher usual utter
vague vain vale valet valid valley value valve vamp van vane vapor vary vase vast
vat vault veer veil vein velvet vend venom vent verb verge verse very vest vet
veto vex via vial vibe vice video view vigil vile villa vine vinyl viola violet
violin viper viral virus visa vise visit visor vista vital vivid vocal vodka vogue
voice void volt volume vote voter vouch vow vowel voyage wad wade wafer wage wager
wagon wail waist wait wake waken walk wall walnut waltz wand wane want war ward
ware warm warn warp warily wart wary wash wasp waste watch water watt wave waved
wax way ways weak wealth wean wear weary weave web wed wedge weed week weep weigh
weird weld well welt went wept were west wet whale wharf what wheat wheel when
where which whiff while whim whine whip whirl whisk white whole whoop whose why
wick wide widow width wield wife wig wild will wilt wily win wince wind windy wine
wing wink winner wins winter wipe wire wires wiry wise wish wisp wit witch with
within witty wives wizard woe wok woke wolf woman wonder wood woods wool word words
wore work works world worm worn worry worse worst worth would wound woven wrap wrath
wreck wren wrench wrest wring wrist write writer wrong wrote wry yacht yam yank yard
yarn yawn year yearn yeast yell yellow yelp yes yet yield yodel yoga yoke yolk yore
young your youth yummy zeal zebra zero zest zinc zip zone zoo zoom`,S=new Set(Pe.split(/\s+/).filter(Boolean).map(s=>s.toUpperCase()));function Ue(s){return S.has(s.toUpperCase())}const D=28,G=12,_=8,We=255,Me=65;class Z{bytes;view;root;nodesOff;childrenOff;wordrefsOff;strtabOff;constructor(e){if(this.bytes=new Uint8Array(e),this.view=new DataView(e),this.bytes.length<D||this.magic()!=="ANT1")throw new Error("anatree: bad magic / too short");this.root=this.u32(8);const t=this.u32(12),r=this.u32(16),o=this.u32(20);if(this.nodesOff=D,this.childrenOff=this.nodesOff+t*G,this.wordrefsOff=this.childrenOff+r*_,this.strtabOff=this.wordrefsOff+o*4,this.strtabOff>this.bytes.length)throw new Error("anatree: truncated")}magic(){return String.fromCharCode(this.bytes[0],this.bytes[1],this.bytes[2],this.bytes[3])}u32(e){return this.view.getUint32(e,!0)}node(e){const t=this.nodesOff+e*G;return[this.bytes[t],this.u32(t+4),this.u32(t+8)]}child(e,t){const r=this.childrenOff+(e+t)*_;return[this.bytes[r],this.u32(r+4)]}wordAt(e){const t=this.u32(this.wordrefsOff+e*4),r=this.strtabOff+t,o=this.bytes[r];let a="";for(let n=0;n<o;n++)a+=String.fromCharCode(this.bytes[r+1+n]);return a}collect(e,t,r,o){const[a,n,c]=this.node(e);if(a===We){for(let p=0;p<c;p++){const h=this.wordAt(n+p);h.length>=r&&o.push(h)}return}const f=t[a];for(let p=0;p<c;p++){const[h,m]=this.child(n,p);h<=f&&this.collect(m,t,r,o)}}subsetWords(e,t){const r=new Uint8Array(26);for(const a in e){const n=a.charCodeAt(0)-Me;n>=0&&n<26&&(r[n]=Math.min(255,e[a]))}const o=[];return this.collect(this.root,r,t,o),o}exactAnagrams(e){const t=e.length,r=b(e.map(o=>o.toUpperCase()));return this.subsetWords(r,1).filter(o=>o.length===t)}}const Be="words-permissive.txt.gz",Ie="anatree-restrictive.bin",Ne="anatree-player.bin.gz",Re="lemmas.txt.gz";async function Fe(s){const e=await fetch("./"+s);if(!e.ok)throw new Error(`HTTP ${e.status}`);const t=await e.arrayBuffer(),r=new Uint8Array(t);if(r.length<2||r[0]!==31||r[1]!==139)return t;const o=new Response(r).body.pipeThrough(new DecompressionStream("gzip"));return new Response(o).arrayBuffer()}async function Q(s){const e=new Uint8Array(s);if(!(e.length>=2&&e[0]===31&&e[1]===139))return new TextDecoder().decode(e);const r=new Response(e).body.pipeThrough(new DecompressionStream("gzip"));return new Response(r).text()}let C=null;function $e(){return C||(C=(async()=>{try{const s=await fetch("./"+Be);if(!s.ok)throw new Error(`HTTP ${s.status}`);const e=await Q(await s.arrayBuffer()),t=new Set;for(const r of e.split(`
`)){const o=r.trim().toUpperCase();o&&t.add(o)}if(t.size===0)throw new Error("empty dictionary");return{isValid:r=>t.has(r.toUpperCase()),words:t,full:!0}}catch{return{isValid:Ue,words:S,full:!1}}})(),C)}let L=null;function De(){return L||(L=(async()=>{try{const s=await fetch("./"+Ie);if(!s.ok)throw new Error(`HTTP ${s.status}`);return new Z(await s.arrayBuffer())}catch{return new X(S)}})(),L)}let T=null;function Ge(){return T||(T=(async()=>{try{return new Z(await Fe(Ne))}catch{return new X(S)}})(),T)}let x=null;function _e(){return x||(x=(async()=>{const s=new Map;try{const e=await fetch("./"+Re);if(!e.ok)throw new Error(`HTTP ${e.status}`);const t=await Q(await e.arrayBuffer());for(const r of t.split(`
`)){const o=r.indexOf(" ");o>0&&s.set(r.slice(0,o),r.slice(o+1).trim())}}catch{}return(e,t)=>{const r=e.toUpperCase(),o=t.toUpperCase();return(s.get(r)??r)===(s.get(o)??o)}})(),x)}let q=null;function Ve(){document.querySelector(".modal-backdrop")?.remove(),q?.dispose(),q=null}function He(s){V(i("div",{class:"App"},i("div",{class:"title"},s),i("div",{class:"hint"},"One moment…")))}async function ee(){Ve(),He("Loading words…");const[s,e,t]=await Promise.all([$e(),De(),_e()]),r=new qe({playerName:"Player",dict:s.isValid,finder:e,loadAnagram:Ge,sameLemma:t});q=r,r.addCpu(),r.startGame(),V(ue(r,()=>void ee()))}ee();
