const MENU_TOKEN_STOP_WORDS = new Set([
  "the",
  "a",
  "an",
  "please",
  "pls",
  "with",
  "without",
  "and",
  "or",
  "my",
  "for",
  "item",
  "items",
  "dish",
  "food",
  "menu",
  "order",
  "add",
  "remove",
  "qty",
  "quantity",
]);

export function stripVoiceNotePrefix(value: string): string {
  return value
    .replace(/^\s*\[(?:voice\s*note|audio\s*(?:message|note)?|transcription)\]\s*:?/i, "")
    .trim();
}

const URDU_ORDER_TOKEN_REPLACEMENTS: Array<[RegExp, string]> = [
  [/[۰٠]/g, "0"],
  [/[۱١]/g, "1"],
  [/[۲٢]/g, "2"],
  [/[۳٣]/g, "3"],
  [/[۴٤]/g, "4"],
  [/[۵٥]/g, "5"],
  [/[۶٦]/g, "6"],
  [/[۷٧]/g, "7"],
  [/[۸٨]/g, "8"],
  [/[۹٩]/g, "9"],
  [/(?:کر)/g, " kar "],
  [/(?:ایک|اک|اِک)/g, " ek "],
  [/(?:دو)/g, " do "],
  [/(?:تین)/g, " teen "],
  [/(?:چار)/g, " char "],
  [/(?:پانچ)/g, " paanch "],
  [/(?:چھ|چھے)/g, " chay "],
  [/(?:سات)/g, " saat "],
  [/(?:آٹھ|اٹھ)/g, " aath "],
  [/(?:دس)/g, " das "],
  [/(?:فل|فُل|فول)/g, " full "],
  [/(?:ہاف|نصف)/g, " half "],
  [/(?:مینیو|مینو|مینوں|منیو)/g, " menu "],
  [/(?:آرڈر|ارڈر)/g, " order "],
  [/(?:آپشن|اوپشن|اوشن|اویشن)/g, " option "],
  [/(?:ایویلیبل|اویلیبل|دستیاب|ملے\s*گا|ملے\s*گی|مل\s*جائے\s*گا|مل\s*جائے\s*گی)/g, " available "],
  [/(?:کون\s*سی|کونسا|کون\s*سا|کونسے|کون\s*سے)/g, " kaun si "],
  [/(?:کیا)/g, " kya "],
  [/(?:میں|مے)/g, " mein "],
  [/(?:اور)/g, " aur "],
  [/(?:بھی)/g, " bhi "],
  [/(?:کوئی|کوی)/g, " koi "],
  [/(?:یہ|وہ|ہے|ہیں|تھا|تھی|کرنا|لینا|دینا|مجھے|ہمیں|آپ|اپ)/g, " "],
  [/(?:چکن|مرغی)/g, " chicken "],
  [/(?:مٹن|بکرا|بکرے)/g, " mutton "],
  [/(?:بیف|گائے)/g, " beef "],
  [/(?:بریانی)/g, " biryani "],
  [/(?:پلاؤ|پلاو)/g, " pulao "],
  [/(?:چاول)/g, " rice "],
  [/(?:کڑاہی|کڑائی|کرائی|کراہی)/g, " karahi "],
  [/(?:ہانڈی)/g, " handi "],
  [/(?:قورمہ|کورمہ)/g, " qorma "],
  [/(?:نہاری|نھاری)/g, " nihari "],
  [/(?:حلیم)/g, " haleem "],
  [/(?:دال)/g, " daal "],
  [/(?:پایہ|پاۓ|پائے)/g, " paya "],
  [/(?:سالن)/g, " salan "],
  [/(?:تکہ|ٹکہ)/g, " tikka "],
  [/(?:بوٹی)/g, " boti "],
  [/(?:کباب|کبب)/g, " kabab "],
  [/(?:رول)/g, " roll "],
  [/(?:برگر)/g, " burger "],
  [/(?:پیزا)/g, " pizza "],
  [/(?:فرائز|چپس)/g, " fries "],
  [/(?:نان)/g, " naan "],
  [/(?:روٹی)/g, " roti "],
  [/(?:رائتہ|رائتا)/g, " raita "],
  [/(?:سلاد)/g, " salad "],
  [/(?:کولڈ\s*ڈرنک|ڈرنک|بوتل)/g, " drink "],
  [/(?:ڈیلیور|ڈلیور|ڈلیوری|ڈیلیوری)/g, " delivery "],
  [/(?:بھیج|بھیجیں|بھیجو|بھیجنا)/g, " bhej "],
  [/(?:چاہیے|چائیے|چاہئے)/g, " chahiye "],
  [/(?:کردو|کر\s*دو|کر\s*دیں|کر\s*دے|کردیں|کردے)/g, " kar do "],
  [/(?:دے\s*دو|دے\s*دیں|دیدو|دیدیں)/g, " de do "],
  [/(?:پک\s*اپ|پکاپ)/g, " pickup "],
  [/(?:ڈائن\s*ان|دائن\s*ان)/g, " dine in "],
  [/(?:مصالحہ|مرچ|تیز)/g, " spicy "],
  [/(?:کم)/g, " less "],
  [/(?:زیادہ)/g, " extra "],
];

