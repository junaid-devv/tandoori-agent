const fs = require('fs');

const path = "c:\\Users\\PMLS\\OneDrive\\Desktop\\tandoori-agent\\lib\\order-engine.ts";
let content = fs.readFileSync(path, 'utf8');

// The replacement logic:
// We look for patterns like:
// nextStep === "collecting_items" ? buildQuickOrderTypeInteractiveList(prefersRomanUrdu, context.settings.delivery_enabled) : null,
// We want to replace buildQuickOrderTypeInteractiveList with null, buildQuickOrderTypeReplyButtons
// Actually, it's easier to just match:
// `buildQuickOrderTypeInteractiveList(` -> `null, buildQuickOrderTypeReplyButtons(`
// Wait, if it's passed as an argument, this works:
// before: `replyDecision(a, b, c, buildQuickOrderTypeInteractiveList(d, e))`
// after: `replyDecision(a, b, c, null, buildQuickOrderTypeReplyButtons(d, e))`

content = content.replace(/buildQuickOrderTypeInteractiveList\(/g, "null, buildQuickOrderTypeReplyButtons(");

// Also need to fix where it's exported at the top or bottom, wait, is it exported?
// "buildQuickOrderTypeInteractiveList," -> "buildQuickOrderTypeReplyButtons,"
content = content.replace(/buildQuickOrderTypeInteractiveList,/g, "buildQuickOrderTypeReplyButtons,");

fs.writeFileSync(path, content, 'utf8');
console.log("Done updating order-engine.ts");
