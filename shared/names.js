// Racer name rules shared by client and server: length cap, sanitising and a
// profanity / NSFW filter. The client uses these for instant feedback; the
// server runs the same checks and has the final say.

export const NAME_MAX = 20

// Printable characters only, no markup, collapsed whitespace, capped length.
export function cleanName (raw) {
  if (typeof raw !== 'string') return ''
  return raw
    .replace(/[\u0000-\u001f\u007f-\u009f<>&"'`]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, NAME_MAX)
}

// Blocked as a substring of the whole name (letters only, spaces and
// punctuation stripped): swear words, slurs and explicit sexual terms that
// don't occur inside ordinary words. Matching tolerates repeated letters
// ("fuuuck") and the leetspeak substitutions in LEET.
const BLOCK_ANYWHERE = [
  // swearing
  'fuck', 'fuk', 'fck', 'fvck', 'fux', 'phuck', 'phuk', 'motherfuck', 'shit', 'shyt', 'bullshit',
  'bitch', 'biatch', 'beotch', 'cunt', 'cvnt', 'kunt', 'asshole', 'arsehole', 'dumbass', 'jackass',
  'bastard', 'wanker', 'wank', 'twat', 'bollock', 'bellend', 'dickhead', 'cocksuck', 'douche',
  'piss', 'goddamn', 'jerkoff', 'skank',
  // sexual / nsfw
  'pussy', 'pussies', 'whore', 'slut', 'penis', 'vagina', 'clit', 'nipple', 'dildo', 'blowjob',
  'handjob', 'rimjob', 'footjob', 'fellatio', 'cunnilingus', 'orgasm', 'masturbat', 'cumshot',
  'creampie', 'gangbang', 'bukkake', 'deepthroat', 'buttplug', 'scrotum', 'testicle', 'ballsack',
  'nutsack', 'smegma', 'queef', 'cameltoe', 'porn', 'hentai', 'nsfw', 'xxx', 'erotic', 'milf',
  'dilf', 'hooker', 'prostitut', 'onlyfans', 'goatse', 'rapist', 'molest', 'pedo', 'paedo',
  'incest', 'bestiality', 'sodom', 'shemale', 'tranny',
  // slurs
  'nigger', 'nigga', 'niggr', 'negro', 'chink', 'gook', 'kike', 'wetback', 'faggot', 'dyke',
  'retard', 'raghead', 'towelhead', 'chinaman', 'darkie', 'darky', 'golliwog', 'jigaboo',
  'porchmonkey', 'redskin', 'injun', 'zipperhead', 'polack', 'lesbo', 'nazi', 'hitler', 'kkk'
]

// Blocked only as a whole word (a plural "s" allowed), because they sit inside
// harmless words: "class", "cucumber", "title", "analyst", "Sexton", "shelly".
const BLOCK_WORD = [
  'ass', 'arse', 'cum', 'tit', 'titty', 'tittie', 'boob', 'anal', 'anus', 'butt', 'sex', 'sexy',
  'cock', 'dick', 'prick', 'vag', 'semen', 'jizz', 'fap', 'hell', 'damn', 'crap', 'bugger',
  'shag', 'hoe', 'thot', 'homo', 'fag', 'spic', 'beaner', 'coon', 'jap', 'paki', 'sambo', 'wop',
  'dago', 'kraut', 'honky', 'squaw', 'hebe', 'heeb', 'yid', 'muzzie', 'tard', 'spaz', 'rape'
]

// Lookalike characters folded to the letter they stand in for.
const LEET = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', '@': 'a', $: 's', '!': 'i', '|': 'l' }

function fold (s) {
  return s.toLowerCase().replace(/[013457@$!|]/g, ch => LEET[ch])
}

const letters = s => s.replace(/[^a-z]/g, '')

// "shit" -> /s+h+i+t+/ so stretched spellings ("shiiit") match the same term.
const loose = term => term.split('').map(ch => ch + '+').join('')

const ANY_RE = new RegExp(BLOCK_ANYWHERE.map(loose).join('|'))
const WORD_RE = new RegExp('^(?:' + BLOCK_WORD.map(loose).join('|') + ')s?$')

const NOT_ALLOWED = 'Keep it clean — that name isn\'t allowed'

// null when `clean` (already through cleanName) is acceptable, else a short
// user-facing reason.
export function nameProblem (clean) {
  const name = typeof clean === 'string' ? clean : ''
  if (!name || !/\p{L}/u.test(name)) return 'Pick a name with at least one letter'
  const folded = fold(name)
  const joined = letters(folded)
  if (ANY_RE.test(joined) || WORD_RE.test(joined)) return NOT_ALLOWED
  const words = folded.split(/\s+/).map(letters).filter(Boolean)
  if (words.some(w => WORD_RE.test(w))) return NOT_ALLOWED
  return null
}