function expandUrduOrderTokens(value: string): string {
  let expanded = value;
  for (const [pattern, replacement] of URDU_ORDER_TOKEN_REPLACEMENTS) {
    expanded = expanded.replace(pattern, replacement);
  }
  return expanded;
}

export function normalizeText(value: string): string {
  const withAliasExpansion = expandUrduOrderTokens(stripVoiceNotePrefix(value))
    .toLowerCase()
    .replace(/\bice[\s-]?cream\b/g, "ice cream");
  return withAliasExpansion
    .toLowerCase()
    .replace(/[-_]+/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeCompact(value: string): string {
  return normalizeText(value).replace(/\s+/g, "");
}

export function tokenizeForMenuMatching(value: string): string[] {
  return normalizeText(value)
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2 && !MENU_TOKEN_STOP_WORDS.has(token));
}

export function tokenOverlapScore(left: string, right: string): number {
  const leftTokens = tokenizeForMenuMatching(left);
  const rightTokens = tokenizeForMenuMatching(right);
  if (leftTokens.length === 0 || rightTokens.length === 0) return 0;

  let overlap = 0;
  for (const token of leftTokens) {
    const hasExact = rightTokens.includes(token);
    const hasNear = rightTokens.some((candidate) => {
      const minLength = Math.min(token.length, candidate.length);
      if (minLength < 4) return false;
      return token.includes(candidate) || candidate.includes(token);
    });
    if (hasExact || hasNear) overlap += 1;
  }

  return overlap / Math.max(leftTokens.length, rightTokens.length);
}

export function itemSimilarityScore(left: string, right: string): number {
  if (left === right) return 1;
  if (left.includes(right) || right.includes(left)) return 0.85;

  const leftCompact = normalizeCompact(left);
  const rightCompact = normalizeCompact(right);
  if (leftCompact && rightCompact) {
    if (leftCompact === rightCompact && leftCompact.length >= 4) return 0.92;
    const minCompactLength = Math.min(leftCompact.length, rightCompact.length);
    if (minCompactLength >= 5 && (leftCompact.includes(rightCompact) || rightCompact.includes(leftCompact))) {
      return 0.74;
    }
  }

  const leftTokens = new Set(left.split(" ").filter(Boolean));
  const rightTokens = new Set(right.split(" ").filter(Boolean));
  if (leftTokens.size === 0 || rightTokens.size === 0) return 0;

  let intersection = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) intersection += 1;
  }

  const union = new Set([...leftTokens, ...rightTokens]).size;
  const jaccard = union > 0 ? intersection / union : 0;
  const compactBonus = normalizeCompact(left) === normalizeCompact(right) ? 0.2 : 0;
  return Math.min(1, jaccard + compactBonus);
}
