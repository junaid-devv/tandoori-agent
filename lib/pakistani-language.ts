/** Food spellings emitted by Pakistani voice notes, including Whisper's
 * occasional Devanagari output. Never translate or guess an unknown dish. */
export function normalizeFoodScript(text: string): string {
  const aliases: Array<[RegExp, string]> = [
    [/افغانی|अफगानी|अफ़ग़ानी/gu, "afghani"],
    [/ریپ|ریب|रैप|रैप्स/gu, "wrap"],
    [/चिकन|चिकेन|چکن|مرغی/gu, "chicken"],
    [/पराठा|परांठा|پراٹھا|پراتھا|پراتا/gu, "paratha"],
    [/रोल|رول/gu, "roll"],
    [/कबाबिश|کبابش|کبابیش/gu, "kababish"],
    [/पिज़्ज़ा|पिज्जा|पीज़ा|पिजा|پیزا|پزا/gu, "pizza"],
    [/चीज़|चीज़|चीज|چیز/gu, "cheese"],
    [/बर्गर|برگر/gu, "burger"],
    [/ज़िंगर|जिंगर|زنگر/gu, "zinger"],
    [/शावरमा|शवर्मा|شاورما/gu, "shawarma"],
    [/कबाब|کباب/gu, "kabab"],
    [/टिक्का|تکہ/gu, "tikka"],
    [/बिरयानी|بریانی/gu, "biryani"],
    [/कराही|कड़ाही|کڑاہی|کراہی/gu, "karahi"],
    [/नान|نان/gu, "naan"],
    [/फ्राइज़|फ्राइज|فرائز/gu, "fries"],
  ];
  let result = text;
  for (const [pattern, word] of aliases) result = result.replace(pattern, ` ${word} `);
  return result.replace(/\s+/g, " ").trim();
}

/** Customer copy uses Pakistani Urdu or English, never Hindi script/formulas. */
export function isPakistaniReply(text: string): boolean {
  return !/[\u0900-\u097f]/u.test(text)
    && !/\b(?:namaste|dhanyavaad|dhanyavad|kripya|kripaya|kirpya|bhojan|swadisht|swaadisht)\b/i.test(text);
}

export const PAKISTANI_LANGUAGE_RULE = "Use Pakistani conversational vocabulary: ji, zaroor, batayein, bhej dein, shukriya, maaf kijiye. Roman Urdu and Roman Pashto use Latin script only. Never output Hindi/Devanagari script or words such as namaste, kripya, dhanyavaad, bhojan or swadisht, even when a voice transcript or history contains them. Keep menu names in their catalog spelling.";
