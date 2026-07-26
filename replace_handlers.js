const fs = require('fs');

const path = "c:\\Users\\PMLS\\OneDrive\\Desktop\\tandoori-agent\\lib\\order-flow-handlers.ts";
let content = fs.readFileSync(path, 'utf8');

// Replace in the interface definition
content = content.replace(/buildOrderTypeInteractiveList/g, "buildOrderTypeReplyButtons");
content = content.replace(/buildQuickOrderTypeInteractiveList/g, "buildQuickOrderTypeReplyButtons");

// Now we need to update the calls to helpers.replyDecision
// The pattern is:
// helpers.replyDecision(
//   a,
//   b,
//   c,
//   helpers.buildQuickOrderTypeReplyButtons(...)
// )
//
// Let's just do a regex replace on the calls.
// Since `helpers.replyDecision` takes 5 arguments now (interactiveList as 4th, replyButtons as 5th),
// we need to inject `null,` before the helpers.buildQuick... call.

content = content.replace(
  /helpers\.replyDecision\(\s*([^,]+),\s*([^,]+(?:\(.*?\))?),\s*([^,]+),\s*helpers\.buildQuickOrderTypeReplyButtons/g,
  (match, p1, p2, p3) => {
    return `helpers.replyDecision(\n        ${p1},\n        ${p2},\n        ${p3},\n        null,\n        helpers.buildQuickOrderTypeReplyButtons`;
  }
);

content = content.replace(
  /helpers\.replyDecision\(\s*([^,]+),\s*([^,]+(?:\(.*?\))?),\s*([^,]+),\s*helpers\.buildOrderTypeReplyButtons/g,
  (match, p1, p2, p3) => {
    return `helpers.replyDecision(\n        ${p1},\n        ${p2},\n        ${p3},\n        null,\n        helpers.buildOrderTypeReplyButtons`;
  }
);

// We should also handle cases without trace where it's 3rd arg.
// Wait, in order-flow-handlers, it's mostly:
// helpers.replyDecision(reply, statePatch, trace, helpers.build...)
// Let's just manually fix the exact lines. It's safer.

fs.writeFileSync(path, content, 'utf8');
console.log("Updated order-flow-handlers.ts");
