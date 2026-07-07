/* Shared card data + renderers for the Letter Cards viewer. */
const SCRIPTS = {
  ipa: { label:"IPA", isIPA:true, cards:[
    ["p","p","voiceless bilabial plosive","pit · spin"],["b","b","voiced bilabial plosive","bit · web"],
    ["t","t","voiceless alveolar plosive","top · stay"],["d","d","voiced alveolar plosive","dog · red"],
    ["k","k","voiceless velar plosive","cat · sky"],["ɡ","g","voiced velar plosive","go · bag"],
    ["ʔ","glottal stop","glottal plosive","uh-oh · button"],
    ["m","m","bilabial nasal","me · hum"],["n","n","alveolar nasal","no · sun"],["ŋ","eng","velar nasal","sing · finger"],
    ["f","f","voiceless labiodental fricative","fan · leaf"],["v","v","voiced labiodental fricative","van · love"],
    ["θ","theta","voiceless dental fricative","thin · bath"],["ð","eth","voiced dental fricative","this · father"],
    ["s","s","voiceless alveolar fricative","see · pass"],["z","z","voiced alveolar fricative","zoo · buzz"],
    ["ʃ","esh","voiceless postalveolar fricative","ship · nation"],["ʒ","ezh","voiced postalveolar fricative","vision · beige"],
    ["h","h","voiceless glottal fricative","hat · ahead"],["x","x","voiceless velar fricative","loch · Bach"],
    ["tʃ","t-esh","voiceless postalveolar affricate","church · match"],["dʒ","d-ezh","voiced postalveolar affricate","judge · gem"],
    ["ɹ","turned r","alveolar approximant","red · very"],["j","j","palatal approximant","yes · few"],
    ["w","w","labial-velar approximant","we · away"],["l","l","alveolar lateral approximant","let · fall"],
    ["i","i","close front unrounded vowel","see · machine"],["ɪ","small cap I","near-close front vowel","sit · myth"],
    ["e","e","close-mid front vowel","French été"],["ɛ","epsilon","open-mid front vowel","bed · head"],
    ["æ","ash","near-open front vowel","cat · trap"],["ə","schwa","mid central vowel","about · sofa"],
    ["ʌ","turned v","open-mid back unrounded vowel","cup · flood"],["ɑ","script a","open back unrounded vowel","father · spa"],
    ["ɒ","turned script a","open back rounded vowel","British lot"],["ɔ","open o","open-mid back rounded vowel","thought · law"],
    ["o","o","close-mid back rounded vowel","go · French eau"],["ʊ","upsilon","near-close back vowel","put · foot"],
    ["u","u","close back rounded vowel","boot · true"],["y","y","close front rounded vowel","French tu"],
    ["ø","slashed o","close-mid front rounded vowel","French deux"],["œ","o-e","open-mid front rounded vowel","French sœur"],
    ["ɜ","reversed epsilon","open-mid central vowel","British bird"],["ɐ","turned a","near-open central vowel","German besser"]
  ]},
  hebrew: { label:"Hebrew", cards:[
    ["א","Alef","/ʔ/ · silent","’"],["ב","Bet","/b/ · /v/","b · v"],["ג","Gimel","/ɡ/","g"],["ד","Dalet","/d/","d"],
    ["ה","He","/h/","h"],["ו","Vav","/v/","v"],["ז","Zayin","/z/","z"],["ח","Het","/χ/","kh"],["ט","Tet","/t/","t"],
    ["י","Yod","/j/","y"],["כ","Kaf","/k/ · /χ/","k · kh"],["ל","Lamed","/l/","l"],["מ","Mem","/m/","m"],
    ["נ","Nun","/n/","n"],["ס","Samekh","/s/","s"],["ע","Ayin","/ʔ/ · /ʕ/","‘"],["פ","Pe","/p/ · /f/","p · f"],
    ["צ","Tsadi","/ts/","ts"],["ק","Qof","/k/","q"],["ר","Resh","/ʁ/","r"],["ש","Shin","/ʃ/ · /s/","sh · s"],["ת","Tav","/t/","t"]
  ]},
  greek: { label:"Greek", cards:[
    ["Α α","Alpha","/a/","a"],["Β β","Beta","/v/","v"],["Γ γ","Gamma","/ɣ/ · /ʝ/","g"],["Δ δ","Delta","/ð/","dh"],
    ["Ε ε","Epsilon","/e/","e"],["Ζ ζ","Zeta","/z/","z"],["Η η","Eta","/i/","i"],["Θ θ","Theta","/θ/","th"],
    ["Ι ι","Iota","/i/","i"],["Κ κ","Kappa","/k/","k"],["Λ λ","Lambda","/l/","l"],["Μ μ","Mu","/m/","m"],
    ["Ν ν","Nu","/n/","n"],["Ξ ξ","Xi","/ks/","x"],["Ο ο","Omicron","/o/","o"],["Π π","Pi","/p/","p"],
    ["Ρ ρ","Rho","/r/","r"],["Σ σ","Sigma","/s/","s"],["Τ τ","Tau","/t/","t"],["Υ υ","Upsilon","/i/","y"],
    ["Φ φ","Phi","/f/","f"],["Χ χ","Chi","/x/ · /ç/","ch"],["Ψ ψ","Psi","/ps/","ps"],["Ω ω","Omega","/o/","o"]
  ]},
  cyrillic: { label:"Cyrillic", cards:[
    ["А а","A","/a/","a"],["Б б","Be","/b/","b"],["В в","Ve","/v/","v"],["Г г","Ge","/ɡ/","g"],["Д д","De","/d/","d"],
    ["Е е","Ye","/je/","ye"],["Ё ё","Yo","/jo/","yo"],["Ж ж","Zhe","/ʐ/","zh"],["З з","Ze","/z/","z"],["И и","I","/i/","i"],
    ["Й й","Short I","/j/","y"],["К к","Ka","/k/","k"],["Л л","El","/l/","l"],["М м","Em","/m/","m"],["Н н","En","/n/","n"],
    ["О о","O","/o/","o"],["П п","Pe","/p/","p"],["Р р","Er","/r/","r"],["С с","Es","/s/","s"],["Т т","Te","/t/","t"],
    ["У у","U","/u/","u"],["Ф ф","Ef","/f/","f"],["Х х","Kha","/x/","kh"],["Ц ц","Tse","/ts/","ts"],["Ч ч","Che","/tɕ/","ch"],
    ["Ш ш","Sha","/ʂ/","sh"],["Щ щ","Shcha","/ɕː/","shch"],["Ъ ъ","Hard sign","—","ʺ"],["Ы ы","Yery","/ɨ/","y"],
    ["Ь ь","Soft sign","/ʲ/","ʹ"],["Э э","E","/e/","e"],["Ю ю","Yu","/ju/","yu"],["Я я","Ya","/ja/","ya"]
  ]},
  armenian: { label:"Armenian", cards:[
    ["Ա","Ayb","/ɑ/","a"],["Բ","Ben","/b/","b"],["Գ","Gim","/ɡ/","g"],["Դ","Da","/d/","d"],["Ե","Ech","/ɛ/ · /jɛ/","e"],
    ["Զ","Za","/z/","z"],["Է","Ē","/ɛ/","ē"],["Ը","Ët","/ə/","ë"],["Թ","Tʿo","/tʰ/","tʿ"],["Ժ","Zhe","/ʒ/","zh"],
    ["Ի","Ini","/i/","i"],["Լ","Liwn","/l/","l"],["Խ","Xeh","/χ/","x"],["Ծ","Ca","/ts/","c"],["Կ","Ken","/k/","k"],
    ["Հ","Ho","/h/","h"],["Ձ","Dza","/dz/","dz"],["Ղ","Ghad","/ʁ/","gh"],["Ճ","Che","/tʃ/","č"],["Մ","Men","/m/","m"],
    ["Յ","Yi","/j/","y"],["Ն","Nu","/n/","n"],["Շ","Sha","/ʃ/","sh"],["Ո","Vo","/vɔ/ · /ɔ/","o"],["Չ","Chʿa","/tʃʰ/","čʿ"],
    ["Պ","Pe","/p/","p"],["Ջ","Je","/dʒ/","ǰ"],["Ռ","Ra","/r/","r"],["Ս","Se","/s/","s"],["Վ","Vew","/v/","v"],
    ["Տ","Tiwn","/t/","t"],["Ր","Re","/ɾ/","r"],["Ց","Cʿo","/tsʰ/","cʿ"],["Ւ","Yiwn","/v/ · /w/","w"],["Փ","Pʿiwr","/pʰ/","pʿ"],
    ["Ք","Kʿe","/kʰ/","kʿ"],["Օ","O","/ɔ/","ō"],["Ֆ","Feh","/f/","f"]
  ]},
  georgian: { label:"Georgian", cards:[
    ["ა","An","/ɑ/","a"],["ბ","Ban","/b/","b"],["გ","Gan","/ɡ/","g"],["დ","Don","/d/","d"],["ე","En","/ɛ/","e"],
    ["ვ","Vin","/v/","v"],["ზ","Zen","/z/","z"],["თ","Tan","/tʰ/","tʼ"],["ი","In","/i/","i"],["კ","Kan","/kʼ/","k’"],
    ["ლ","Las","/l/","l"],["მ","Man","/m/","m"],["ნ","Nar","/n/","n"],["ო","On","/ɔ/","o"],["პ","Par","/pʼ/","p’"],
    ["ჟ","Zhan","/ʒ/","zh"],["რ","Rae","/r/","r"],["ს","San","/s/","s"],["ტ","Tar","/tʼ/","t’"],["უ","Un","/u/","u"],
    ["ფ","Phar","/pʰ/","p"],["ქ","Khan","/kʰ/","k"],["ღ","Ghan","/ɣ/","gh"],["ყ","Qar","/qʼ/","q’"],["შ","Shin","/ʃ/","sh"],
    ["ჩ","Chin","/tʃʰ/","ch"],["ც","Tsan","/tsʰ/","ts"],["ძ","Dzil","/dz/","dz"],["წ","Tsil","/tsʼ/","ts’"],["ჭ","Char","/tʃʼ/","ch’"],
    ["ხ","Khan","/x/","x"],["ჯ","Jan","/dʒ/","j"],["ჰ","Hae","/h/","h"]
  ]},
  hiragana: { label:"Hiragana", cards:[
    ["あ","a","/a/","a"],["い","i","/i/","i"],["う","u","/ɯ/","u"],["え","e","/e/","e"],["お","o","/o/","o"],
    ["か","ka","/ka/","ka"],["き","ki","/ki/","ki"],["く","ku","/kɯ/","ku"],["け","ke","/ke/","ke"],["こ","ko","/ko/","ko"],
    ["さ","sa","/sa/","sa"],["し","shi","/ɕi/","shi"],["す","su","/sɯ/","su"],["せ","se","/se/","se"],["そ","so","/so/","so"],
    ["た","ta","/ta/","ta"],["ち","chi","/tɕi/","chi"],["つ","tsu","/tsɯ/","tsu"],["て","te","/te/","te"],["と","to","/to/","to"],
    ["な","na","/na/","na"],["に","ni","/ɲi/","ni"],["ぬ","nu","/nɯ/","nu"],["ね","ne","/ne/","ne"],["の","no","/no/","no"],
    ["は","ha","/ha/","ha"],["ひ","hi","/çi/","hi"],["ふ","fu","/ɸɯ/","fu"],["へ","he","/he/","he"],["ほ","ho","/ho/","ho"],
    ["ま","ma","/ma/","ma"],["み","mi","/mi/","mi"],["む","mu","/mɯ/","mu"],["め","me","/me/","me"],["も","mo","/mo/","mo"],
    ["や","ya","/ja/","ya"],["ゆ","yu","/jɯ/","yu"],["よ","yo","/jo/","yo"],
    ["ら","ra","/ɾa/","ra"],["り","ri","/ɾi/","ri"],["る","ru","/ɾɯ/","ru"],["れ","re","/ɾe/","re"],["ろ","ro","/ɾo/","ro"],
    ["わ","wa","/wa/","wa"],["を","wo","/o/","wo"],["ん","n","/ɴ/","n"]
  ]},
  korean: { label:"Korean", cards:[
    ["ㄱ","Giyeok","/k/ · /ɡ/","g/k"],["ㄴ","Nieun","/n/","n"],["ㄷ","Digeut","/t/ · /d/","d/t"],["ㄹ","Rieul","/l/ · /ɾ/","r/l"],
    ["ㅁ","Mieum","/m/","m"],["ㅂ","Bieup","/p/ · /b/","b/p"],["ㅅ","Siot","/s/","s"],["ㅇ","Ieung","/ŋ/ · silent","ng"],
    ["ㅈ","Jieut","/tɕ/","j"],["ㅊ","Chieut","/tɕʰ/","ch"],["ㅋ","Kieuk","/kʰ/","k"],["ㅌ","Tieut","/tʰ/","t"],
    ["ㅍ","Pieup","/pʰ/","p"],["ㅎ","Hieut","/h/","h"],
    ["ㅏ","A","/a/","a"],["ㅑ","Ya","/ja/","ya"],["ㅓ","Eo","/ʌ/","eo"],["ㅕ","Yeo","/jʌ/","yeo"],["ㅗ","O","/o/","o"],
    ["ㅛ","Yo","/jo/","yo"],["ㅜ","U","/u/","u"],["ㅠ","Yu","/ju/","yu"],["ㅡ","Eu","/ɯ/","eu"],["ㅣ","I","/i/","i"]
  ]}
};

