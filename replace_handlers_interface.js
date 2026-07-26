const fs = require('fs');

const path = "c:\\Users\\PMLS\\OneDrive\\Desktop\\tandoori-agent\\lib\\order-flow-handlers.ts";
let content = fs.readFileSync(path, 'utf8');

// 1. Fix replyDecision interface in order-flow-handlers.ts
content = content.replace(
  /replyDecision: \(\s*reply: string,\s*statePatch: Partial<ConversationState>,\s*trace\?: TurnTrace,\s*interactiveList\?: \{\s*body: string;\s*buttonText: string;\s*sectionTitle\?: string;\s*rows: Array<\{ id: string; title: string; description\?: string \}>;\s*\} \| null,\s*\) => TurnDecision;/g,
  `replyDecision: (
    reply: string,
    statePatch: Partial<ConversationState>,
    trace?: TurnTrace,
    interactiveList?: {
      body: string;
      buttonText: string;
      sectionTitle?: string;
      rows: Array<{ id: string; title: string; description?: string }>;
    } | null,
    replyButtons?: {
      body: string;
      buttons: Array<{ id: string; title: string }>;
    } | null,
  ) => TurnDecision;`
);

// 2. Fix the `buildOrderTypeReplyButtons` and `buildQuickOrderTypeReplyButtons` return types in interface
content = content.replace(
  /buildOrderTypeReplyButtons: \(\s*romanUrdu: boolean,\s*deliveryEnabled: boolean,\s*\) =>\s*\|\s*\{\s*body: string;\s*buttonText: string;\s*sectionTitle\?: string;\s*rows: Array<\{ id: string; title: string; description\?: string \}>;\s*\}\s*\|\s*null;/g,
  `buildOrderTypeReplyButtons: (
    romanUrdu: boolean,
    deliveryEnabled: boolean,
  ) =>
    | {
      body: string;
      buttons: Array<{ id: string; title: string }>;
    }
    | null;`
);

content = content.replace(
  /buildQuickOrderTypeReplyButtons: \(\s*romanUrdu: boolean,\s*deliveryEnabled: boolean,\s*\) =>\s*\|\s*\{\s*body: string;\s*buttonText: string;\s*sectionTitle\?: string;\s*rows: Array<\{ id: string; title: string; description\?: string \}>;\s*\}\s*\|\s*null;/g,
  `buildQuickOrderTypeReplyButtons: (
    romanUrdu: boolean,
    deliveryEnabled: boolean,
  ) =>
    | {
      body: string;
      buttons: Array<{ id: string; title: string }>;
    }
    | null;`
);


// 3. Fix the calls to helpers.replyDecision in order-flow-handlers.ts to have null for interactiveList.
// Since the previous replace didn't work because `replyDecision` was imported differently or formatted differently,
// I'll do a regex carefully. Wait, let's search for how helpers.replyDecision is called with buildQuickOrderTypeReplyButtons.
// We can just match `helpers.buildQuickOrderTypeReplyButtons` and see its previous commas.
content = content.replace(
  /,\s*helpers\.buildQuickOrderTypeReplyButtons/g,
  `, null, helpers.buildQuickOrderTypeReplyButtons`
);
content = content.replace(
  /,\s*helpers\.buildOrderTypeReplyButtons/g,
  `, null, helpers.buildOrderTypeReplyButtons`
);

// If there was a case where trace wasn't passed, e.g. `helpers.replyDecision(reply, patch, helpers.buildQuick...)`
// then we'd need TWO nulls! But trace is passed in `order-flow-handlers.ts` as `trace` since it's in the args.
// Let's verify by just writing this and running tsc.

fs.writeFileSync(path, content, 'utf8');
console.log("Updated interfaces and calls in order-flow-handlers.ts");
