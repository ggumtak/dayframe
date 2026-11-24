/**
 * Picks the Korean particle that fits the word in front of it, so a toast reads "‘장보기’를 옮겼습니다" rather than
 * "‘장보기’을(를) 옮겼습니다". Only the end of the word matters: whether its last sound has a final consonant
 * (받침), and for (으)로 whether that consonant is ㄹ.
 *
 * Hangul is read from the syllable itself. Digits are read the way Korean reads the number ("3" 삼, "10" 십,
 * "100" 백), and a clock time the way it is spoken ("3:00" 세 시, "3:30" 삼십 분). Latin letters are read by
 * their letter name when the word is a capitalised acronym ("P1" is 피일, "URL" ends in 엘) and by common
 * English endings otherwise ("mail" 메일, "plan" 플랜, "note" 노트).
 * Trailing quotes, brackets and punctuation are skipped. When the last character still cannot be read, the
 * particle comes back in its double form, "을(를)", which is correct either way.
 */

export type JosaPair = '을/를' | '이/가' | '은/는' | '와/과' | '으로/로';

/** none: ends in a vowel; rieul: ends in ㄹ; other: ends in any other final consonant. */
type Ending = 'none' | 'rieul' | 'other';

const FORMS: Record<JosaPair, { consonant: string; vowel: string; rieul: string; unknown: string }> = {
  '을/를': { consonant: '을', vowel: '를', rieul: '을', unknown: '을(를)' },
  '이/가': { consonant: '이', vowel: '가', rieul: '이', unknown: '이(가)' },
  '은/는': { consonant: '은', vowel: '는', rieul: '은', unknown: '은(는)' },
  '와/과': { consonant: '과', vowel: '와', rieul: '과', unknown: '와(과)' },
  '으로/로': { consonant: '으로', vowel: '로', rieul: '로', unknown: '(으)로' },
};

// 영 일 이 삼 사 오 육 칠 팔 구
const DIGIT_ENDINGS: Ending[] = ['other', 'rieul', 'none', 'other', 'none', 'none', 'other', 'rieul', 'rieul', 'none'];

// The final sound of each letter's Korean name: 엘, 엠, 엔, 알 end in a consonant; 에이, 비, 씨 … do not.
const LETTER_NAME_ENDINGS: Record<string, Ending> = { l: 'rieul', r: 'rieul', m: 'other', n: 'other' };

const SKIPPED = /[\s.,!?…·:;'"‘’“”()[\]{}<>「」『』〈〉《》~\-–—]/;

function hangulEnding(code: number): Ending {
  const final = (code - 0xac00) % 28;
  if (final === 0) return 'none';
  return final === 8 ? 'rieul' : 'other';
}

/** "10" 십, "100" 백, "1000" 천, "10000" 만, "100000000" 억: a number ending in zeros is read by its unit. */
function numberEnding(digits: string): Ending {
  const last = Number(digits[digits.length - 1]);
  if (last !== 0) return DIGIT_ENDINGS[last];
  const zeros = digits.length - digits.replace(/0+$/, '').length;
  if (zeros === digits.length) return 'other'; // 영
  switch (zeros % 4) {
    case 1: return 'other'; // 십
    case 2: return 'other'; // 백
    case 3: return 'other'; // 천
    default: return zeros / 4 === 3 ? 'none' : 'other'; // 만, 억 end in a consonant; 조 does not
  }
}

function latinEnding(word: string): Ending | null {
  const letters = word.match(/[A-Za-z]+$/)![0];
  const last = letters[letters.length - 1];
  // Acronyms and single letters are read letter by letter: "P" 피, "URL" 유알엘, "PM" 피엠.
  if (letters.length === 1 || letters === letters.toUpperCase()) {
    return LETTER_NAME_ENDINGS[last.toLowerCase()] ?? 'none';
  }
  const tail = letters.toLowerCase();
  if (tail.endsWith('l')) return 'rieul'; // mail 메일, goal 골
  if (/(m|n|ng)$/.test(tail)) return 'other'; // team 팀, plan 플랜, meeting 미팅
  if (/[aeiouyrw]$/.test(tail)) return 'none'; // note 노트, memo 메모, timer 타이머, show 쇼
  if (/[dfghjqsvxz]$/.test(tail)) return 'none'; // card 카드, golf 골프, blog 블로그, bus 버스, box 박스
  return null; // b, c, k, p, t: web 웹 but hub 허브, book 북 but cake 케이크 — cannot tell
}

function ending(word: string): Ending | null {
  let i = word.length - 1;
  while (i >= 0 && SKIPPED.test(word[i])) i -= 1;
  if (i < 0) return null;
  const rest = word.slice(0, i + 1);
  // A clock time is read in hours and minutes: "3:00" 세 시, "3:30" 세 시 삼십 분.
  const clock = rest.match(/\d{1,2}:(\d{2})$/);
  if (clock) return clock[1] === '00' ? 'none' : 'other';
  const code = rest.charCodeAt(i);
  if (code >= 0xac00 && code <= 0xd7a3) return hangulEnding(code);
  if (code >= 0x30 && code <= 0x39) return numberEnding(rest.match(/\d+$/)![0]);
  if (/[A-Za-z]/.test(rest[i])) return latinEnding(rest);
  return null;
}

/** The particle alone: `josa('장보기', '을/를')` is "를". */
export function josa(word: string, pair: JosaPair): string {
  const forms = FORMS[pair];
  switch (ending(word)) {
    case 'none': return forms.vowel;
    case 'rieul': return forms.rieul;
    case 'other': return forms.consonant;
    default: return forms.unknown;
  }
}

/** The word followed by its particle: `withJosa('오후 3:30', '으로/로')` is "오후 3:30으로". */
export function withJosa(word: string, pair: JosaPair): string {
  return word + josa(word, pair);
}
