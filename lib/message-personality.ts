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
  romanUrdu: boolean,
  branchName?: string,
  isReturning?: boolean,
  customerName?: string,
): string {
  const text = rawText.toLowerCase();
  const isSalam = /\b(assalam|aoa|salam)\b/.test(text);

  const nameStr = customerName ? ` ${customerName}` : "";

  const greetings = {
    salam_en: [
      `Walaikum Assalam${nameStr}! 🙏 Welcome — what are you craving today?`,
      `Walaikum Assalam${nameStr}! 👋 Great to have you. What can I get for you?`,
    ],
    salam_ur: [
      `Walaikum Assalam${nameStr}! 🙏 Aaj kya khane ka dil hai?`,
      `Walaikum Assalam${nameStr}! 👋 Kya order karwana chahein ge?`,
    ],
    hello_en: [
      `Hey there${nameStr}! 👋 What sounds good today?`,
      `Hello${nameStr}! 🍽️ Ready to order? Just tell me what you'd like.`,
    ],
    hello_ur: [
      `Hello${nameStr}! 👋 Batayein kya order karna hai?`,
      `Hey${nameStr}! 🍽️ Aaj kya pasand karein ge?`,
    ],
  };

  let greeting = "";
  if (romanUrdu) {
    greeting = isSalam ? pickRandom(greetings.salam_ur) : pickRandom(greetings.hello_ur);
  } else {
    greeting = isSalam ? pickRandom(greetings.salam_en) : pickRandom(greetings.hello_en);
  }

  if (branchName) {
    const branchInfo = romanUrdu
      ? `\n\n📍 Aap *${branchName}* branch se order kar rahe hain. (Change karne ke liye 'change branch' likhein)`
      : `\n\n📍 You're ordering from the *${branchName}* branch. (To change, reply 'change branch')`;
    return greeting + branchInfo;
  }

  return greeting;
}

export function getAcknowledgmentReply(romanUrdu: boolean): string {
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
  return romanUrdu ? pickRandom(acks.ur) : pickRandom(acks.en);
}
