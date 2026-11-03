import type { LanguagePreference } from "./schema.types";

export function pickRandom<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

export function formatCurrency(amount: number): string {
  return "Rs. " + amount.toLocaleString("en-PK");
}

export function formatCategoryHeader(name: string): string {
  // Add some emoji flair based on common names
  let emoji = "🍽️";
  const lower = name.toLowerCase();
  if (lower.includes("bbq") || lower.includes("tikka") || lower.includes("kebab")) emoji = "🔥";
  else if (lower.includes("karahi") || lower.includes("handi")) emoji = "🥘";
  else if (lower.includes("biryani") || lower.includes("rice")) emoji = "🍛";
  else if (lower.includes("naan") || lower.includes("roti") || lower.includes("bread")) emoji = "🫓";
  else if (lower.includes("drink") || lower.includes("beverage") || lower.includes("shake")) emoji = "🥤";
  else if (lower.includes("sweet") || lower.includes("dessert") || lower.includes("kheer")) emoji = "🍨";
  else if (lower.includes("fast") || lower.includes("burger") || lower.includes("pizza")) emoji = "🍔";
  else if (lower.includes("deal") || lower.includes("platter")) emoji = "⭐";

  return `${emoji} *${name.toUpperCase()}*\n━━━━━━━━━━━━`;
}

export function getGreetingReply(
  rawText: string,
  langOrRomanUrdu: boolean | LanguagePreference,
  branchName?: string,
  isReturning?: boolean,
  customerName?: string,
): string {
  const text = rawText.toLowerCase();
  const isSalam = /\b(assalam|aoa|salam)\b/.test(text);

  const nameStr = customerName ? ` ${customerName}` : "";

  const greetings = {
    salam_en: [
      `Walaikum Assalam${nameStr}! 👋 What can I get for you today?`,
      `Walaikum Assalam${nameStr}! 🙏 Welcome, what would you like to order?`,
    ],
    salam_ur: [
      `Walaikum Assalam${nameStr}! 👋 Batayein kya order karna chahein ge?`,
      `Walaikum Assalam${nameStr}! 🙏 Aaj kya mangwana chahein ge?`,
    ],

    hello_en: [
      `Hello${nameStr}! 👋 What can I get for you today?`,
      `Hey there${nameStr}! 👋 What would you like to order?`,
    ],
    hello_ur: [
      `Hello${nameStr}! 👋 Batayein kya order karna chahein ge?`,
      `Hello${nameStr}! 🍽️ Aaj kya mangwana chahein ge?`,
    ],

  };

  const isUr = langOrRomanUrdu === "roman_urdu" || langOrRomanUrdu === true;

  if (isUr) {
    return isSalam ? pickRandom(greetings.salam_ur) : pickRandom(greetings.hello_ur);
  }
  return isSalam ? pickRandom(greetings.salam_en) : pickRandom(greetings.hello_en);
}

export function getAcknowledgmentReply(langOrRomanUrdu: boolean | LanguagePreference): string {
  const acks = {

    ur: [
      "No worries! 👍 Jab ready hon, item ka naam bhej dein.",
      "Zaroor! Let me know kya order karna hai 🍽️",
      "Theek hai! 👍 Jab dil kare order bhej dein.",
    ],
    en: [
      "No worries! 👍 Just send an item name whenever you're ready to order.",
      "Sure thing! Let me know what you'd like 🍽️",
      "Alright! 👍 I'm here when you're ready.",
    ],
  };

  const isUr = langOrRomanUrdu === "roman_urdu" || langOrRomanUrdu === true;

  if (isUr) return pickRandom(acks.ur);
  return pickRandom(acks.en);
}