const STYLES = [
  ["s1","Fine Press"],["s2","Art Deco"],["s3","Swiss Int'l"],["s4","Naturalist"],["s5","Bauhaus"],
  ["s6","Illuminated"],["s7","Sumi-e / Zen"],["s8","Editorial Didone"],["s9","Blueprint"],["s10","Midcentury"]
];
const SCRIPT_ORDER = ["ipa","hebrew","greek","cyrillic","armenian","georgian","hiragana","korean"];

function esc(s){return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");}

function frontHTML(style, scriptId, label, c, isIPA){
  const [g,name,ipa,eq] = c;
  const tab = isIPA ? "IPA" : label;
  const metaEq = eq ? `<div class="equiv">${esc(eq)}</div>` : "";
  return `<div class="card front ${style} sc-${scriptId}"><div class="inner">
    <div class="tab">${esc(tab)}</div>
    <div class="glyph">${esc(g)}</div>
    <div class="meta"><div class="name">${esc(name)}</div><div class="ipa">${esc(ipa)}</div>${metaEq}</div>
  </div></div>`;
}
function backHTML(style, scriptId, label, c){
  return `<div class="card back ${style} sc-${scriptId}"><div class="binner">
    <div class="bglyph">${esc(c[0])}</div><div class="bscript">${esc(label)}</div>
  </div></div>`;
}
