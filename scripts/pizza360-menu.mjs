// Transcribed from the two owner-supplied Pizza 360 menu photographs.
export const restaurant = {
  name: "Pizza 360 & Fast Food", slug: "pizza-360-fast-food", city: "Karachi",
  phone: "+923432726396", alternatePhone: "+923453060934",
  address: "Shop No. 06, Main Bismillah Hotel, Manghopir Road, Karachi",
  hours: { opening: "04:00 PM", closing: "05:00 AM" },
  printedContacts: { "Pak Colony": "+923453060934", Metroville: "+923130881360", Bufferzone: "+923401791360" },
};
export const notes = [
  "Chinese dishes have two price columns without portion labels. Imported as Portion 1 and Portion 2; confirm serving sizes with the owner.",
  "Printed Beef Jumbo Burger with CH interpreted as Beef Jumbo Burger with Cheese.",
  "Other printed outlet contacts are retained as reference; only the address printed on this card is provisioned as a branch.",
  "Owner email, delivery fees, delivery areas and WhatsApp ownership were not supplied.",
];
export const items = [];
function add(name, price, category, description = "") { items.push({ name, price, category, description }); }
const sizes = ["Small", "Medium", "Large", "Extra Large", "Jumbo"];
const sizeDetails = ["6 inch, 4 slices", "8 inch, 6 slices", "12 inch, 8 slices", "13 inch, 10 slices", "15 inch, 12 slices"];
const regular = [
  ["Chicken Tikka", "Spicy; red sauce, meat, cheese, olives"],
  ["BBQ Tikka", "Spicy; red pizza sauce, meat, cheese, BBQ flavour"],
  ["Mexican Fajita", "Spicy; red sauce, red fried chilli, jalapeno, cheese"],
  ["Hot Tandoori", "Spicy; red sauce, meat, capsicum, jalapeno, cheese, onion"],
  ["Bihari", "Spicy; red sauce, meat, capsicum, jalapeno, cheese, onion"],
  ["Creamy Tikka", "Non spicy; white sauce, meat, cheese"],
  ["Afghani", "Non spicy; white sauce, meat, cheese, olives"],
  ["Malai Boti", "Non spicy; white sauce, mayo sauce, meat, cheese, jalapeno"],
  ["Malai Tikka", "Non spicy; white sauce, meat, cheese, liquid cheese"],
  ["Super Supreme", "Non spicy; white sauce, meat, cheese, liquid cheese"],
];
for (const [flavour, description] of regular) sizes.forEach((size, i) => add(`${flavour} Pizza (${size})`, [350,550,850,1050,1250][i], "Pizza", `${description}. ${sizeDetails[i]}. Pizza / پیزا`));
for (const flavour of ["360 Special", "Kabab Chaska", "Hot Pepperoni", "Creamy Bihari", "Creamy Fajita", "Makhni Chicken", "Green Arabian"]) {
  sizes.forEach((size, i) => add(`${flavour} Pizza (${size})`, [400,600,900,1100,1300][i], "Speciality Pizza", `${flavour} speciality pizza. ${sizeDetails[i]}. Pizza / پیزا`));
}
for (const [name,price] of [["Turkish Pide",750],["Laava Pizza",600],["Calzone",660]]) add(name,price,"Special Pizza");
for (const [name,price] of [
  ["Crispy Zinger Burger",400],["Crispy Zinger Cheese",440],["Crispy Jumbo Burger",600],["Crispy Jumbo with Cheese",650],
  ["Chipotlay Zinger",450],["Classic Chicken Burger",360],["Classic Chicken with Cheese",400],["Dynamite Beef Burger",380],
  ["Dynamite Beef with Cheese",430],["Chicken Jumbo Burger",550],["Beef Jumbo Burger with Cheese",580],["Mini Zinger",300],
]) add(name,price,"Burger",`${name}. Burger / برگر`);
for (const [name,price] of [["Leg Broast (Quarter)",490],["Chest Broast (Quarter)",550],["Injected Leg Broast (Quarter)",510],["Injected Chest Broast (Quarter)",610],["Crispy Wings (6 pieces)",350],["Nuggets (6 pieces)",299]]) add(name,price,"Broast",`${name}. Chicken broast / بروسٹ`);
for (const [name,price] of [["Crispy Roll",250],["Crispy Roll (Cheese)",290],["Shawarma Roll (Fries)",250],["Mexican Roll (Fries)",260],["Zinger Shawarma Roll",250]]) add(name,price,"Roll",`${name}. Roll / رول; shawarma / شوارما`);
for (const [name,price] of [["Mexican Sandwich",500],["Club Sandwich",400],["Club BBQ Sandwich",450],["Crispy Club",450],["Cheesy Club",450]]) add(name,price,"Sandwich",`${name}. Sandwich / سینڈوچ`);
for (const [name,prices] of [["Pasta",[350,600]],["Lasagne",[400,700]],["Pizza Fries",[350,600]]]) prices.forEach((price,i)=>add(`${name} (${["Small","Large"][i]})`,price,"Pasta, Lasagne & Pizza Fries",`${["Small","Large"][i]} ${name}. Pasta / پاستا; lasagne / لازانیا; fries / فرائز`));
for (const [name,prices] of [
  ["Chicken Chowmein",[400,600]],["Chicken Chilly Dry with Rice",[600,950]],["Chicken Shashlik with Rice",[600,950]],
  ["Chicken Manchurian with Rice",[600,950]],["Chicken Jalfrezi with Rice",[650,950]],["Singaporean Rice",[550,900]],
  ["Vegetable Fried Rice",[350,550]],["Chicken Fried Rice",[400,650]],["Egg Fried Rice",[380,650]],["Russian Salad",[300,500]],
]) prices.forEach((price,i)=>add(`${name} (Portion ${i+1})`,price,"Chinese",`${name}; printed price column ${i+1}. Serving size not labelled on the menu; confirm with restaurant. Chinese / چائنیز; rice / چاول; chowmein / چاؤمین`));
for (const [name,price] of [["Plain Fries",200],["Masala Fries",220],["Mayo Fries",250],["Cheese Slice",50],["Raita",40],["Coleslaw",40]]) add(name,price,"Add On");
const deals = [
  [650,"2 Small Pizzas"],[1550,"3 Medium Pizzas"],[1900,"2 Large Pizzas + 1 Small Pizza"],[2400,"3 Large Pizzas"],
  [1950,"1 Large Pizza + 1 Large Pasta + 1 Large Lasagne"],[3200,"4 Large Pizzas"],[1000,"1 Small Pizza + 1 Small Pasta + 1 Small Lasagne"],
  [2050,"2 Extra Large Pizzas"],[1300,"1 Medium Pizza + 1 Large Pizza"],[800,"1 Medium Pizza + 1 Small Pizza"],
  [1750,"1 Large Pizza + 1 Extra Large Pizza"],[1050,"2 Medium Pizzas"],[1100,"1 Club Sandwich + 1 Small Lasagne + 1 Zinger"],
  [1200,"1 Large Pizza + 1 Zinger"],[1650,"1 Extra Large Pizza + 1 Zinger + 1 Broast"],[1650,"2 Medium Pizzas + 2 Zingers"],
];
deals.forEach(([price,description],i)=>add(`Deal ${i+1}`,price,"Deals",`${description}. Combo deal / ڈیل. Flavour surcharges, if any, must be confirmed.`));
for (const [name,price,description] of [
  ["Hot Deal 1",1050,"2 Zingers + 1 Small Pizza"],["Hot Deal 2",700,"1 Zinger + 1 Small Pizza"],
  ["Hot Deal 3",1300,"2 Broast Legs + 1 Medium Pizza"],["Hot Deal 4",1100,"1 Small Pizza + 1 Zinger + 1 Broast Leg + Fries"],
]) add(name,price,"Hot Deals",description);
if (new Set(items.map(item=>item.name.toLowerCase())).size !== items.length) throw new Error("Duplicate menu item names");
if (items.some(item=>!Number.isFinite(item.price)||item.price<=0)) throw new Error("Invalid menu price");
